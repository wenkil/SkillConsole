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
  skillTestRunEvents,
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
import type { TestRunDetailView } from "../src/modules/test-runs/test-run.domain.js"

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()
const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
)
const folderIgnorePolicyPath = fileURLToPath(
  new URL("../config/upload-folder-ignore.json", import.meta.url),
)

interface ExecutionObservation {
  readonly cwd: string
  readonly hasInstalledSkill: boolean
  readonly inputContent: string
}

class TestRunFakeRuntime implements AgentRuntimeSession {
  private closed = false

  constructor(
    private readonly input: OpenAgentRuntimeSessionInput,
    private readonly observations: ExecutionObservation[],
  ) {}

  async send(turn: RuntimeTurnInput): Promise<void> {
    if (this.closed) throw new Error("Fake test run runtime is closed.")
    await this.input.onEvent(null, {
      type: "initialized",
      sdkSessionId: randomUUID(),
    })

    let responseText: string
    if (this.input.cwd.includes(`${path.sep}eval-generations${path.sep}`)) {
      responseText = await this.generateEvals()
    } else if (this.input.allowedTools?.length === 0) {
      responseText = JSON.stringify({
        assertions: [
          {
            index: 0,
            status: "PASSED",
            reason: "The final output and Artifact contain the fixture summary.",
            evidence: [
              {
                source: "artifact",
                reference: "summary.txt",
                excerpt: "controlled fixture",
              },
            ],
          },
        ],
      })
    } else {
      responseText = await this.executeCase()
    }

    await this.input.onEvent(turn.turnId, {
      type: "assistant_message",
      messageId: randomUUID(),
      content: [{ type: "text", text: responseText }],
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

  private async generateEvals(): Promise<string> {
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
        skill_name: "sample-skill",
        evals: [
          {
            id: 1,
            name: "summarize-fixture",
            prompt: "Summarize the attached fixture.",
            expected_output: "A concise and accurate summary.",
            assertions: [
              "The response contains the controlled fixture summary.",
            ],
            files: ["files/fixture.txt"],
          },
        ],
      }),
      "utf8",
    )
    return "Generated one Evals case."
  }

  private async executeCase(): Promise<string> {
    const skillPath = path.join(
      this.input.cwd,
      ".claude",
      "skills",
      "sample-skill",
      "SKILL.md",
    )
    let hasInstalledSkill = true
    try {
      await access(skillPath)
    } catch {
      hasInstalledSkill = false
    }
    const inputContent = await readFile(
      path.join(this.input.cwd, "inputs", "files", "fixture.txt"),
      "utf8",
    )
    this.observations.push({
      cwd: this.input.cwd,
      hasInstalledSkill,
      inputContent,
    })
    await writeFile(
      path.join(this.input.cwd, "outputs", "summary.txt"),
      `${inputContent} summarized`,
      "utf8",
    )
    return "Created outputs/summary.txt with the controlled fixture summary."
  }
}

class TestRunFakeAdapter implements AgentRuntimeAdapter {
  readonly opens: OpenAgentRuntimeSessionInput[] = []
  readonly executions: ExecutionObservation[] = []

  open(input: OpenAgentRuntimeSessionInput): AgentRuntimeSession {
    this.opens.push(input)
    return new TestRunFakeRuntime(input, this.executions)
  }
}

