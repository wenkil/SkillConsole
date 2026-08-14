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

import { eq, inArray } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"

import { buildApplication } from "../src/app.js"
import {
  closeDatabaseClient,
  createDatabaseClient,
  evalGenerationTasks,
  evalRevisions,
  evalSuites,
  skillDraftFiles,
  skillDrafts,
  skillSnapshots,
  skillTestReportAnalyses,
  skillTestReports,
  skillTestReportRevisions,
  skillTestRunEvents,
  skillTestRuns,
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
import { recordFakeNativeTurn } from "./fake-native-agent-log.js"

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
  readonly snapshotMarker: string
}

type FakeSessionPhase = "eval_generation" | "execution" | "grading"

interface SessionObservation {
  readonly phase: FakeSessionPhase
  readonly cwd: string
  readonly externalId: number | null
  readonly snapshotMarker: string | null
}

interface PlannedSessionFailure {
  readonly phase: "execution" | "grading"
  readonly externalId: number
  readonly snapshotMarker: string
}

interface DeferredExecution {
  readonly blocked: Promise<void>
  readonly release: () => void
}

function externalIdFromPrompt(prompt: string): number | null {
  const match = /case (\d+)/iu.exec(prompt)
  return match ? Number(match[1]) : null
}

function snapshotMarkerFromContent(content: string): string {
  return /Snapshot marker:\s*([\w-]+)/iu.exec(content)?.[1] ?? "unknown"
}

function snapshotMarkerFromPrompt(prompt: string): string | null {
  return /snapshot=([\w-]+)/iu.exec(prompt)?.[1] ?? null
}

class TestRunFakeRuntime implements AgentRuntimeSession {
  private closed = false
  private turnId: string | null = null
  private readonly sdkSessionId = randomUUID()

  constructor(
    private readonly input: OpenAgentRuntimeSessionInput,
    private readonly adapter: TestRunFakeAdapter,
  ) {}

  async send(turn: RuntimeTurnInput): Promise<void> {
    if (this.closed) throw new Error("Fake test run runtime is closed.")
    this.turnId = turn.turnId
    this.adapter.beginSend()
    try {
      await this.input.onEvent(null, {
        type: "initialized",
        sdkSessionId: this.sdkSessionId,
        model: "claude-fake-test-run",
        tools: ["Read", "Write", "Edit", "Skill", "Bash"],
        skills: ["skill-creator"],
        mcpServers: [],
      })

      const phase: FakeSessionPhase = this.input.cwd.includes(
        `${path.sep}eval-generations${path.sep}`,
      )
        ? "eval_generation"
        : this.input.cwd.endsWith(`${path.sep}grading`)
          ? "grading"
          : "execution"
      const taskFacts =
        phase === "execution"
          ? await this.readExecutionTaskFacts()
          : phase === "grading"
            ? await this.readGradingTaskFacts()
            : { externalId: null, snapshotMarker: null }
      const externalId = taskFacts.externalId
      const executionFacts =
        phase === "execution" ? await this.inspectExecution() : null
      const snapshotMarker =
        executionFacts?.snapshotMarker ??
        taskFacts.snapshotMarker
      this.adapter.observeSession({
        phase,
        cwd: this.input.cwd,
        externalId,
        snapshotMarker,
      })

      if (phase === "execution" && (await this.adapter.maybeDeferExecution())) {
        return
      }

      if (
        externalId !== null &&
        snapshotMarker !== null &&
        this.adapter.consumeFailure({
          phase: phase === "grading" ? "grading" : "execution",
          externalId,
          snapshotMarker,
        })
      ) {
        await this.emitResult(turn.turnId, false)
        return
      }

      let responseText: string
      if (phase === "eval_generation") {
        responseText = await this.generateEvals()
      } else if (phase === "grading") {
        const grading = JSON.stringify({
          assertions: [
            {
              index: 0,
              status: "PASSED",
              reason:
                "The final output and Artifact contain the fixture summary.",
              evidence: [
                {
                  source: "artifact",
                  reference: "summary.txt",
                  startLine: 1,
                  endLine: 1,
                },
              ],
            },
          ],
        })
        await writeFile(
          path.join(this.input.cwd, "outputs", "grading.json"),
          `${grading}\n`,
          "utf8",
        )
        responseText = "Wrote outputs/grading.json."
      } else {
        assert.ok(executionFacts)
        responseText = await this.executeCase(executionFacts)
      }

      await this.input.onEvent(turn.turnId, {
        type: "assistant_message",
        messageId: randomUUID(),
        content: [{ type: "text", text: responseText }],
      })
      await this.emitResult(turn.turnId, true)
    } finally {
      this.adapter.endSend()
    }
  }

  async interrupt(): Promise<void> {
    this.adapter.interruptCount += 1
    assert.ok(this.turnId)
    await this.emitResult(this.turnId, false)
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
        evals: [1, 2, 3].map((id) => ({
          id,
          name: `summarize-fixture-${id}`,
          prompt: `Summarize the attached fixture, case ${id}.`,
          expected_output: "A concise and accurate summary.",
          assertions: [
            "The response contains the controlled fixture summary.",
          ],
          files: ["files/fixture.txt"],
        })),
      }),
      "utf8",
    )
    return "Generated three Evals cases."
  }

  private async inspectExecution(): Promise<{
    readonly hasInstalledSkill: boolean
    readonly inputContent: string
    readonly snapshotMarker: string
  }> {
    assert.match(
      await readFile(
        path.join(this.input.cwd, ".claude", "settings.json"),
        "utf8",
      ),
      /ANTHROPIC_API_KEY/,
    )
    const skillPath = path.join(
      this.input.cwd,
      ".claude",
      "skills",
      "sample-skill",
      "SKILL.md",
    )
    let hasInstalledSkill = true
    let snapshotMarker = "no-skill"
    try {
      snapshotMarker = snapshotMarkerFromContent(
        await readFile(skillPath, "utf8"),
      )
    } catch {
      hasInstalledSkill = false
    }
    const inputContent = await readFile(
      path.join(this.input.cwd, "inputs", "files", "fixture.txt"),
      "utf8",
    )
    return { hasInstalledSkill, inputContent, snapshotMarker }
  }

  private async readExecutionTaskFacts(): Promise<{
    readonly externalId: number | null
    readonly snapshotMarker: null
  }> {
    const task = JSON.parse(
      await readFile(
        path.join(this.input.cwd, "inputs", "task.json"),
        "utf8",
      ),
    ) as { readonly userTask?: string }
    return {
      externalId: externalIdFromPrompt(task.userTask ?? ""),
      snapshotMarker: null,
    }
  }

  private async readGradingTaskFacts(): Promise<{
    readonly externalId: number | null
    readonly snapshotMarker: string | null
  }> {
    const testCase = JSON.parse(
      await readFile(
        path.join(this.input.cwd, "inputs", "test-case.json"),
        "utf8",
      ),
    ) as { readonly userPrompt?: string }
    const finalOutput = await readFile(
      path.join(this.input.cwd, "inputs", "executor-final-output.txt"),
      "utf8",
    )
    return {
      externalId: externalIdFromPrompt(testCase.userPrompt ?? ""),
      snapshotMarker: snapshotMarkerFromPrompt(finalOutput),
    }
  }

  private async executeCase(input: {
    readonly hasInstalledSkill: boolean
    readonly inputContent: string
    readonly snapshotMarker: string
  }): Promise<string> {
    this.adapter.executions.push({
      cwd: this.input.cwd,
      ...input,
    })
    await writeFile(
      path.join(this.input.cwd, "outputs", "summary.txt"),
      `${input.inputContent} summarized | snapshot=${input.snapshotMarker}`,
      "utf8",
    )
    return `Created outputs/summary.txt with the controlled fixture summary | snapshot=${input.snapshotMarker}.`
  }

  private async emitResult(turnId: string, success: boolean): Promise<void> {
    await recordFakeNativeTurn(
      this.input,
      this.sdkSessionId,
      turnId,
      success,
    )
    await this.input.onEvent(turnId, {
      type: "turn_result",
      success,
      subtype: success ? "success" : "error_during_execution",
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
      error: success
        ? null
        : {
            code: "CLAUDE_EXECUTION_FAILED",
            message: "Injected fake runtime failure.",
          },
    })
  }
}

