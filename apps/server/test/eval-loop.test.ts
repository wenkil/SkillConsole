import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"

import { buildApplication } from "../src/app.js"
import {
  closeDatabaseClient,
  createDatabaseClient,
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
} from "../src/infrastructure/database/index.js"
import type {
  AgentRuntimeAdapter,
  AgentRuntimeSession,
  OpenAgentRuntimeSessionInput,
  RuntimeTurnInput,
} from "../src/modules/agent-sessions/agent-session.domain.js"
import type {
  EvalGenerationDraftView,
  EvalGenerationTaskView,
  PublishEvalRevisionResult,
} from "../src/modules/evals/eval-generation.domain.js"
import { recordFakeNativeTurn } from "./fake-native-agent-log.js"

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()
const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)
const folderIgnorePolicyPath = fileURLToPath(
  new URL("../config/upload-folder-ignore.json", import.meta.url),
)

class EvalsFakeRuntime implements AgentRuntimeSession {
  private closed = false
  private readonly sdkSessionId = randomUUID()

  constructor(private readonly input: OpenAgentRuntimeSessionInput) {}

  async send(turn: RuntimeTurnInput): Promise<void> {
    if (this.closed) throw new Error("Fake Evals runtime is closed.")
    await this.input.onEvent(null, {
      type: "initialized",
      sdkSessionId: this.sdkSessionId,
      model: "claude-fake-evals",
      tools: ["Read", "Write", "Edit"],
      skills: [],
      mcpServers: [],
    })
    const outputRoot = path.join(this.input.cwd, "output")
    await mkdir(path.join(outputRoot, "files"), { recursive: true })
    await writeFile(
      path.join(outputRoot, "files", "fixture.txt"),
      "controlled fixture",
      "utf8",
    )
    await writeFile(
      path.join(outputRoot, "evals.json"),
      JSON.stringify({
        evals: [
          {
            id: 1,
            name: "summarize-fixture",
            prompt: "请概括输入文件的核心内容",
            expected_output: "一段准确摘要",
            files: ["files/fixture.txt"],
            expectations: ["摘要包含 controlled fixture 的核心含义"],
          },
        ],
      }),
      "utf8",
    )
    await recordFakeNativeTurn(
      this.input,
      this.sdkSessionId,
      turn.turnId,
      true,
      "Generated one Evals case.",
    )
    await this.input.onEvent(turn.turnId, {
      type: "assistant_message",
      messageId: randomUUID(),
      content: [{ type: "text", text: "Generated one Evals case." }],
    })
    await this.input.onEvent(turn.turnId, {
      type: "turn_result",
      success: true,
      subtype: "success",
      durationMs: 10,
      durationApiMs: 8,
      numTurns: 1,
      totalCostUsd: 0.001,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      error: null,
    })
  }

  async interrupt(): Promise<void> {
    throw new Error("The completed fake runtime cannot be interrupted.")
  }

  close(): void {
    this.closed = true
  }
}

class EvalsFakeAdapter implements AgentRuntimeAdapter {
  readonly opens: OpenAgentRuntimeSessionInput[] = []

  open(input: OpenAgentRuntimeSessionInput): AgentRuntimeSession {
    this.opens.push(input)
    return new EvalsFakeRuntime(input)
  }
}

async function waitForTerminal(
  baseUrl: string,
  taskId: string,
): Promise<EvalGenerationTaskView> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `${baseUrl}/api/eval-generations/${taskId}`,
    )
    assert.equal(response.status, 200)
    const task = (await response.json()) as EvalGenerationTaskView
    if (
      ["SUCCEEDED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
        task.status,
      )
    ) {
      return task
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for the fake Evals task.")
}

