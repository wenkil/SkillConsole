import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { DomainError } from "../../core/errors/domain-error.js"
import type {
  SkillTestRunCaseRow,
  StoredTestRunUsage,
} from "../../infrastructure/database/index.js"
import {
  claudeAgentSdkVersion,
  type AgentSessionEvent,
} from "../agent-sessions/agent-session.domain.js"
import type { AgentSessionService } from "../agent-sessions/agent-session.service.js"
import { DraftRevisionService } from "../skill-workspaces/draft-revision.service.js"
import {
  pinnedSkillCreatorCommit,
  pinnedSkillCreatorTreeHash,
} from "../evals/eval-workspace.js"
import { calculateTestRunBenchmark } from "./test-run-benchmark.js"
import type {
  CreateTestRunInput,
  TestRunDetailView,
  TestRunEvent,
  TestRunPage,
  TestRunView,
} from "./test-run.domain.js"
import { TestRunEventBus } from "./test-run-event-bus.js"
import {
  buildExecutionPrompt,
  buildGraderPrompt,
} from "./test-run-prompt.js"
import {
  TestRunRepository,
  type FrozenTestRunSelection,
} from "./test-run.repository.js"
import {
  type ParsedAssertionResult,
  TestRunScorer,
} from "./test-run-scorer.js"
import { TestRunStorage } from "./test-run-storage.js"

export const testRunProtocolVersion = "skill-test-run-v1"
const maxFinalOutputCharacters = 200_000

interface TestRunLogger {
  readonly error: (
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ) => void
}

export interface TestRunServiceOptions {
  readonly claudeSettingsPath: string
  readonly repository: TestRunRepository
  readonly draftRevisions: DraftRevisionService
  readonly storage: TestRunStorage
  readonly agentSessions: AgentSessionService
  readonly scorer: TestRunScorer
  readonly logger: TestRunLogger
}

interface MonitoredSessionResult {
  readonly status: "COMPLETED" | "CANCELED" | "INTERRUPTED" | "FAILED"
  readonly finalOutput: string
  readonly usage: StoredTestRunUsage | null
  readonly error: {
    readonly code: string
    readonly message: string
  } | null
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value))
}

function referencedFileFacts(
  selection: FrozenTestRunSelection,
  paths: readonly string[],
) {
  const filesByPath = new Map(
    selection.files.map((file) => [file.relativePath, file]),
  )
  return paths.map((relativePath) => {
    const file = filesByPath.get(relativePath)
    if (!file) {
      throw new DomainError({
        code: "TEST_RUN_EVAL_INPUT_MISSING",
        message:
          "The selected Evals revision references an input file that is not present in its immutable file index.",
        kind: "conflict",
        details: {
          evalRevisionId: selection.revision.id,
          relativePath,
        },
      })
    }
    return {
      relativePath: file.relativePath,
      sha256: file.sha256,
      byteSize: file.byteSize,
      mediaTypeHint: file.mediaTypeHint,
      contentKind: file.contentKind,
    }
  })
}

function eventError(
  event: AgentSessionEvent,
  fallbackCode: string,
  fallbackMessage: string,
) {
  const raw =
    event.payload.error &&
    typeof event.payload.error === "object" &&
    !Array.isArray(event.payload.error)
      ? (event.payload.error as Record<string, unknown>)
      : null
  return {
    code:
      typeof raw?.code === "string" ? raw.code : fallbackCode,
    message:
      typeof raw?.message === "string" ? raw.message : fallbackMessage,
  }
}