class TestRunFakeAdapter implements AgentRuntimeAdapter {
  readonly opens: OpenAgentRuntimeSessionInput[] = []
  readonly executions: ExecutionObservation[] = []
  readonly sessions: SessionObservation[] = []
  readonly failures: PlannedSessionFailure[] = []
  activeSends = 0
  maxActiveSends = 0
  interruptCount = 0
  private deferredExecution:
    | {
        readonly blocked: Promise<void>
        readonly markBlocked: () => void
        readonly released: Promise<void>
        readonly release: () => void
      }
    | null = null

  open(input: OpenAgentRuntimeSessionInput): AgentRuntimeSession {
    this.opens.push(input)
    return new TestRunFakeRuntime(input, this)
  }

  beginSend(): void {
    this.activeSends += 1
    this.maxActiveSends = Math.max(this.maxActiveSends, this.activeSends)
  }

  endSend(): void {
    this.activeSends -= 1
  }

  observeSession(observation: SessionObservation): void {
    this.sessions.push(observation)
  }

  planFailure(failure: PlannedSessionFailure): void {
    this.failures.push(failure)
  }

  consumeFailure(failure: PlannedSessionFailure): boolean {
    const index = this.failures.findIndex(
      (item) =>
        item.phase === failure.phase &&
        item.externalId === failure.externalId &&
        item.snapshotMarker === failure.snapshotMarker,
    )
    if (index < 0) return false
    this.failures.splice(index, 1)
    return true
  }

  deferNextExecution(): DeferredExecution {
    assert.equal(this.deferredExecution, null)
    let markBlocked!: () => void
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      markBlocked = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    this.deferredExecution = {
      blocked,
      markBlocked,
      released,
      release,
    }
    return { blocked, release }
  }