async function waitForEvalTerminal(
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

async function waitForRunTerminal(
  baseUrl: string,
  runId: string,
): Promise<TestRunDetailView> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/test-runs/${runId}`)
    assert.equal(response.status, 200)
    const run = (await response.json()) as TestRunDetailView
    if (
      ["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
        run.status,
      )
    ) {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for the fake test run.")
}

test(
  "executes a published Evals revision against Target and No-Skill Baseline with traceable evidence",
  { skip: !testDatabaseUrl, timeout: 60_000 },
  async () => {
    assert.ok(testDatabaseUrl)
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "skillconsole-test-run-loop-"),
    )
    const settingsPath = path.join(dataRoot, "settings.json")
    await writeFile(
      settingsPath,
      '{"env":{"ANTHROPIC_API_KEY":"integration-secret"}}',
      "utf8",
    )
    const databaseClient = createDatabaseClient(testDatabaseUrl, {
      applicationName: "skillconsole-test-run-loop-seed",
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
        name: `Test run integration ${workspaceId}`,
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

    const agentRuntimeAdapter = new TestRunFakeAdapter()
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
      const generationResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/eval-generations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "test-run-evals-1",
          },
          body: JSON.stringify({
            target: { kind: "version", versionId },
            maxEvalCount: 3,
          }),
        },
      )
      assert.equal(generationResponse.status, 202)
      const generation =
        (await generationResponse.json()) as EvalGenerationTaskView
      assert.equal(
        (await waitForEvalTerminal(address, generation.id)).status,
        "SUCCEEDED",
      )
      const draftResponse = await fetch(
        `${address}/api/eval-generations/${generation.id}/draft`,
      )
      assert.equal(draftResponse.status, 200)
      const draft =
        (await draftResponse.json()) as EvalGenerationDraftView
      assert.equal(draft.evalCount, 1)
      const publishResponse = await fetch(
        `${address}/api/eval-generations/${generation.id}/publish`,
        { method: "POST" },
      )
      assert.equal(publishResponse.status, 201)
      const published =
        (await publishResponse.json()) as PublishEvalRevisionResult

      const startResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/test-runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "test-run-1",
          },
          body: JSON.stringify({
            skillVersionId: versionId,
            evalRevisionId: published.revision.id,
            mode: "target_vs_no_skill",
          }),
        },
      )
      assert.equal(startResponse.status, 202)
      const started = (await startResponse.json()) as TestRunDetailView
      assert.equal(started.target.evalRevisionId, published.revision.id)
      const terminal = await waitForRunTerminal(address, started.id)

      assert.equal(terminal.status, "COMPLETED")
      assert.equal(terminal.progress.completedCases, 2)
      assert.equal(terminal.cases.length, 2)
      assert.equal(terminal.benchmark?.target.passed, 1)
      assert.equal(terminal.benchmark?.baseline.passed, 1)
      const target = terminal.cases.find((item) => item.side === "TARGET")
      const baseline = terminal.cases.find(
        (item) => item.side === "BASELINE",
      )
      assert.ok(target)
      assert.ok(baseline)
      assert.equal(target.inputFingerprint, baseline.inputFingerprint)
      assert.equal(target.executionStatus, "COMPLETED")
      assert.equal(target.assessmentStatus, "COMPLETED")
      assert.equal(target.assertionResults[0]?.status, "PASSED")
      assert.equal(target.artifacts[0]?.relativePath, "summary.txt")
      assert.deepEqual(
        agentRuntimeAdapter.executions.map((item) => ({
          hasInstalledSkill: item.hasInstalledSkill,
          inputContent: item.inputContent,
        })),
        [
          {
            hasInstalledSkill: true,
            inputContent: "controlled fixture",
          },
          {
            hasInstalledSkill: false,
            inputContent: "controlled fixture",
          },
        ],
      )
      const graderOpens = agentRuntimeAdapter.opens.filter(
        (item) => item.allowedTools?.length === 0,
      )
      assert.equal(graderOpens.length, 2)

      const artifact = target.artifacts[0]
      assert.ok(artifact)
      const artifactResponse = await fetch(
        `${address}${artifact.downloadUrl}`,
      )
      assert.equal(artifactResponse.status, 200)
      assert.equal(
        await artifactResponse.text(),
        "controlled fixture summarized",
      )

      const inspectionClient = createDatabaseClient(testDatabaseUrl, {
        applicationName: "skillconsole-test-run-loop-inspect",
        maxConnections: 1,
      })
      const events = await inspectionClient.database
        .select()
        .from(skillTestRunEvents)
        .where(eq(skillTestRunEvents.runId, terminal.id))
      await closeDatabaseClient(inspectionClient)
      assert.ok(events.some((event) => event.type === "run.completed"))
      assert.ok(
        events.some(
          (event) =>
            event.type === "agent.execution.assistant.message",
        ),
      )
      assert.equal(
        JSON.stringify(events).includes("integration-secret"),
        false,
      )

      for (const runCase of terminal.cases) {
        const caseRoot = path.join(
          dataRoot,
          "test-runs",
          terminal.id,
          "cases",
          runCase.id,
        )
        await assert.rejects(() =>
          access(
            path.join(
              caseRoot,
              "workspace",
              ".claude",
              "settings.json",
            ),
          ),
        )
        await assert.rejects(() =>
          access(
            path.join(
              caseRoot,
              "grading",
              ".claude",
              "settings.json",
            ),
          ),
        )
      }
    } finally {
      await application.close()
      const cleanupClient = createDatabaseClient(testDatabaseUrl, {
        applicationName: "skillconsole-test-run-loop-cleanup",
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