function assistantText(event: AgentSessionEvent): string | null {
  if (
    event.type !== "assistant.message" ||
    !Array.isArray(event.payload.content)
  ) {
    return null
  }
  const parts = event.payload.content
    .filter(
      (item): item is { readonly type: "text"; readonly text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
  return parts.length > 0 ? parts.join("\n") : null
}

function usageFromEvent(
  event: AgentSessionEvent,
): StoredTestRunUsage | null {
  if (event.type !== "usage.updated") return null
  const usage =
    event.payload.usage &&
    typeof event.payload.usage === "object" &&
    !Array.isArray(event.payload.usage)
      ? (event.payload.usage as Record<string, unknown>)
      : null
  const number = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0
  return {
    inputTokens: number(usage?.inputTokens),
    outputTokens: number(usage?.outputTokens),
    cacheCreationInputTokens: number(usage?.cacheCreationInputTokens),
    cacheReadInputTokens: number(usage?.cacheReadInputTokens),
    totalCostUsd: number(event.payload.totalCostUsd),
    durationMs: number(event.payload.durationMs),
    durationApiMs: number(event.payload.durationApiMs),
    numTurns: number(event.payload.numTurns),
  }
}

function validateEvidenceReferences(
  results: readonly ParsedAssertionResult[],
  finalOutput: string,
  artifacts: readonly {
    readonly relativePath: string
    readonly content: string | null
  }[],
): void {
  const artifactsByPath = new Map(
    artifacts.map((artifact) => [artifact.relativePath, artifact]),
  )
  for (const result of results) {
    for (const item of result.evidence) {
      if (item.source === "assistant_output") {
        if (
          item.reference !== "final-output" ||
          (item.excerpt !== null && !finalOutput.includes(item.excerpt))
        ) {
          throw new Error(
            "The grader cited assistant evidence that is not present.",
          )
        }
        continue
      }
      const artifact = artifactsByPath.get(item.reference)
      if (
        !artifact ||
        (item.excerpt !== null &&
          (artifact.content === null ||
            !artifact.content.includes(item.excerpt)))
      ) {
        throw new Error(
          "The grader cited Artifact evidence that is not present.",
        )
      }
    }
  }
}

export class TestRunService {
  private readonly eventBus = new TestRunEventBus()
  private readonly workers = new Map<string, Promise<void>>()
  private readonly activeSessions = new Map<string, string>()
  private readonly lastPublishedSequences = new Map<string, number>()
  private shuttingDown = false

  constructor(private readonly options: TestRunServiceOptions) {}

  async initialize(): Promise<void> {
    const events = await this.options.repository.reconcileInterruptedRuns()
    this.eventBus.publish(events)
  }

  async start(input: CreateTestRunInput): Promise<TestRunDetailView> {
    const requestHash = stableHash({
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      draftContentRevision: input.draftContentRevision,
      evalRevisionId: input.evalRevisionId,
      mode: input.mode,
    })
    const replay = await this.options.repository.findByIdempotencyKey(
      input.workspaceId,
      input.idempotencyKey,
    )
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new DomainError({
          code: "TEST_RUN_IDEMPOTENCY_CONFLICT",
          message:
            "The idempotency key was already used with a different test run selection.",
          kind: "conflict",
        })
      }
      return this.options.repository.getDetail(replay.id)
    }

    const draftRevision = await this.options.draftRevisions.freeze(
      input.workspaceId,
      {
        draftId: input.draftId,
        contentRevision: input.draftContentRevision,
      },
      "TRIAL",
    )
    const selection = await this.options.repository.freezeSelection({
      workspaceId: input.workspaceId,
      skillDraftRevisionId: draftRevision.draftRevisionId,
      skillVersionId: null,
      evalRevisionId: input.evalRevisionId,
    })
    const configurationFingerprint = sha256(
      await readFile(this.options.claudeSettingsPath),
    )
    const environmentFingerprint = stableHash({
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      sdkVersion: claudeAgentSdkVersion,
      protocolVersion: testRunProtocolVersion,
    })
    const comparabilityFingerprint = stableHash({
      mode: input.mode,
      evalRevisionId: selection.revision.id,
      evalManifestHash: selection.revision.manifestHash,
      configurationFingerprint,
      environmentFingerprint,
      sdkVersion: claudeAgentSdkVersion,
      protocolVersion: testRunProtocolVersion,
      skillCreatorCommit: pinnedSkillCreatorCommit,
      skillCreatorTreeHash: pinnedSkillCreatorTreeHash,
    })
    const runInputFingerprint = stableHash({
      comparabilityFingerprint,
      draftRevisionId: selection.skill.draftRevisionId,
      skillSnapshotId: selection.skill.snapshotId,
      skillManifestHash: selection.skill.manifestHash,
    })
    const cases = selection.cases.flatMap((evalCase, index) => {
      const inputFingerprint = stableHash({
        evalRevisionId: selection.revision.id,
        externalId: evalCase.externalId,
        prompt: evalCase.prompt,
        expectedOutput: evalCase.expectedOutput,
        assertions: evalCase.assertions,
        files: referencedFileFacts(selection, evalCase.files),
      })
      return [
        {
          id: randomUUID(),
          evalCase,
          side: "TARGET" as const,
          executionOrder: index * 2 + 1,
          inputFingerprint,
        },
        {
          id: randomUUID(),
          evalCase,
          side: "BASELINE" as const,
          executionOrder: index * 2 + 2,
          inputFingerprint,
        },
      ]
    })
    const run = await this.options.repository.create({
      id: randomUUID(),
      selection,
      traceability: {
        protocolVersion: testRunProtocolVersion,
        sdkVersion: claudeAgentSdkVersion,
        skillCreatorCommit: pinnedSkillCreatorCommit,
        skillCreatorTreeHash: pinnedSkillCreatorTreeHash,
        configurationFingerprint,
        environmentFingerprint,
        skillManifestHash: selection.skill.manifestHash,
        evalManifestHash: selection.revision.manifestHash,
        comparabilityFingerprint,
        runInputFingerprint,
      },
      idempotencyKey: input.idempotencyKey,
      requestHash,
      cases,
    })
    await this.publishNewEvents(run.id)
    this.launch(run.id)
    return run
  }

  get(runId: string): Promise<TestRunView> {
    return this.options.repository.get(runId)
  }

  getDetail(runId: string): Promise<TestRunDetailView> {
    return this.options.repository.getDetail(runId)
  }

  list(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<TestRunPage> {
    return this.options.repository.list(workspaceId, page, pageSize)
  }

  listEvents(
    runId: string,
    afterSequence: number,
  ): Promise<readonly TestRunEvent[]> {
    return this.options.repository.listEvents(runId, afterSequence)
  }

  subscribe(
    runId: string,
    listener: (event: TestRunEvent) => void,
  ): () => void {
    return this.eventBus.subscribe(runId, listener)
  }

  async cancel(runId: string): Promise<TestRunView> {
    const run = await this.options.repository.getRow(runId)
    if (
      !["PREPARING", "RUNNING", "SCORING", "CANCELING"].includes(
        run.status,
      )
    ) {
      return this.options.repository.get(runId)
    }
    if (run.status !== "CANCELING") {
      await this.options.repository.markCanceling(runId)
      await this.publishNewEvents(runId)
    }
    const sessionId = this.activeSessions.get(runId)
    if (sessionId) {
      try {
        await this.options.agentSessions.cancel(sessionId)
      } catch (error) {
        this.options.logger.error(
          { runId, sessionId, error },
          "Active test run Agent Session could not be canceled",
        )
      }
    } else if (!this.workers.has(runId)) {
      await this.options.repository.finalizeCanceled(runId)
      await this.publishNewEvents(runId)
    }
    return this.options.repository.get(runId)
  }

  async getArtifactDownload(
    runId: string,
    artifactId: string,
  ): Promise<{
    readonly content: Buffer
    readonly fileName: string
    readonly mediaType: string
  }> {
    const record = await this.options.repository.getArtifactRecord(
      runId,
      artifactId,
    )
    const content = await readFile(
      this.options.storage.getArtifactPath(
        runId,
        record.caseId,
        record.artifact.relativePath,
      ),
    )
    if (sha256(content) !== record.artifact.sha256) {
      throw new DomainError({
        code: "TEST_RUN_ARTIFACT_CORRUPTED",
        message: "The requested Artifact failed its integrity check.",
        kind: "conflict",
        details: { runId, artifactId },
      })
    }
    return {
      content,
      fileName:
        record.artifact.relativePath.split("/").at(-1) ?? "artifact",
      mediaType: record.artifact.mediaTypeHint,
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    this.eventBus.clear()
  }

  private launch(runId: string): void {
    if (this.workers.has(runId) || this.shuttingDown) return
    const worker = this.executeRun(runId)
      .catch(async (error) => {
        this.options.logger.error(
          { runId, error },
          "Skill test run orchestration failed",
        )
        try {
          const run = await this.options.repository.getRow(runId)
          if (run.status === "CANCELING") {
            await this.options.repository.finalizeCanceled(runId)
          } else if (
            !["COMPLETED", "CANCELED", "INTERRUPTED", "FAILED"].includes(
              run.status,
            )
          ) {
            await this.options.repository.failRun(
              runId,
              "TEST_RUN_ORCHESTRATION_FAILED",
              "The Skill test run could not continue.",
            )
          }
          await this.publishNewEvents(runId)
        } catch (finalizeError) {
          this.options.logger.error(
            { runId, error: finalizeError },
            "Skill test run failure could not be persisted",
          )
        }
      })
      .finally(() => {
        this.workers.delete(runId)
        this.activeSessions.delete(runId)
      })
    this.workers.set(runId, worker)
  }

  private async executeRun(runId: string): Promise<void> {
    await this.options.repository.markRunRunning(runId)
    await this.publishNewEvents(runId)
    const run = await this.options.repository.getRow(runId)
    const selection = await this.options.repository.freezeSelection({
      workspaceId: run.workspaceId,
      skillDraftRevisionId: run.skillDraftRevisionId,
      skillVersionId: run.skillVersionId,
      evalRevisionId: run.evalRevisionId,
    })
    if (
      selection.skill.manifestHash !== run.skillManifestHash ||
      selection.revision.manifestHash !== run.evalManifestHash
    ) {
      throw new Error("The frozen test run input facts no longer match.")
    }
    const cases = await this.options.repository.listCaseRows(runId)
    for (const runCase of cases) {
      const current = await this.options.repository.getRow(runId)
      if (current.status === "CANCELING") {
        await this.options.repository.finalizeCanceled(runId)
        await this.publishNewEvents(runId)
        return
      }
      await this.executeCase(runId, run, runCase, selection)
    }
    const current = await this.options.repository.getRow(runId)
    if (current.status === "CANCELING") {
      await this.options.repository.finalizeCanceled(runId)
      await this.publishNewEvents(runId)
      return
    }
    const detail = await this.options.repository.getDetail(runId)
    const benchmark = calculateTestRunBenchmark(detail)
    await this.options.repository.completeRun({
      runId,
      ...benchmark,
    })
    await this.publishNewEvents(runId)
  }

  private async executeCase(
    runId: string,
    run: Awaited<ReturnType<TestRunRepository["getRow"]>>,
    runCase: SkillTestRunCaseRow,
    selection: FrozenTestRunSelection,
  ): Promise<void> {
    const workspaceLocator = this.options.storage.getWorkspaceLocator(
      runId,
      runCase.id,
    )
    await this.options.repository.markCasePreparing(
      runCase.id,
      workspaceLocator,
    )
    await this.publishNewEvents(runId)

    let executionSessionId: string | null = null
    try {
      const workspace = await this.options.storage.prepareCase(
        runId,
        runCase.id,
        runCase.side,
        selection,
        runCase.files,
      )
      const session = await this.options.agentSessions.createInWorkspace({
        prompt: buildExecutionPrompt({
          userPrompt: runCase.prompt,
          inputPaths: workspace.inputPaths,
        }),
        workspaceLocator: workspace.locator,
        expectedConfigurationFingerprint: run.configurationFingerprint,
      })
      executionSessionId = session.id
      this.activeSessions.set(runId, session.id)
      await this.options.repository.bindExecutionSession(
        runCase.id,
        session.id,
      )
      await this.publishNewEvents(runId)
      const result = await this.monitorSession({
        runId,
        caseId: runCase.id,
        sessionId: session.id,
        phase: "execution",
      })
      this.options.agentSessions.release(session.id)
      executionSessionId = null
      this.activeSessions.delete(runId)
      if (result.status !== "COMPLETED" || !result.usage) {
        await this.options.repository.failExecution({
          caseId: runCase.id,
          status:
            result.status === "COMPLETED" ? "FAILED" : result.status,
          code:
            result.error?.code ??
            "TEST_RUN_EXECUTION_RESULT_INCOMPLETE",
          message:
            result.error?.message ??
            "The Agent execution did not provide complete usage facts.",
        })
        await this.publishNewEvents(runId)
        return
      }
      if (result.finalOutput.length > maxFinalOutputCharacters) {
        await this.options.repository.failExecution({
          caseId: runCase.id,
          status: "FAILED",
          code: "TEST_RUN_FINAL_OUTPUT_TOO_LARGE",
          message:
            "The Agent final output exceeded the supported test run limit.",
        })
        await this.publishNewEvents(runId)
        return
      }
      await this.options.agentSessions.assertWorkspaceConfigurationFingerprint(
        workspace.locator,
        run.configurationFingerprint,
      )
      await this.options.storage.verifyImmutableInputs(
        runId,
        runCase.id,
        runCase.side,
        selection,
        runCase.files,
      )
      const artifacts = await this.options.storage.collectArtifacts(
        runId,
        runCase.id,
      )
      const sensitiveValues =
        await this.options.agentSessions.getWorkspaceSensitiveValues(
          workspace.locator,
        )
      await this.options.storage.assertArtifactsSafe(
        runId,
        runCase.id,
        artifacts,
        [...sensitiveValues, workspace.absolutePath],
      )
      await this.options.repository.completeExecution({
        caseId: runCase.id,
        finalOutput: result.finalOutput,
        usage: result.usage,
        artifacts: artifacts.map((artifact) => ({
          id: randomUUID(),
          relativePath: artifact.relativePath,
          storageLocator: this.options.storage.getArtifactLocator(
            runId,
            runCase.id,
            artifact.relativePath,
          ),
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
          mediaTypeHint: artifact.mediaTypeHint,
          contentKind: artifact.contentKind,
        })),
      })
      await this.publishNewEvents(runId)
      if (
        (await this.options.repository.getRow(runId)).status ===
        "CANCELING"
      ) {
        return
      }
      await this.assessCase(
        runId,
        run,
        runCase,
        workspace.gradingLocator,
        result.finalOutput,
        artifacts,
      )
    } catch (error) {
      const [current, runState] = await Promise.all([
        this.options.repository.getCaseRow(runCase.id),
        this.options.repository.getRow(runId),
      ])
      if (
        !["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
          current.executionStatus,
        )
      ) {
        await this.options.repository.failExecution({
          caseId: runCase.id,
          status:
            runState.status === "CANCELING" ? "CANCELED" : "FAILED",
          code:
            runState.status === "CANCELING"
              ? "TEST_RUN_CANCELED"
              : "TEST_RUN_CASE_SETUP_FAILED",
          message:
            runState.status === "CANCELING"
              ? "The test run was canceled."
              : "The test Case workspace or Agent Session could not be prepared.",
        })
        await this.publishNewEvents(runId)
      } else if (
        current.assessmentStatus === "RUNNING" &&
        runState.status !== "CANCELING"
      ) {
        await this.options.repository.failAssessment({
          caseId: runCase.id,
          code: "TEST_RUN_GRADING_FAILED",
          message: "The independent grader could not complete.",
        })
        await this.publishNewEvents(runId)
      }
      this.options.logger.error(
        { runId, caseId: runCase.id, error },
        "Skill test Case failed",
      )
    } finally {
      if (executionSessionId) {
        this.options.agentSessions.release(executionSessionId)
      }
      this.activeSessions.delete(runId)
      await this.options.storage.scrubSettings(runId, runCase.id)
    }
  }

  private async assessCase(
    runId: string,
    run: Awaited<ReturnType<TestRunRepository["getRow"]>>,
    runCase: SkillTestRunCaseRow,
    gradingLocator: string,
    finalOutput: string,
    artifacts: Awaited<ReturnType<TestRunStorage["collectArtifacts"]>>,
  ): Promise<void> {
    await this.options.repository.beginAssessment(runCase.id)
    await this.publishNewEvents(runId)
    const evidence = await this.options.storage.readTextArtifactEvidence(
      runId,
      runCase.id,
      artifacts,
    )
    const evidenceByPath = new Map(
      evidence.map((item) => [item.relativePath, item]),
    )
    const rubric = await this.options.scorer.loadRubric()
    const session = await this.options.agentSessions.createInWorkspace({
      prompt: buildGraderPrompt({
        rubric,
        userPrompt: runCase.prompt,
        expectedOutput: runCase.expectedOutput,
        assertions: runCase.assertions,
        finalOutput,
        artifacts: artifacts.map((artifact) => ({
          ...artifact,
          content: evidenceByPath.get(artifact.relativePath)?.content ?? null,
        })),
      }),
      workspaceLocator: gradingLocator,
      expectedConfigurationFingerprint: run.configurationFingerprint,
      allowedTools: [],
    })
    this.activeSessions.set(runId, session.id)
    try {
      await this.options.repository.bindGraderSession(
        runCase.id,
        session.id,
      )
      const result = await this.monitorSession({
        runId,
        caseId: runCase.id,
        sessionId: session.id,
        phase: "grading",
      })
      if (result.status !== "COMPLETED") {
        await this.options.repository.failAssessment({
          caseId: runCase.id,
          code: result.error?.code ?? "TEST_RUN_GRADER_FAILED",
          message:
            result.error?.message ??
            "The independent grader did not complete.",
        })
      } else {
        const parsed = this.options.scorer.parse(
          result.finalOutput,
          runCase.assertions,
        )
        validateEvidenceReferences(
          parsed,
          finalOutput,
          artifacts.map((artifact) => ({
            relativePath: artifact.relativePath,
            content:
              evidenceByPath.get(artifact.relativePath)?.content ?? null,
          })),
        )
        await this.options.repository.completeAssessment(
          runCase.id,
          parsed.map((item) => ({
            id: randomUUID(),
            assertionIndex: item.assertionIndex,
            assertion:
              runCase.assertions[item.assertionIndex] ??
              `Assertion ${item.assertionIndex + 1}`,
            status: item.status,
            reason: item.reason,
            evidence: item.evidence,
          })),
        )
      }
      await this.publishNewEvents(runId)
    } finally {
      this.options.agentSessions.release(session.id)
      this.activeSessions.delete(runId)
    }
  }

  private async monitorSession(input: {
    readonly runId: string
    readonly caseId: string
    readonly sessionId: string
    readonly phase: "execution" | "grading"
  }): Promise<MonitoredSessionResult> {
    let finalOutput = ""
    let usage: StoredTestRunUsage | null = null
    const seen = new Set<number>()
    let resolveResult:
      | ((value: MonitoredSessionResult) => void)
      | null = null
    let rejectResult: ((reason: unknown) => void) | null = null
    const completion = new Promise<MonitoredSessionResult>(
      (resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      },
    )
    let settled = false
    let queue = Promise.resolve()

    const handle = async (event: AgentSessionEvent): Promise<void> => {
      if (seen.has(event.sequence)) return
      seen.add(event.sequence)
      const mapped = await this.options.repository.recordAgentEvent({
        runId: input.runId,
        caseId: input.caseId,
        sessionId: input.sessionId,
        sourceSequence: event.sequence,
        phase: input.phase,
        type: event.type,
        payload: event.payload,
      })
      if (mapped) this.eventBus.publish([mapped])
      const text = assistantText(event)
      if (text !== null) finalOutput = text
      usage = usageFromEvent(event) ?? usage
      if (settled) return

      let terminal: MonitoredSessionResult | null = null
      if (event.type === "turn.completed") {
        terminal = {
          status: "COMPLETED",
          finalOutput,
          usage,
          error: null,
        }
      } else if (event.type === "turn.canceled") {
        terminal = {
          status: "CANCELED",
          finalOutput,
          usage,
          error: eventError(
            event,
            "TEST_RUN_CANCELED",
            "The Agent execution was canceled.",
          ),
        }
      } else if (event.type === "turn.interrupted") {
        terminal = {
          status: "INTERRUPTED",
          finalOutput,
          usage,
          error: eventError(
            event,
            "CLAUDE_RUNTIME_INTERRUPTED",
            "The Agent execution was interrupted.",
          ),
        }
      } else if (
        event.type === "turn.failed" ||
        event.type === "session.failed"
      ) {
        terminal = {
          status: "FAILED",
          finalOutput,
          usage,
          error: eventError(
            event,
            "CLAUDE_EXECUTION_FAILED",
            "The Agent execution failed.",
          ),
        }
      }
      if (terminal) {
        settled = true
        resolveResult?.(terminal)
      }
    }

    const enqueue = (event: AgentSessionEvent): void => {
      queue = queue
        .then(() => handle(event))
        .catch((error) => {
          if (!settled) {
            settled = true
            rejectResult?.(error)
          }
        })
    }
    const unsubscribe = this.options.agentSessions.subscribe(
      input.sessionId,
      enqueue,
    )
    try {
      const backlog = await this.options.agentSessions.listEvents(
        input.sessionId,
        0,
      )
      for (const event of backlog) enqueue(event)
      return await completion
    } finally {
      unsubscribe()
      await queue
    }
  }

  private async publishNewEvents(runId: string): Promise<void> {
    const events = await this.options.repository.listEvents(
      runId,
      this.lastPublishedSequences.get(runId) ?? 0,
    )
    for (const event of events) {
      this.lastPublishedSequences.set(runId, event.sequence)
      this.eventBus.publish([event])
    }
  }
}