  async maybeDeferExecution(): Promise<boolean> {
    const control = this.deferredExecution
    if (!control) return false
    this.deferredExecution = null
    control.markBlocked()
    await control.released
    return true
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

async function waitForSignal(signal: Promise<void>, label: string): Promise<void> {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}.`)),
          2_000,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function assertApiError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  assert.equal(response.status, status)
  const body = (await response.json()) as {
    error: { code: string }
  }
  assert.equal(body.error.code, code)
}

interface TestRunLogItem {
  readonly sequence: number
  readonly type: string
  readonly caseId: string | null
}

async function readAllLogs(
  baseUrl: string,
  runId: string,
  query = "",
): Promise<readonly TestRunLogItem[]> {
  const items: TestRunLogItem[] = []
  let beforeSequence: number | null = null
  for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
    const parameters = new URLSearchParams(query)
    parameters.set("limit", "3")
    if (beforeSequence !== null) {
      parameters.set("beforeSequence", String(beforeSequence))
    }
    const response = await fetch(
      `${baseUrl}/api/test-runs/${runId}/logs?${parameters}`,
    )
    assert.equal(response.status, 200)
    const page = (await response.json()) as {
      items: TestRunLogItem[]
      pagination: {
        hasMore: boolean
        nextBeforeSequence: number | null
      }
    }
    items.push(...page.items)
    if (!page.pagination.hasMore) break
    assert.ok(page.pagination.nextBeforeSequence)
    beforeSequence = page.pagination.nextBeforeSequence
  }
  return items
}

async function readSseBacklogSequences(
  baseUrl: string,
  runId: string,
  afterSequence: number,
  expectedCount: number,
): Promise<readonly number[]> {
  const controller = new AbortController()
  const response = await fetch(
    `${baseUrl}/api/test-runs/${runId}/events?afterSequence=${afterSequence}`,
    { signal: controller.signal },
  )
  assert.equal(response.status, 200)
  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sequences: number[] = []
  let buffer = ""
  let timeout: NodeJS.Timeout | undefined
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Timed out reading the test run SSE backlog.")),
        2_000,
      )
    })
    while (sequences.length < expectedCount) {
      const result = await Promise.race([reader.read(), deadline])
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const id = /^id:\s*(\d+)$/mu.exec(block)
        if (id) sequences.push(Number(id[1]))
        boundary = buffer.indexOf("\n\n")
      }
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    await reader.cancel()
    controller.abort()
  }
  return sequences
}

test(
  "runs both test modes with paired isolation, failure continuation, cancellation, and resumable logs",
  { skip: !testDatabaseUrl, timeout: 90_000 },
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
    const draftId = randomUUID()
    const otherWorkspaceId = randomUUID()
    const otherDraftId = randomUUID()
    const lifecycleAnalysisId = randomUUID()
    const skillContent =
      "---\nname: sample-skill\ndescription: Test Skill\n---\n\nSnapshot marker: baseline-v1\n"
    const candidateSkillContent =
      "---\nname: sample-skill\ndescription: Test Skill\n---\n\nSnapshot marker: candidate-v2\n"
    const capabilitySkillContent =
      "---\nname: sample-skill\ndescription: Test Skill\n---\n\nSnapshot marker: capability-v3\nUse Python for the capability workflow.\n"
    const otherSkillContent =
      "---\nname: sample-skill\ndescription: Other workspace Skill\n---\n\nSnapshot marker: other-workspace-v1\n"
    const skillHash = createHash("sha256")
      .update(skillContent)
      .digest("hex")
    const otherSkillHash = createHash("sha256")
      .update(otherSkillContent)
      .digest("hex")
    await mkdir(
      path.join(dataRoot, "drafts", draftId, "files"),
      { recursive: true },
    )
    await writeFile(
      path.join(
        dataRoot,
        "drafts",
        draftId,
        "files",
        "SKILL.md",
      ),
      skillContent,
      "utf8",
    )
    await mkdir(
      path.join(dataRoot, "drafts", otherDraftId, "files"),
      { recursive: true },
    )
    await writeFile(
      path.join(
        dataRoot,
        "drafts",
        otherDraftId,
        "files",
        "SKILL.md",
      ),
      otherSkillContent,
      "utf8",
    )
    await databaseClient.database.transaction(async (transaction) => {
      await transaction.insert(skillWorkspaces).values([
        {
          id: workspaceId,
          name: `Test run integration ${workspaceId}`,
        },
        {
          id: otherWorkspaceId,
          name: `Test run integration ${otherWorkspaceId}`,
        },
      ])
      await transaction.insert(skillDrafts).values([
        {
          id: draftId,
          workspaceId,
          baseVersionId: null,
          baseSnapshotId: null,
          currentSnapshotId: null,
          workingStorageLocator: `drafts/${draftId}`,
          fileCount: 1,
          totalBytes: Buffer.byteLength(skillContent),
          status: "OPEN",
          contentRevision: 1,
          sourceType: "folder",
          sourceName: "sample-skill",
          ignoreRules: [],
          currentIgnoredPaths: [],
        },
        {
          id: otherDraftId,
          workspaceId: otherWorkspaceId,
          baseVersionId: null,
          baseSnapshotId: null,
          currentSnapshotId: null,
          workingStorageLocator: `drafts/${otherDraftId}`,
          fileCount: 1,
          totalBytes: Buffer.byteLength(otherSkillContent),
          status: "OPEN",
          contentRevision: 1,
          sourceType: "folder",
          sourceName: "sample-skill",
          ignoreRules: [],
          currentIgnoredPaths: [],
        },
      ])
      await transaction.insert(skillDraftFiles).values([
        {
          id: randomUUID(),
          draftId,
          relativePath: "SKILL.md",
          sha256: skillHash,
          byteSize: Buffer.byteLength(skillContent),
          mediaTypeHint: "text/markdown",
          contentKind: "text",
        },
        {
          id: randomUUID(),
          draftId: otherDraftId,
          relativePath: "SKILL.md",
          sha256: otherSkillHash,
          byteSize: Buffer.byteLength(otherSkillContent),
          mediaTypeHint: "text/markdown",
          contentKind: "text",
        },
      ])
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
      const generationResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/eval-generations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "test-run-evals-1",
          },
          body: JSON.stringify({
            target: { kind: "draft", draftId, contentRevision: 1 },
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
      assert.equal(draft.evalCount, 3)
      const publishResponse = await fetch(
        `${address}/api/eval-generations/${generation.id}/publish`,
        { method: "POST" },
      )
      assert.equal(publishResponse.status, 201)
      const published =
        (await publishResponse.json()) as PublishEvalRevisionResult

      const targetExecutionStart = agentRuntimeAdapter.executions.length
      const startResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/test-runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "test-run-1",
          },
          body: JSON.stringify({
            draftId,
            draftContentRevision: 1,
            evalRevisionId: published.revision.id,
            mode: "target_vs_no_skill",
          }),
        },
      )
      assert.equal(startResponse.status, 202)
      const started = (await startResponse.json()) as TestRunDetailView
      assert.equal(started.target.evalRevisionId, published.revision.id)
      assert.equal(started.target.draftId, draftId)
      assert.equal(started.target.draftContentRevision, 1)
      assert.equal(started.target.skillVersionId, null)
      const terminal = await waitForRunTerminal(address, started.id)

      assert.equal(terminal.status, "COMPLETED")
      assert.equal(terminal.progress.completedCases, 6)
      assert.equal(terminal.cases.length, 6)
      assert.equal(terminal.benchmark?.target.passed, 3)
      assert.equal(terminal.benchmark?.baseline.passed, 3)
      let automaticallyGeneratedReport:
        | { readonly status: string; readonly currentRevisionId: string | null }
        | undefined
      for (let attempt = 0; attempt < 100; attempt += 1) {
        ;[automaticallyGeneratedReport] =
          await application.databaseClient.database
            .select({
              status: skillTestReports.status,
              currentRevisionId: skillTestReports.currentRevisionId,
            })
            .from(skillTestReports)
            .where(eq(skillTestReports.runId, terminal.id))
            .limit(1)
        if (
          automaticallyGeneratedReport &&
          automaticallyGeneratedReport.status !== "GENERATION_PENDING"
        ) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(automaticallyGeneratedReport?.status, "AVAILABLE")
      assert.ok(automaticallyGeneratedReport?.currentRevisionId)
      const skillEffectReportResponse = await fetch(
        `${address}/api/test-runs/${terminal.id}/report`,
      )
      assert.equal(skillEffectReportResponse.status, 200)
      const skillEffectReport = (await skillEffectReportResponse.json()) as {
        reportType: string
        status: string
        report: {
          schemaVersion: string
          reportType: string
          cases: unknown[]
          metrics: {
            baseline: { activation: { observedRate: { status: string } } }
          }
        }
      }
      assert.equal(skillEffectReport.reportType, "skill_effect")
      assert.equal(skillEffectReport.status, "AVAILABLE")
      assert.equal(skillEffectReport.report.schemaVersion, "test-report.v1")
      assert.equal(skillEffectReport.report.cases.length, 3)
      assert.equal(
        skillEffectReport.report.metrics.baseline.activation.observedRate.status,
        "NOT_APPLICABLE",
      )
      const targetExecutions = agentRuntimeAdapter.executions.slice(
        targetExecutionStart,
        targetExecutionStart + 6,
      )

      const versionResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "V1", setOnline: false }),
        },
      )
      assert.equal(versionResponse.status, 201)
      const baselineVersion = (await versionResponse.json()) as {
        id: string
        name: string
      }
      const draftUpdateResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/draft/files/text`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "if-match": `"draft-${draftId}-r1"`,
            "idempotency-key": "test-run-draft-update-1",
          },
          body: JSON.stringify({
            path: "SKILL.md",
            content: candidateSkillContent,
          }),
        },
      )
      assert.equal(draftUpdateResponse.status, 200)
      const candidateResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "V2", setOnline: false }),
        },
      )
      assert.equal(candidateResponse.status, 201)
      const candidateVersion = (await candidateResponse.json()) as {
        id: string
        name: string
      }
      const capabilityDraftUpdateResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/draft/files/text`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "if-match": `"draft-${draftId}-r2"`,
            "idempotency-key": "test-run-capability-draft-update-1",
          },
          body: JSON.stringify({
            path: "SKILL.md",
            content: capabilitySkillContent,
          }),
        },
      )
      assert.equal(capabilityDraftUpdateResponse.status, 200)
      const capabilityVersionResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "V3", setOnline: false }),
        },
      )
      assert.equal(capabilityVersionResponse.status, 201)
      const capabilityVersion =
        (await capabilityVersionResponse.json()) as { id: string }
      const otherVersionResponse = await fetch(
        `${address}/api/skill-workspaces/${otherWorkspaceId}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Other V1", setOnline: false }),
        },
      )
      assert.equal(otherVersionResponse.status, 201)
      const otherVersion = (await otherVersionResponse.json()) as {
        id: string
      }
      const refreshedResponse = await fetch(
        `${address}/api/test-runs/${terminal.id}`,
      )
      assert.equal(refreshedResponse.status, 200)
      const refreshed =
        (await refreshedResponse.json()) as TestRunDetailView
      assert.equal(refreshed.target.skillVersionId, baselineVersion.id)
      assert.equal(refreshed.target.skillVersionName, "V1")
      assert.equal(refreshed.target.draftContentRevision, 1)

      const requestComparison = (input: {
        readonly idempotencyKey: string
        readonly baselineVersionId?: string
        readonly candidateVersionId?: string
        readonly evalRevisionId?: string
      }): Promise<Response> =>
        fetch(
          `${address}/api/skill-workspaces/${workspaceId}/test-runs`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": input.idempotencyKey,
            },
            body: JSON.stringify({
              mode: "version_vs_version",
              baselineVersionId:
                input.baselineVersionId ?? baselineVersion.id,
              candidateVersionId:
                input.candidateVersionId ?? candidateVersion.id,
              evalRevisionId:
                input.evalRevisionId ?? published.revision.id,
            }),
          },
        )

      const startComparison = async (
        idempotencyKey: string,
        input: {
          readonly baselineVersionId?: string
          readonly candidateVersionId?: string
        } = {},
      ): Promise<TestRunDetailView> => {
        const response = await requestComparison({
          idempotencyKey,
          ...input,
        })
        assert.equal(response.status, 202)
        return (await response.json()) as TestRunDetailView
      }

      const rejectedSelectionSessionCount =
        agentRuntimeAdapter.sessions.length
      await assertApiError(
        await requestComparison({
          idempotencyKey: "test-run-same-version",
          baselineVersionId: baselineVersion.id,
          candidateVersionId: baselineVersion.id,
        }),
        409,
        "TEST_RUN_VERSIONS_MUST_DIFFER",
      )
      await assertApiError(
        await requestComparison({
          idempotencyKey: "test-run-cross-workspace-version",
          baselineVersionId: otherVersion.id,
        }),
        404,
        "TEST_RUN_SELECTION_NOT_FOUND",
      )
      await assertApiError(
        await requestComparison({
          idempotencyKey: "test-run-invalid-evals",
          evalRevisionId: randomUUID(),
        }),
        404,
        "TEST_RUN_SELECTION_NOT_FOUND",
      )

      const snapshotClient = createDatabaseClient(testDatabaseUrl, {
        applicationName: "skillconsole-test-run-snapshot-state",
        maxConnections: 1,
      })
      const [candidateSnapshot] = await snapshotClient.database
        .select({ snapshotId: skillVersions.snapshotId })
        .from(skillVersions)
        .where(eq(skillVersions.id, candidateVersion.id))
        .limit(1)
      assert.ok(candidateSnapshot)
      await snapshotClient.database
        .update(skillSnapshots)
        .set({ state: "STAGING" })
        .where(eq(skillSnapshots.id, candidateSnapshot.snapshotId))
      try {
        await assertApiError(
          await requestComparison({
            idempotencyKey: "test-run-non-ready-snapshot",
          }),
          409,
          "TEST_RUN_SKILL_SNAPSHOT_NOT_READY",
        )
      } finally {
        await snapshotClient.database
          .update(skillSnapshots)
          .set({ state: "READY" })
          .where(eq(skillSnapshots.id, candidateSnapshot.snapshotId))
        await closeDatabaseClient(snapshotClient)
      }
      assert.equal(
        agentRuntimeAdapter.sessions.length,
        rejectedSelectionSessionCount,
      )

      const missingCapabilitySessionCount =
        agentRuntimeAdapter.sessions.length
      const originalPath = process.env.PATH
      let missingCapabilityStarted: TestRunDetailView | null = null
      try {
        process.env.PATH = ""
        missingCapabilityStarted = await startComparison(
          "test-run-missing-runtime-capability",
          { candidateVersionId: capabilityVersion.id },
        )
      } finally {
        if (originalPath === undefined) delete process.env.PATH
        else process.env.PATH = originalPath
      }
      assert.ok(missingCapabilityStarted)
      const missingCapabilityRun = await waitForRunTerminal(
        address,
        missingCapabilityStarted.id,
      )
      assert.equal(missingCapabilityRun.status, "FAILED")
      assert.equal(
        missingCapabilityRun.error?.code,
        "TEST_RUN_RUNTIME_CAPABILITY_MISSING",
      )
      assert.equal(
        agentRuntimeAdapter.sessions.length,
        missingCapabilitySessionCount,
      )
      const missingCapabilityLogs = await readAllLogs(
        address,
        missingCapabilityRun.id,
        "phase=orchestration",
      )
      assert.equal(
        missingCapabilityLogs.some(
          (event) => event.type === "run.preflight.failed",
        ),
        true,
      )
      const missingCapabilityReportResponse = await fetch(
        `${address}/api/test-runs/${missingCapabilityRun.id}/report`,
      )
      assert.equal(missingCapabilityReportResponse.status, 200)
      const missingCapabilityReport =
        (await missingCapabilityReportResponse.json()) as {
          status: string
          report: {
            run: {
              runStatus: string
              terminalError: { code: string } | null
            }
          }
        }
      assert.equal(missingCapabilityReport.status, "PARTIAL")
      assert.equal(missingCapabilityReport.report.run.runStatus, "FAILED")
      assert.equal(
        missingCapabilityReport.report.run.terminalError?.code,
        "TEST_RUN_RUNTIME_CAPABILITY_MISSING",
      )

      const comparisonSessionStart = agentRuntimeAdapter.sessions.length
      const comparisonExecutionStart =
        agentRuntimeAdapter.executions.length
      const comparisonStarted = await startComparison(
        "test-run-version-comparison-1",
      )
      const comparison = await waitForRunTerminal(
        address,
        comparisonStarted.id,
      )
      const replayResponse = await requestComparison({
        idempotencyKey: "test-run-version-comparison-1",
      })
      assert.equal(replayResponse.status, 202)
      const replay = (await replayResponse.json()) as TestRunDetailView
      assert.equal(replay.id, comparison.id)
      await assertApiError(
        await requestComparison({
          idempotencyKey: "test-run-version-comparison-1",
          baselineVersionId: candidateVersion.id,
          candidateVersionId: baselineVersion.id,
        }),
        409,
        "TEST_RUN_IDEMPOTENCY_CONFLICT",
      )
      assert.equal(comparison.status, "COMPLETED")
      assert.equal(comparison.mode, "version_vs_version")
      assert.equal(comparison.executionPolicy, "paired_serial_alternating_v1")
      assert.equal(comparison.target.skillVersionId, candidateVersion.id)
      assert.equal(comparison.baseline.kind, "skill_version")
      assert.equal(
        comparison.baseline.kind === "skill_version"
          ? comparison.baseline.skillVersionId
          : null,
        baselineVersion.id,
      )
      assert.deepEqual(
        comparison.cases.map((runCase) => runCase.side),
        [
          "BASELINE",
          "TARGET",
          "TARGET",
          "BASELINE",
          "BASELINE",
          "TARGET",
        ],
      )
      assert.ok(
        comparison.cases.every(
          (runCase) => runCase.executionStatus === "COMPLETED",
        ),
      )
      assert.deepEqual(
        [1, 2, 3].map((externalId) => {
          const pair = comparison.cases.filter(
            (runCase) => runCase.externalId === externalId,
          )
          return pair[0]?.inputFingerprint === pair[1]?.inputFingerprint
        }),
        [true, true, true],
      )
      const comparisonExecutions = agentRuntimeAdapter.executions.slice(
        comparisonExecutionStart,
        comparisonExecutionStart + 6,
      )
      assert.equal(
        comparisonExecutions.every((item) => item.hasInstalledSkill),
        true,
      )
      assert.deepEqual(
        comparisonExecutions.map((item) => item.snapshotMarker),
        [
          "baseline-v1",
          "candidate-v2",
          "candidate-v2",
          "baseline-v1",
          "baseline-v1",
          "candidate-v2",
        ],
      )
      assert.equal(
        new Set(comparisonExecutions.map((item) => item.cwd)).size,
        6,
      )
      const comparisonSessions = agentRuntimeAdapter.sessions.slice(
        comparisonSessionStart,
        comparisonSessionStart + 12,
      )
      assert.deepEqual(
        comparisonSessions.map((item) => item.phase),
        Array.from({ length: 6 }).flatMap(() => [
          "execution",
          "grading",
        ]),
      )
      assert.deepEqual(
        comparisonSessions.map((item) => item.externalId),
        [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
      )
      assert.deepEqual(
        comparisonSessions.map((item) => item.snapshotMarker),
        [
          "baseline-v1",
          "baseline-v1",
          "candidate-v2",
          "candidate-v2",
          "candidate-v2",
          "candidate-v2",
          "baseline-v1",
          "baseline-v1",
          "baseline-v1",
          "baseline-v1",
          "candidate-v2",
          "candidate-v2",
        ],
      )
      assert.equal(
        comparisonSessions.every((item, index) =>
          index % 2 === 0
            ? item.cwd.endsWith(`${path.sep}workspace`)
            : item.cwd.endsWith(`${path.sep}grading`),
        ),
        true,
      )
      assert.equal(agentRuntimeAdapter.maxActiveSends, 1)

      const comparisonReportResponse = await fetch(
        `${address}/api/test-runs/${comparison.id}/report`,
      )
      assert.equal(comparisonReportResponse.status, 200)
      const comparisonReport = (await comparisonReportResponse.json()) as {
        id: string
        reportType: string
        status: string
        comparabilityStatus: string
        report: {
          reportRevisionId: string
          reportType: string
          cases: Array<{ pairComparability: string }>
          metrics: { delta: unknown }
        }
      }
      assert.equal(comparisonReport.reportType, "version_comparison")
      assert.equal(comparisonReport.status, "AVAILABLE")
      assert.equal(comparisonReport.comparabilityStatus, "COMPARABLE")
      assert.equal(comparisonReport.report.cases.length, 3)
      assert.equal(
        comparisonReport.report.cases.every(
          (item) => item.pairComparability === "COMPARABLE",
        ),
        true,
      )
      assert.notEqual(comparisonReport.report.metrics.delta, null)
      const reportCasesResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/cases?pageSize=2`,
      )
      assert.equal(reportCasesResponse.status, 200)
      const reportCases = (await reportCasesResponse.json()) as {
        items: unknown[]
        pagination: { total: number; pageCount: number }
      }
      assert.equal(reportCases.items.length, 2)
      assert.equal(reportCases.pagination.total, 3)
      assert.equal(reportCases.pagination.pageCount, 2)
      const firstReportCase = comparisonReport.report.cases[0]
      assert.ok(firstReportCase)
      const reportCaseDetailResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/cases/${comparison.cases[0]!.evalRevisionCaseId}`,
      )
      assert.equal(reportCaseDetailResponse.status, 200)
      const reportCaseDetail = (await reportCaseDetailResponse.json()) as {
        summary: { evalRevisionCaseId: string }
        targetCase: { finalOutput: string | null }
        baselineCase: { finalOutput: string | null }
      }
      assert.equal(
        reportCaseDetail.summary.evalRevisionCaseId,
        comparison.cases[0]!.evalRevisionCaseId,
      )
      assert.ok(reportCaseDetail.targetCase.finalOutput)
      assert.ok(reportCaseDetail.baselineCase.finalOutput)
      const regenerateResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/regenerate`,
        {
          method: "POST",
          headers: { "idempotency-key": "comparison-report-regenerate-1" },
        },
      )
      assert.equal(regenerateResponse.status, 200)
      const regeneratedReport = (await regenerateResponse.json()) as {
        currentRevisionId: string
      }
      assert.equal(
        regeneratedReport.currentRevisionId,
        comparisonReport.report.reportRevisionId,
      )
      const reportRevisions = await application.databaseClient.database
        .select({ id: skillTestReportRevisions.id })
        .from(skillTestReportRevisions)
        .where(
          eq(skillTestReportRevisions.reportId, comparisonReport.id),
        )
      assert.equal(reportRevisions.length, 1)
      await application.databaseClient.database
        .update(skillTestReportRevisions)
        .set({ generatorVersion: "test-report-generator-legacy" })
        .where(
          eq(
            skillTestReportRevisions.id,
            comparisonReport.report.reportRevisionId,
          ),
        )
      const upgradedGeneratorResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/regenerate`,
        {
          method: "POST",
          headers: {
            "idempotency-key": "comparison-report-regenerate-generator-v2",
          },
        },
      )
      assert.equal(upgradedGeneratorResponse.status, 200)
      const upgradedGeneratorReport =
        (await upgradedGeneratorResponse.json()) as {
          currentRevisionId: string
          report: { generatorVersion: string; reportRevisionNumber: number }
        }
      assert.notEqual(
        upgradedGeneratorReport.currentRevisionId,
        comparisonReport.report.reportRevisionId,
      )
      assert.equal(upgradedGeneratorReport.report.reportRevisionNumber, 2)
      assert.equal(
        (
          await application.databaseClient.database
            .select({ id: skillTestReportRevisions.id })
            .from(skillTestReportRevisions)
            .where(
              eq(skillTestReportRevisions.reportId, comparisonReport.id),
            )
        ).length,
        2,
      )
      await application.databaseClient.database
        .insert(skillTestReportAnalyses)
        .values({
          id: lifecycleAnalysisId,
          reportId: comparisonReport.id,
          reportRevisionId: upgradedGeneratorReport.currentRevisionId,
          revisionNumber: 1,
          status: "PENDING",
          configuredModelId: "sdk_default",
          actualModelId: null,
          configurationFingerprint: "a".repeat(64),
          semanticConfigurationFingerprint: "b".repeat(64),
          runtimePolicy: {
            schemaVersion: "test-report-analyzer-runtime-policy.v4",
            timeoutMs: 1_800_000,
            cancellationGraceMs: 5_000,
            maxInputCharacters: 500_000,
            capabilitySource: "project_settings",
            promptControlledFileAccess: true,
          },
          runtimePolicyFingerprint: "c".repeat(64),
          promptVersion: "test-report-analyzer-prompt-v1",
          inputFingerprint: "d".repeat(64),
          selectedEvalRevisionCaseIds: [
            comparison.cases[0]!.evalRevisionCaseId,
          ],
          idempotencyKey: `lifecycle-${lifecycleAnalysisId}`,
        })
      const htmlDocumentResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/revisions/${upgradedGeneratorReport.currentRevisionId}/document.html?locale=zh-CN`,
      )
      assert.equal(htmlDocumentResponse.status, 200)
      assert.match(
        htmlDocumentResponse.headers.get("content-type") ?? "",
        /^text\/html/,
      )
      assert.match(
        htmlDocumentResponse.headers.get("content-security-policy") ?? "",
        /default-src 'none'/,
      )
      assert.match(
        htmlDocumentResponse.headers.get("content-disposition") ?? "",
        /^inline/,
      )
      const htmlDocument = await htmlDocumentResponse.text()
      assert.match(htmlDocument, /^<!doctype html>/)
      assert.match(htmlDocument, /逐 Eval 结果/)
      assert.match(htmlDocument, /\?externalId=1/)
      assert.doesNotMatch(htmlDocument, /controlled fixture summarized/)

      const markdownDocumentResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/revisions/${upgradedGeneratorReport.currentRevisionId}/document.md?locale=en`,
      )
      assert.equal(markdownDocumentResponse.status, 200)
      assert.match(
        markdownDocumentResponse.headers.get("content-disposition") ?? "",
        /^attachment/,
      )
      assert.match(await markdownDocumentResponse.text(), /^# /)

      const historicalDocumentResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/revisions/${comparisonReport.report.reportRevisionId}/document.html?locale=en`,
      )
      assert.equal(historicalDocumentResponse.status, 200)
      const jsonDocumentResponse = await fetch(
        `${address}/api/test-reports/${comparisonReport.id}/revisions/${upgradedGeneratorReport.currentRevisionId}/document.json`,
      )
      assert.equal(jsonDocumentResponse.status, 404)
      const reportListResponse = await fetch(
        `${address}/api/skill-workspaces/${workspaceId}/test-reports?reportType=version_comparison`,
      )
      assert.equal(reportListResponse.status, 200)
      const reportList = (await reportListResponse.json()) as {
        items: Array<{ runId: string }>
      }
      assert.equal(
        reportList.items.some((item) => item.runId === comparison.id),
        true,
      )

      for (const runCase of comparison.cases) {
        const artifact = runCase.artifacts[0]
        assert.ok(artifact)
        const response = await fetch(`${address}${artifact.downloadUrl}`)
        assert.equal(response.status, 200)
        const expectedMarker =
          runCase.side === "TARGET" ? "candidate-v2" : "baseline-v1"
        assert.equal(
          await response.text(),
          `controlled fixture summarized | snapshot=${expectedMarker}`,
        )
      }

      const swappedRun = await waitForRunTerminal(
        address,
        (
          await startComparison("test-run-version-comparison-swapped", {
            baselineVersionId: candidateVersion.id,
            candidateVersionId: baselineVersion.id,
          })
        ).id,
      )
      assert.notEqual(swappedRun.id, comparison.id)
      assert.equal(swappedRun.target.skillVersionId, baselineVersion.id)
      assert.equal(swappedRun.baseline.kind, "skill_version")
      assert.equal(
        swappedRun.baseline.kind === "skill_version"
          ? swappedRun.baseline.skillVersionId
          : null,
        candidateVersion.id,
      )
      assert.notEqual(
        swappedRun.traceability.runInputFingerprint,
        comparison.traceability.runInputFingerprint,
      )

      const logsResponse = await fetch(
        `${address}/api/test-runs/${comparison.id}/logs?limit=2&side=TARGET&phase=execution`,
      )
      assert.equal(logsResponse.status, 200)
      const logs = (await logsResponse.json()) as {
        items: Array<{ sequence: number }>
        pagination: {
          hasMore: boolean
          nextBeforeSequence: number | null
        }
      }
      assert.equal(logs.items.length, 2)
      assert.equal(logs.pagination.hasMore, true)
      assert.ok(logs.pagination.nextBeforeSequence)
      const earlierLogsResponse = await fetch(
        `${address}/api/test-runs/${comparison.id}/logs?limit=2&side=TARGET&phase=execution&beforeSequence=${logs.pagination.nextBeforeSequence}`,
      )
      assert.equal(earlierLogsResponse.status, 200)
      const earlierLogs = (await earlierLogsResponse.json()) as {
        items: Array<{ sequence: number }>
      }
      assert.equal(
        earlierLogs.items.some((event) =>
          logs.items.some((item) => item.sequence === event.sequence),
        ),
        false,
      )

      const directAllLogsResponse = await fetch(
        `${address}/api/test-runs/${comparison.id}/logs?limit=200`,
      )
      assert.equal(directAllLogsResponse.status, 200)
      const directAllLogs = (await directAllLogsResponse.json()) as {
        items: TestRunLogItem[]
        pagination: { hasMore: boolean }
      }
      assert.equal(directAllLogs.pagination.hasMore, false)
      const traversedLogs = await readAllLogs(
        address,
        comparison.id,
      )
      const traversedSequences = traversedLogs
        .map((event) => event.sequence)
        .sort((left, right) => left - right)
      assert.equal(
        new Set(traversedSequences).size,
        traversedSequences.length,
      )
      assert.deepEqual(
        traversedSequences,
        directAllLogs.items.map((event) => event.sequence),
      )

      const targetCaseForEval2 = comparison.cases.find(
        (runCase) =>
          runCase.side === "TARGET" && runCase.externalId === 2,
      )
      assert.ok(targetCaseForEval2)
      const filteredLogs = await readAllLogs(
        address,
        comparison.id,
        "side=TARGET&externalId=2&phase=execution",
      )
      assert.ok(filteredLogs.length > 0)
      assert.equal(
        filteredLogs.every(
          (event) =>
            event.caseId === targetCaseForEval2.id &&
            (event.type.startsWith("execution.") ||
              event.type.startsWith("case.execution.")),
        ),
        true,
      )

      const orderedLogSequences = directAllLogs.items.map(
        (event) => event.sequence,
      )
      const afterSequence =
        orderedLogSequences[Math.floor(orderedLogSequences.length / 2)] ?? 0
      const expectedSseSequences = orderedLogSequences.filter(
        (sequence) => sequence > afterSequence,
      )
      assert.deepEqual(
        await readSseBacklogSequences(
          address,
          comparison.id,
          afterSequence,
          expectedSseSequences.length,
        ),
        expectedSseSequences,
      )

      agentRuntimeAdapter.planFailure({
        phase: "execution",
        externalId: 1,
        snapshotMarker: "baseline-v1",
      })
      const executionFailureSessionStart =
        agentRuntimeAdapter.sessions.length
      const executionFailureRun = await waitForRunTerminal(
        address,
        (
          await startComparison(
            "test-run-version-comparison-execution-failure",
          )
        ).id,
      )
      assert.equal(executionFailureRun.status, "COMPLETED")
      const failedExecutionCase = executionFailureRun.cases.find(
        (runCase) =>
          runCase.side === "BASELINE" && runCase.externalId === 1,
      )
      assert.ok(failedExecutionCase)
      assert.equal(failedExecutionCase.executionStatus, "FAILED")
      assert.equal(failedExecutionCase.assessmentStatus, "NOT_EVALUATED")
      assert.equal(
        executionFailureRun.cases
          .filter((runCase) => runCase.id !== failedExecutionCase.id)
          .every(
            (runCase) =>
              runCase.executionStatus === "COMPLETED" &&
              runCase.assessmentStatus === "COMPLETED",
          ),
        true,
      )
      const executionFailureSessions = agentRuntimeAdapter.sessions.slice(
        executionFailureSessionStart,
      )
      assert.deepEqual(
        executionFailureSessions.map((item) => item.phase),
        [
          "execution",
          "execution",
          "grading",
          "execution",
          "grading",
          "execution",
          "grading",
          "execution",
          "grading",
          "execution",
          "grading",
        ],
      )
      const executionFailureReportResponse = await fetch(
        `${address}/api/test-runs/${executionFailureRun.id}/report`,
      )
      assert.equal(executionFailureReportResponse.status, 200)
      const executionFailureReport =
        (await executionFailureReportResponse.json()) as {
          id: string
          status: string
        }
      assert.equal(executionFailureReport.status, "PARTIAL")
      const baselineExecutionIssueResponse = await fetch(
        `${address}/api/test-reports/${executionFailureReport.id}/cases?issueKind=EXECUTION_ERROR&side=BASELINE&externalId=1`,
      )
      assert.equal(baselineExecutionIssueResponse.status, 200)
      assert.equal(
        ((await baselineExecutionIssueResponse.json()) as {
          pagination: { total: number }
        }).pagination.total,
        1,
      )
      const targetExecutionIssueResponse = await fetch(
        `${address}/api/test-reports/${executionFailureReport.id}/cases?issueKind=EXECUTION_ERROR&side=TARGET&externalId=1`,
      )
      assert.equal(targetExecutionIssueResponse.status, 200)
      assert.equal(
        ((await targetExecutionIssueResponse.json()) as {
          pagination: { total: number }
        }).pagination.total,
        0,
      )

      agentRuntimeAdapter.planFailure({
        phase: "grading",
        externalId: 2,
        snapshotMarker: "candidate-v2",
      })
      const gradingFailureSessionStart = agentRuntimeAdapter.sessions.length
      const gradingFailureRun = await waitForRunTerminal(
        address,
        (
          await startComparison(
            "test-run-version-comparison-grading-failure",
          )
        ).id,
      )
      assert.equal(gradingFailureRun.status, "COMPLETED")
      const failedGradingCase = gradingFailureRun.cases.find(
        (runCase) =>
          runCase.side === "TARGET" && runCase.externalId === 2,
      )
      assert.ok(failedGradingCase)
      assert.equal(failedGradingCase.executionStatus, "COMPLETED")
      assert.equal(failedGradingCase.assessmentStatus, "FAILED")
      assert.equal(
        gradingFailureRun.cases
          .filter((runCase) => runCase.id !== failedGradingCase.id)
          .every(
            (runCase) =>
              runCase.executionStatus === "COMPLETED" &&
              runCase.assessmentStatus === "COMPLETED",
          ),
        true,
      )
      assert.deepEqual(
        agentRuntimeAdapter.sessions
          .slice(gradingFailureSessionStart)
          .map((item) => item.phase),
        Array.from({ length: 6 }).flatMap(() => [
          "execution",
          "grading",
        ]),
      )
      assert.equal(agentRuntimeAdapter.failures.length, 0)

      const deferredExecution = agentRuntimeAdapter.deferNextExecution()
      const canceledRunStarted = await startComparison(
        "test-run-version-comparison-cancel-race",
      )
      await waitForSignal(
        deferredExecution.blocked,
        "the deferred execution Session",
      )
      const cancelResponse = await fetch(
        `${address}/api/test-runs/${canceledRunStarted.id}/cancel`,
        { method: "POST" },
      )
      assert.equal(cancelResponse.status, 202)
      deferredExecution.release()
      const canceledRun = await waitForRunTerminal(
        address,
        canceledRunStarted.id,
      )
      assert.equal(canceledRun.status, "CANCELED")
      const canceledExecutionStatuses = canceledRun.cases.map(
        (runCase) => runCase.executionStatus,
      )
      assert.equal(
        canceledExecutionStatuses.every((status) =>
          ["CANCELED", "INTERRUPTED"].includes(status),
        ),
        true,
      )
      assert.ok(
        canceledExecutionStatuses.filter((status) => status === "CANCELED")
          .length >=
          canceledRun.cases.length - 1,
      )
      assert.ok(agentRuntimeAdapter.interruptCount >= 1)
      assert.equal(agentRuntimeAdapter.maxActiveSends, 1)
      assert.equal(agentRuntimeAdapter.activeSends, 0)
      const canceledReportResponse = await fetch(
        `${address}/api/test-runs/${canceledRun.id}/report`,
      )
      assert.equal(canceledReportResponse.status, 200)
      const canceledReport = (await canceledReportResponse.json()) as {
        status: string
        report: {
          run: { runStatus: string }
          completeness: { status: string }
        }
      }
      assert.equal(canceledReport.status, "PARTIAL")
      assert.equal(canceledReport.report.run.runStatus, "CANCELED")
      assert.equal(canceledReport.report.completeness.status, "PARTIAL")

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
        targetExecutions.map((item) => ({
          hasInstalledSkill: item.hasInstalledSkill,
          inputContent: item.inputContent,
          snapshotMarker: item.snapshotMarker,
        })),
        Array.from({ length: 3 }).flatMap(() => [
          {
            hasInstalledSkill: true,
            inputContent: "controlled fixture",
            snapshotMarker: "baseline-v1",
          },
          {
            hasInstalledSkill: false,
            inputContent: "controlled fixture",
            snapshotMarker: "no-skill",
          },
        ]),
      )
      const graderOpens = agentRuntimeAdapter.opens.filter(
        (item) => item.cwd.endsWith(`${path.sep}grading`),
      )
      assert.ok(graderOpens.length > 0)
      assert.equal(
        graderOpens.every(
          (item) =>
            item.systemPrompt?.includes("inputs/task.json") === true &&
            item.environment?.DATABASE_URL === undefined,
        ),
        true,
      )
      const executionOpens = agentRuntimeAdapter.opens.filter(
        (item) => item.cwd.endsWith(`${path.sep}workspace`),
      )
      assert.ok(executionOpens.length > 0)
      assert.equal(
        executionOpens.every(
          (item) =>
            item.environment?.DATABASE_URL === undefined &&
            item.systemPrompt?.includes("inputs/task.json") === true,
        ),
        true,
      )

      const artifact = target.artifacts[0]
      assert.ok(artifact)
      const artifactResponse = await fetch(
        `${address}${artifact.downloadUrl}`,
      )
      assert.equal(artifactResponse.status, 200)
      assert.equal(
        await artifactResponse.text(),
        "controlled fixture summarized | snapshot=baseline-v1",
      )

      const inspectionClient = createDatabaseClient(testDatabaseUrl, {
        applicationName: "skillconsole-test-run-loop-inspect",
        maxConnections: 1,
      })
      const events = await inspectionClient.database
        .select()
        .from(skillTestRunEvents)
        .where(eq(skillTestRunEvents.runId, terminal.id))
      assert.ok(events.some((event) => event.type === "run.completed"))
      assert.ok(
        events.some(
          (event) =>
            event.type === "execution.assistant.message",
        ),
      )
      assert.equal(
        JSON.stringify(events).includes("integration-secret"),
        false,
      )

      const legacyHash = "a".repeat(64)
      const legacyRunId = randomUUID()
      const baselineVersionRow = await inspectionClient.database
        .select({ snapshotId: skillVersions.snapshotId })
        .from(skillVersions)
        .where(eq(skillVersions.id, baselineVersion.id))
        .limit(1)
      assert.ok(baselineVersionRow[0])
      await inspectionClient.database.insert(skillTestRuns).values({
        id: legacyRunId,
        workspaceId,
        skillVersionId: baselineVersion.id,
        skillDraftRevisionId: null,
        skillSnapshotId: baselineVersionRow[0].snapshotId,
        baselineSkillVersionId: null,
        baselineSkillSnapshotId: null,
        evalRevisionId: published.revision.id,
        mode: "target_vs_no_skill",
        status: "COMPLETED",
        executionPolicy: "target_then_no_skill_serial_v1",
        protocolVersion: "skill-test-run-v2",
        sdkVersion: "legacy-sdk",
        skillCreatorCommit: "b".repeat(40),
        skillCreatorTreeHash: legacyHash,
        configurationFingerprint: legacyHash,
        semanticConfigurationFingerprint: legacyHash,
        environmentFingerprint: legacyHash,
        environmentSnapshot: { status: "legacy_unavailable" },
        skillManifestHash: terminal.traceability.skillManifestHash,
        baselineSkillManifestHash: null,
        evalManifestHash: terminal.traceability.evalManifestHash,
        comparabilityFingerprint: legacyHash,
        runInputFingerprint: legacyHash,
        executionPromptVersion: "legacy_unavailable",
        graderProtocolVersion: "legacy_unavailable",
        toolPermissionPolicyVersion: "legacy_unavailable",
        idempotencyKey: "legacy-run-readable",
        requestHash: legacyHash,
        totalCaseCount: 2,
        completedCaseCount: 2,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      const legacyResponse = await fetch(
        `${address}/api/test-runs/${legacyRunId}`,
      )
      assert.equal(legacyResponse.status, 200)
      const legacyRun = (await legacyResponse.json()) as TestRunDetailView
      assert.equal(legacyRun.mode, "target_vs_no_skill")
      assert.equal(
        legacyRun.executionPolicy,
        "target_then_no_skill_serial_v1",
      )
      assert.deepEqual(legacyRun.environment, {
        status: "legacy_unavailable",
      })
      assert.equal(legacyRun.cases.length, 0)
      const legacyReportResponse = await fetch(
        `${address}/api/test-runs/${legacyRunId}/report`,
      )
      assert.equal(legacyReportResponse.status, 200)
      const legacyReport = (await legacyReportResponse.json()) as {
        status: string
        report: {
          environment: { status: string }
          comparability: { status: string }
          completeness: { status: string }
          cases: readonly { evalRevisionCaseId: string }[]
        }
      }
      assert.equal(legacyReport.status, "PARTIAL")
      assert.deepEqual(legacyReport.report.environment, {
        status: "legacy_unavailable",
      })
      assert.equal(
        legacyReport.report.comparability.status,
        "UNKNOWN_LEGACY",
      )
      assert.equal(legacyReport.report.completeness.status, "PARTIAL")
      assert.equal(legacyReport.report.cases.length, published.revision.evalCount)
      await inspectionClient.database
        .delete(skillTestRuns)
        .where(eq(skillTestRuns.id, legacyRunId))
      await closeDatabaseClient(inspectionClient)

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
      const generationSuiteIds = (
        await cleanupClient.database
          .select({ id: evalSuites.id })
          .from(evalSuites)
          .where(eq(evalSuites.workspaceId, workspaceId))
      ).map((suite) => suite.id)
      if (generationSuiteIds.length > 0) {
        await cleanupClient.database
          .delete(skillTestRuns)
          .where(eq(skillTestRuns.workspaceId, workspaceId))
        assert.equal(
          (
            await cleanupClient.database
              .select({ id: skillTestReportAnalyses.id })
              .from(skillTestReportAnalyses)
              .where(eq(skillTestReportAnalyses.id, lifecycleAnalysisId))
          ).length,
          0,
          "deleting the Run must cascade through Report, Revision, and Analysis",
        )
        await cleanupClient.database
          .delete(evalRevisions)
          .where(inArray(evalRevisions.suiteId, generationSuiteIds))
        await cleanupClient.database
          .delete(evalGenerationTasks)
          .where(
            inArray(evalGenerationTasks.suiteId, generationSuiteIds),
          )
      }
      await cleanupClient.database
        .delete(skillWorkspaces)
        .where(eq(skillWorkspaces.id, otherWorkspaceId))
      await cleanupClient.database
        .delete(skillWorkspaces)
        .where(eq(skillWorkspaces.id, workspaceId))
      await closeDatabaseClient(cleanupClient)
      await rm(dataRoot, { recursive: true, force: true })
    }
  },
)