test(
  "closes the Fake Adapter generation, review, and immutable publish loop",
  { skip: !testDatabaseUrl, timeout: 60_000 },
  async () => {
    assert.ok(testDatabaseUrl)
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "skillconsole-eval-loop-"),
    )
    const settingsPath = path.join(dataRoot, "settings.json")
    await writeFile(
      settingsPath,
      '{"env":{"ANTHROPIC_API_KEY":"integration-secret"}}',
      "utf8",
    )
    const databaseClient = createDatabaseClient(testDatabaseUrl, {
      applicationName: "skillconsole-eval-loop-seed",
      maxConnections: 2,
    })
    await migrate(databaseClient.database, {
      migrationsFolder,
      migrationsSchema: "drizzle",
      migrationsTable: "migrations",
    })

    const workspaceId = randomUUID()
    const snapshotId = randomUUID()
    const versionId = randomUUID()
    const skillContent =
      "---\nname: sample-skill\ndescription: Test Skill\n---\n"
    const skillHash = createHash("sha256")
      .update(skillContent)
      .digest("hex")
    await mkdir(
      path.join(dataRoot, "snapshots", snapshotId, "files"),
      { recursive: true },
    )
    await writeFile(
      path.join(
        dataRoot,
        "snapshots",
        snapshotId,
        "files",
        "SKILL.md",
      ),
      skillContent,
      "utf8",
    )
    await databaseClient.database.transaction(async (transaction) => {
      await transaction.insert(skillWorkspaces).values({
        id: workspaceId,
        name: `Evals integration ${workspaceId}`,
      })
      await transaction.insert(skillSnapshots).values({
        id: snapshotId,
        workspaceId,
        kind: "VERSION",
        state: "READY",
        manifestHash: createHash("sha256")
          .update(
            JSON.stringify([
              {
                path: "SKILL.md",
                sha256: skillHash,
                byteSize: Buffer.byteLength(skillContent),
                mediaTypeHint: "text/markdown",
                contentKind: "text",
              },
            ]),
          )
          .digest("hex"),
        storageLocator: `snapshots/${snapshotId}`,
        fileCount: 1,
        totalBytes: Buffer.byteLength(skillContent),
      })
      await transaction.insert(skillSnapshotFiles).values({
        id: randomUUID(),
        snapshotId,
        relativePath: "SKILL.md",
        sha256: skillHash,
        byteSize: Buffer.byteLength(skillContent),
        mediaTypeHint: "text/markdown",
        contentKind: "text",
      })
      await transaction.insert(skillVersions).values({
        id: versionId,
        workspaceId,
        snapshotId,
        sequenceNumber: 1,
        name: "V1",
        labels: [],
        sourceType: "folder",
        sourceName: "sample-skill",
      })
      await transaction
        .update(skillWorkspaces)
        .set({
          currentOnlineVersionId: versionId,
          comparisonBaselineVersionId: versionId,
        })
        .where(eq(skillWorkspaces.id, workspaceId))
    })
    await closeDatabaseClient(databaseClient)

    const agentRuntimeAdapter = new EvalsFakeAdapter()
    const application = await buildApplication({
      config: {
        nodeEnvironment: "test",
        host: "127.0.0.1",
        port: 3000,
        databaseUrl: testDatabaseUrl,
        logLevel: "silent",
        openApiEnabled: false,
        dataRoot,
        claudeSettingsPath: settingsPath,
        agentPromptsRoot: path.resolve("agent-prompts"),
        uploadFolderIgnoreConfigPath: folderIgnorePolicyPath,
        uploadLimits: {
          maxFiles: 100,
          maxFileBytes: 1024 * 1024,
          maxTotalBytes: 10 * 1024 * 1024,
          maxDirectoryDepth: 16,
          maxPathLength: 512,
          maxZipBytes: 5 * 1024 * 1024,
          maxZipCompressionRatio: 100,
        },
      },
      logger: false,
      agentRuntimeAdapter,
    })
    const address = await application.listen({
      host: "127.0.0.1",
      port: 0,
    })

    try {
      const startResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/eval-generations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "fake-loop-1",
          },
          body: JSON.stringify({
            target: { kind: "version", versionId },
            maxEvalCount: 3,
          }),
        },
      )
      assert.equal(startResponse.status, 202)
      const started =
        (await startResponse.json()) as EvalGenerationTaskView
      const terminal = await waitForTerminal(address, started.id)
      assert.equal(terminal.status, "SUCCEEDED")
      assert.equal(terminal.error, null)
      assert.equal(
        agentRuntimeAdapter.opens[0]?.systemPrompt?.includes(
          "exact absolute path",
        ),
        true,
      )
      assert.equal(
        await readFile(
          path.join(
            agentRuntimeAdapter.opens[0]!.cwd,
            ".claude",
            "settings.json",
          ),
          "utf8",
        ),
        await readFile(settingsPath, "utf8"),
      )
      const taskPath = path.join(
        agentRuntimeAdapter.opens[0]!.cwd,
        "inputs",
        "task.json",
      )
      const task = JSON.parse(
        await readFile(taskPath, "utf8"),
      ) as Readonly<Record<string, unknown>>
      assert.equal(task.schemaVersion, "eval-generation-task.v1")
      assert.equal(task.targetSkillPath, path.join(
        agentRuntimeAdapter.opens[0]!.cwd,
        "target-skill",
        "sample-skill",
      ))
      assert.equal(task.outputEvalsPath, path.join(
        agentRuntimeAdapter.opens[0]!.cwd,
        "output",
        "evals.json",
      ))
      assert.equal(task.outputFilesPath, path.join(
        agentRuntimeAdapter.opens[0]!.cwd,
        "output",
        "files",
      ))
      assert.equal(
        agentRuntimeAdapter.opens[0]!.prompt.includes(
          JSON.stringify(taskPath),
        ),
        true,
      )

      const draftResponse = await fetch(
        `${address}/api/eval-generations/${started.id}/draft`,
      )
      assert.equal(draftResponse.status, 200)
      const draft =
        (await draftResponse.json()) as EvalGenerationDraftView
      assert.equal(draft.sourceSchemaVariant, "expectations")
      assert.deepEqual(draft.cases[0]?.assertions, [
        "摘要包含 controlled fixture 的核心含义",
      ])
      assert.equal(draft.files[0]?.relativePath, "files/fixture.txt")

      const firstPublish = await fetch(
        `${address}/api/eval-generations/${started.id}/publish`,
        { method: "POST" },
      )
      assert.equal(firstPublish.status, 201)
      const published =
        (await firstPublish.json()) as PublishEvalRevisionResult
      assert.equal(published.replayed, false)
      const replayPublish = await fetch(
        `${address}/api/eval-generations/${started.id}/publish`,
        { method: "POST" },
      )
      assert.equal(replayPublish.status, 200)
      const replayed =
        (await replayPublish.json()) as PublishEvalRevisionResult
      assert.equal(replayed.replayed, true)
      assert.equal(replayed.revision.id, published.revision.id)

      const revisionRoot = path.join(
        dataRoot,
        "eval-suites",
        published.revision.suiteId,
        "revisions",
        published.revision.id,
      )
      assert.equal(
        JSON.parse(await readFile(path.join(revisionRoot, "evals.json"), "utf8"))
          .evals.length,
        1,
      )
      await access(path.join(revisionRoot, "files", "fixture.txt"))
      await assert.rejects(() =>
        access(
          path.join(
            dataRoot,
            "eval-generations",
            started.id,
            "workspace",
            ".claude",
            "settings.json",
          ),
        ),
      )
    } finally {
      await application.close()
      const cleanupClient = createDatabaseClient(testDatabaseUrl, {
        applicationName: "skillconsole-eval-loop-cleanup",
        maxConnections: 1,
      })
      await cleanupClient.database
        .delete(skillWorkspaces)
        .where(eq(skillWorkspaces.id, workspaceId))
      await closeDatabaseClient(cleanupClient)
      await rm(dataRoot, { recursive: true, force: true })
    }
  },
)
