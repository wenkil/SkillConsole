import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { DomainError } from "../../core/errors/domain-error.js"
import type { StoredTestRunUsage } from "../../infrastructure/database/index.js"
import type {
  AgentSessionEvent,
  AgentSessionView,
} from "../agent-sessions/agent-session.domain.js"
import type { AgentSessionService } from "../agent-sessions/agent-session.service.js"
import {
  buildIsolatedAgentRuntimeEnvironment,
  forIsolatedAgentWorkspace,
} from "../test-runs/test-run-runtime-environment.js"
import { sanitizeTestRunPublicValue } from "../test-runs/test-run-public-safety.js"
import type {
  StructuredTestReportV1,
  TestReportAnalysisRevisionView,
  TestReportAnalyzerRuntimePolicyV1,
} from "./test-report.domain.js"
import {
  buildTestReportAnalyzerPrompt,
  createTestReportAnalysisInputFingerprint,
  parseTestReportAnalysis,
  testReportAnalysisPromptVersion,
  testReportAnalyzerSystemPrompt,
  TestReportAnalysisProtocolError,
} from "./test-report-analysis-protocol.js"
import {
  getTestReportAnalysisDocumentFilename,
  renderTestReportAnalysisHtml,
  renderTestReportAnalysisMarkdown,
} from "./test-report-analysis-renderer.js"
import { TestReportAnalysisWorkspace } from "./test-report-analysis-workspace.js"
import type { TestReportDocumentLocale } from "./test-report-renderer.js"
import { TestReportRepository } from "./test-report.repository.js"

const analyzerRuntimePolicy = {
  schemaVersion: "test-report-analyzer-runtime-policy.v1",
  maxTurns: 1,
  maxBudgetUsd: 0.75,
  timeoutMs: 90_000,
  cancellationGraceMs: 5_000,
  maxPromptCharacters: 500_000,
  maxResponseCharacters: 200_000,
  sandboxPolicy: "report_analyzer_strict_v1",
  persistSession: false,
  strictMcpConfig: true,
  toolsEnabled: false,
  skillsEnabled: false,
  mcpEnabled: false,
} as const satisfies TestReportAnalyzerRuntimePolicyV1

const terminalAgentEvents = new Set<AgentSessionEvent["type"]>([
  "turn.completed",
  "turn.canceled",
  "turn.interrupted",
  "turn.failed",
  "session.failed",
])

interface TestReportAnalysisLogger {
  error(
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ): void
}

export interface TestReportAnalysisServiceOptions {
  readonly repository: TestReportRepository
  readonly agentSessions: AgentSessionService
  readonly dataRoot: string
  readonly claudeSettingsPath: string
  readonly logger: TestReportAnalysisLogger
  readonly agentSessionTimeoutMs?: number
  readonly cancellationGraceMs?: number
}

interface FoldedAnalysisSession {
  readonly finalOutput: string | null
  readonly usage: StoredTestRunUsage | null
  readonly actualModelId: string | null
  readonly initialized: boolean
  readonly exposedTools: readonly string[]
  readonly exposedSkills: readonly string[]
  readonly exposedMcpServers: readonly string[]
  readonly toolUseObserved: boolean
  readonly terminalType: AgentSessionEvent["type"] | null
  readonly error: { readonly code: string; readonly message: string } | null
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex")
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function parseConfiguredModelId(settings: Buffer): string {
  try {
    const parsed = JSON.parse(settings.toString("utf8")) as {
      readonly model?: unknown
      readonly env?: Readonly<Record<string, unknown>>
    }
    const model =
      typeof parsed.env?.ANTHROPIC_MODEL === "string"
        ? parsed.env.ANTHROPIC_MODEL.trim()
        : typeof parsed.model === "string"
          ? parsed.model.trim()
          : ""
    return model || "sdk_default"
  } catch {
    return "sdk_default"
  }
}

function semanticConfigurationFingerprint(settings: Buffer): string {
  let endpointHash: string | null = null
  try {
    const parsed = JSON.parse(settings.toString("utf8")) as {
      readonly env?: Readonly<Record<string, unknown>>
    }
    const endpoint =
      typeof parsed.env?.ANTHROPIC_BASE_URL === "string"
        ? parsed.env.ANTHROPIC_BASE_URL.trim()
        : ""
    endpointHash = endpoint
      ? createHash("sha256").update(endpoint).digest("hex")
      : null
  } catch {
    endpointHash = null
  }
  return stableHash({
    model: parseConfiguredModelId(settings),
    endpointHash,
  })
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function usageFromEvent(event: AgentSessionEvent): StoredTestRunUsage | null {
  if (event.type !== "usage.updated") return null
  const usage =
    event.payload.usage &&
    typeof event.payload.usage === "object" &&
    !Array.isArray(event.payload.usage)
      ? (event.payload.usage as Record<string, unknown>)
      : null
  return {
    inputTokens: finiteNonNegative(usage?.inputTokens),
    outputTokens: finiteNonNegative(usage?.outputTokens),
    cacheCreationInputTokens: finiteNonNegative(
      usage?.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: finiteNonNegative(usage?.cacheReadInputTokens),
    totalCostUsd: finiteNonNegative(event.payload.totalCostUsd),
    durationMs: finiteNonNegative(event.payload.durationMs),
    durationApiMs: finiteNonNegative(event.payload.durationApiMs),
    numTurns: finiteNonNegative(event.payload.numTurns),
  }
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function assistantOutput(event: AgentSessionEvent): {
  readonly text: string | null
  readonly toolUseObserved: boolean
} {
  if (
    event.type !== "assistant.message" ||
    !Array.isArray(event.payload.content)
  ) {
    return { text: null, toolUseObserved: false }
  }
  const text: string[] = []
  let toolUseObserved = false
  for (const item of event.payload.content) {
    if (typeof item !== "object" || item === null || !("type" in item)) {
      continue
    }
    if (item.type === "tool_use") toolUseObserved = true
    if (
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      text.push(item.text)
    }
  }
  return {
    text: text.length > 0 ? text.join("\n") : null,
    toolUseObserved,
  }
}

function eventError(event: AgentSessionEvent): {
  readonly code: string
  readonly message: string
} | null {
  const value =
    event.payload.error &&
    typeof event.payload.error === "object" &&
    !Array.isArray(event.payload.error)
      ? (event.payload.error as Record<string, unknown>)
      : null
  if (!value) return null
  return {
    code:
      typeof value.code === "string"
        ? value.code
        : "TEST_REPORT_ANALYZER_RUNTIME_FAILED",
    message:
      typeof value.message === "string"
        ? String(sanitizeTestRunPublicValue(value.message))
        : "The Analyzer Agent Session failed.",
  }
}

function foldAnalysisEvents(
  events: readonly AgentSessionEvent[],
): FoldedAnalysisSession {
  let finalOutput: string | null = null
  let usage: StoredTestRunUsage | null = null
  let actualModelId: string | null = null
  let initialized = false
  let exposedTools: readonly string[] = []
  let exposedSkills: readonly string[] = []
  let exposedMcpServers: readonly string[] = []
  let toolUseObserved = false
  let terminalType: AgentSessionEvent["type"] | null = null
  let error: FoldedAnalysisSession["error"] = null

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === "session.initialized") {
      initialized = true
      actualModelId =
        typeof event.payload.model === "string" ? event.payload.model : null
      exposedTools = stringArray(event.payload.tools)
      exposedSkills = stringArray(event.payload.skills)
      exposedMcpServers = Array.isArray(event.payload.mcpServers)
        ? event.payload.mcpServers.flatMap((server) =>
            typeof server === "object" &&
            server !== null &&
            "name" in server &&
            typeof server.name === "string"
              ? [server.name]
              : [],
          )
        : []
    }
    const assistant = assistantOutput(event)
    if (assistant.text !== null) finalOutput = assistant.text
    toolUseObserved ||= assistant.toolUseObserved
    usage = usageFromEvent(event) ?? usage
    if (terminalAgentEvents.has(event.type)) {
      terminalType = event.type
      error = eventError(event) ?? error
    }
  }

  return {
    finalOutput,
    usage,
    actualModelId,
    initialized,
    exposedTools,
    exposedSkills,
    exposedMcpServers,
    toolUseObserved,
    terminalType,
    error,
  }
}

export class TestReportAnalysisService {
  private readonly workspace: TestReportAnalysisWorkspace
  private readonly runtimePolicy: TestReportAnalyzerRuntimePolicyV1
  private readonly workers = new Map<string, Promise<void>>()
  private readonly activeSessions = new Map<string, string>()
  private shuttingDown = false

  constructor(private readonly options: TestReportAnalysisServiceOptions) {
    this.workspace = new TestReportAnalysisWorkspace(options.dataRoot)
    this.runtimePolicy = {
      ...analyzerRuntimePolicy,
      timeoutMs: options.agentSessionTimeoutMs ?? analyzerRuntimePolicy.timeoutMs,
      cancellationGraceMs:
        options.cancellationGraceMs ?? analyzerRuntimePolicy.cancellationGraceMs,
    }
  }

  async initialize(): Promise<void> {
    await this.options.repository.failInterruptedAnalyses()
    await this.workspace.cleanupStale()
    for (const analysisId of await this.options.repository.listPendingAnalyses()) {
      this.launch(analysisId)
    }
  }

  async create(
    reportId: string,
    selectedEvalRevisionCaseIds: readonly string[],
    idempotencyKey: string,
  ): Promise<TestReportAnalysisRevisionView> {
    if (this.shuttingDown) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYZER_SHUTTING_DOWN",
        message: "The Analyzer service is shutting down.",
        kind: "conflict",
      })
    }
    const detail = await this.options.repository.getDetail(reportId)
    if (!detail.currentRevisionId || !detail.report) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYSIS_UNAVAILABLE",
        message: "Analyzer requires an available structured Report Revision.",
        kind: "conflict",
      })
    }
    const selectedSet = new Set(selectedEvalRevisionCaseIds)
    if (
      selectedSet.size === 0 ||
      selectedSet.size !== selectedEvalRevisionCaseIds.length ||
      selectedSet.size > 100
    ) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYSIS_CASE_SELECTION_INVALID",
        message: "Select between 1 and 100 unique Eval Cases to analyze.",
        kind: "validation",
      })
    }
    const selected = detail.report.cases
      .filter((reportCase) => selectedSet.has(reportCase.evalRevisionCaseId))
      .map((reportCase) => reportCase.evalRevisionCaseId)
    if (selected.length !== selectedSet.size) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYSIS_CASE_SELECTION_INVALID",
        message: "The Analyzer selection contains a Case outside this Report Revision.",
        kind: "validation",
      })
    }

    const settings = await readFile(this.options.claudeSettingsPath)
    const configuredModelId = parseConfiguredModelId(settings)
    const configurationFingerprint = sha256(settings)
    const runtimePolicyFingerprint = stableHash(this.runtimePolicy)
    const prompt = buildTestReportAnalyzerPrompt({
      report: detail.report,
      selectedEvalRevisionCaseIds: selected,
    })
    if (prompt.length > this.runtimePolicy.maxPromptCharacters) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYSIS_INPUT_TOO_LARGE",
        message: "The selected Report evidence exceeds the Analyzer input limit.",
        kind: "validation",
      })
    }
    const created = await this.options.repository.createPendingAnalysis({
      reportId,
      reportRevisionId: detail.currentRevisionId,
      configuredModelId,
      configurationFingerprint,
      semanticConfigurationFingerprint:
        semanticConfigurationFingerprint(settings),
      runtimePolicy: this.runtimePolicy,
      runtimePolicyFingerprint,
      promptVersion: testReportAnalysisPromptVersion,
      inputFingerprint: createTestReportAnalysisInputFingerprint({
        report: detail.report,
        selectedEvalRevisionCaseIds: selected,
        configuredModelId,
        semanticConfigurationFingerprint:
          semanticConfigurationFingerprint(settings),
        runtimePolicyFingerprint,
      }),
      selectedEvalRevisionCaseIds: selected,
      idempotencyKey,
    })
    if (created.status === "PENDING") this.launch(created.id)
    return created
  }

  async list(reportId: string) {
    return this.options.repository.listAnalyses(reportId)
  }

  async get(analysisId: string) {
    return this.options.repository.getAnalysis(analysisId)
  }

  async getDocument(
    analysisId: string,
    locale: TestReportDocumentLocale,
    format: "html" | "markdown",
  ) {
    const analysis = await this.options.repository.getAnalysis(analysisId)
    if (analysis.status !== "AVAILABLE" || !analysis.analysis) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYSIS_DOCUMENT_UNAVAILABLE",
        message: "The requested Analysis Revision is not available.",
        kind: "conflict",
      })
    }
    const report = await this.options.repository.getRevisionSnapshot(
      analysis.reportId,
      analysis.reportRevisionId,
    )
    return {
      content:
        format === "html"
          ? renderTestReportAnalysisHtml(
              analysis as TestReportAnalysisRevisionView & {
                readonly analysis: NonNullable<
                  TestReportAnalysisRevisionView["analysis"]
                >
              },
              report,
              locale,
            )
          : renderTestReportAnalysisMarkdown(
              analysis as TestReportAnalysisRevisionView & {
                readonly analysis: NonNullable<
                  TestReportAnalysisRevisionView["analysis"]
                >
              },
              report,
              locale,
            ),
      filename: getTestReportAnalysisDocumentFilename(
        analysis as TestReportAnalysisRevisionView & {
          readonly analysis: NonNullable<
            TestReportAnalysisRevisionView["analysis"]
          >
        },
        format,
      ),
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    await Promise.allSettled(
      [...this.activeSessions.values()].map((sessionId) =>
        this.options.agentSessions.cancel(sessionId),
      ),
    )
    let shutdownTimeout: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      Promise.allSettled(this.workers.values()),
      new Promise<void>((resolve) => {
        shutdownTimeout = setTimeout(resolve, 5_000)
        shutdownTimeout.unref?.()
      }),
    ])
    if (shutdownTimeout) clearTimeout(shutdownTimeout)
    await Promise.allSettled(
      [...this.activeSessions.values()].map((sessionId) =>
        this.options.agentSessions.abandon(
          sessionId,
          "The Analyzer Agent Session was interrupted during service shutdown.",
        ),
      ),
    )
    for (const sessionId of this.activeSessions.values()) {
      this.options.agentSessions.release(sessionId)
    }
  }

  private launch(analysisId: string): void {
    if (this.shuttingDown || this.workers.has(analysisId)) return
    const worker = this.run(analysisId)
      .catch(async (error: unknown) => {
        this.options.logger.error(
          { analysisId, error },
          "Test report Analyzer worker failed",
        )
        await this.workspace.remove(analysisId).catch((cleanupError) => {
          this.options.logger.error(
            { analysisId, error: cleanupError },
            "Failed Analyzer workspace could not be removed",
          )
        })
        await this.options.repository
          .failAnalysis(
            analysisId,
            error instanceof DomainError
              ? error.code
              : "TEST_REPORT_ANALYZER_FAILED",
            error instanceof DomainError
              ? error.message
              : "The Analyzer could not produce a valid Analysis Revision.",
          )
          .catch((persistenceError) => {
            this.options.logger.error(
              { analysisId, error: persistenceError },
              "Failed Analyzer state could not be persisted",
            )
          })
      })
      .finally(() => {
        this.workers.delete(analysisId)
      })
    this.workers.set(analysisId, worker)
  }

  private async run(analysisId: string): Promise<void> {
    const revision = await this.options.repository.getAnalysis(analysisId)
    if (revision.status !== "PENDING") return
    const report = await this.options.repository.getRevisionSnapshot(
      revision.reportId,
      revision.reportRevisionId,
    )
    const expectedInputFingerprint =
      createTestReportAnalysisInputFingerprint({
        report,
        selectedEvalRevisionCaseIds: revision.selectedEvalRevisionCaseIds,
        configuredModelId: revision.configuredModelId,
        semanticConfigurationFingerprint:
          revision.semanticConfigurationFingerprint,
        runtimePolicyFingerprint: revision.runtimePolicyFingerprint,
      })
    if (
      revision.promptVersion !== testReportAnalysisPromptVersion ||
      revision.inputFingerprint !== expectedInputFingerprint
    ) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYZER_PROTOCOL_CHANGED",
        message:
          "The frozen Analyzer protocol changed before execution; create a new Analysis Revision.",
        kind: "conflict",
      })
    }
    const prompt = buildTestReportAnalyzerPrompt({
      report,
      selectedEvalRevisionCaseIds: revision.selectedEvalRevisionCaseIds,
    })
    const settings = await readFile(this.options.claudeSettingsPath)
    const expectedConfigurationFingerprint = sha256(settings)
    if (
      expectedConfigurationFingerprint !== revision.configurationFingerprint ||
      parseConfiguredModelId(settings) !== revision.configuredModelId ||
      semanticConfigurationFingerprint(settings) !==
        revision.semanticConfigurationFingerprint ||
      stableHash(revision.runtimePolicy) !== revision.runtimePolicyFingerprint ||
      revision.runtimePolicyFingerprint !== stableHash(this.runtimePolicy)
    ) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYZER_CONFIGURATION_CHANGED",
        message:
          "The frozen Analyzer configuration changed before execution; create a new Analysis Revision.",
        kind: "conflict",
      })
    }
    const baseEnvironment = buildIsolatedAgentRuntimeEnvironment(settings)
    const prepared = await this.workspace.prepare(
      analysisId,
      revision.inputFingerprint,
    )
    const environment = forIsolatedAgentWorkspace(
      baseEnvironment,
      prepared.absolutePath,
    )
    let session: AgentSessionView | null = null
    let sessionTerminal = false
    let folded: FoldedAnalysisSession | null = null
    let timeout = false
    let result:
      | {
          readonly ok: true
          readonly analysis: ReturnType<typeof parseTestReportAnalysis>
          readonly usage: StoredTestRunUsage
          readonly modelId: string
        }
      | {
          readonly ok: false
          readonly code: string
          readonly message: string
          readonly usage: StoredTestRunUsage | null
          readonly modelId?: string
        }

    try {
      session = await this.options.agentSessions.createInWorkspace({
        prompt,
        systemPrompt: testReportAnalyzerSystemPrompt,
        workspaceLocator: prepared.locator,
        expectedConfigurationFingerprint,
        allowedTools: [],
        availableTools: [],
        enabledSkills: [],
        canUseTool: async () => ({
          behavior: "deny" as const,
          message: "Analyzer sessions do not permit tools.",
          interrupt: true,
        }),
        maxTurns: revision.runtimePolicy.maxTurns,
        maxBudgetUsd: revision.runtimePolicy.maxBudgetUsd,
        environment: environment.values,
        protectedEnvironmentNames: environment.protectedNames,
        sandboxPolicy: revision.runtimePolicy.sandboxPolicy,
        isolateSettings: true,
        persistSession: revision.runtimePolicy.persistSession,
        strictMcpConfig: revision.runtimePolicy.strictMcpConfig,
        additionalRedactedValues: [
          ...environment.sensitiveValues,
          prepared.absolutePath,
        ],
      })
      const claimed = await this.options.repository.claimAnalysis(
        analysisId,
        session.id,
      )
      if (!claimed) {
        await this.options.agentSessions.abandon(
          session.id,
          "The Analyzer Agent Session was superseded before its Analysis Revision could be claimed.",
        )
        sessionTerminal = true
        this.options.agentSessions.release(session.id)
        session = null
        await this.workspace.remove(analysisId)
        return
      }
      this.activeSessions.set(analysisId, session.id)
      const observedTerminal = await this.waitForTerminal(
        session.id,
        revision.runtimePolicy.timeoutMs,
      )
      sessionTerminal = observedTerminal
      if (!observedTerminal) {
        timeout = true
        await this.options.agentSessions.cancel(session.id).catch((error) => {
          this.options.logger.error(
            { analysisId, sessionId: session?.id, error },
            "Timed-out Analyzer session could not be canceled",
          )
        })
        sessionTerminal = await this.waitForTerminal(
          session.id,
          revision.runtimePolicy.cancellationGraceMs,
        )
        if (!sessionTerminal) {
          await this.options.agentSessions.abandon(
            session.id,
            "The Analyzer Agent Session did not terminate during its cancellation grace period.",
          )
          sessionTerminal = true
        }
      }
      folded = foldAnalysisEvents(
        await this.options.agentSessions.listEvents(session.id, 0),
      )
      await this.options.agentSessions.assertSourceConfigurationFingerprint(
        expectedConfigurationFingerprint,
      )
      result = this.validateResult(report, revision, folded, timeout)
    } catch (error) {
      const protocolError =
        error instanceof TestReportAnalysisProtocolError ? error : null
      result = {
        ok: false,
        code:
          protocolError?.code ??
          (error instanceof DomainError
            ? error.code
            : "TEST_REPORT_ANALYZER_FAILED"),
        message:
          protocolError?.message ??
          (error instanceof DomainError
            ? error.message
            : "The Analyzer could not produce a valid Analysis Revision."),
        usage: folded?.usage ?? null,
        ...(folded?.actualModelId
          ? { modelId: folded.actualModelId }
          : {}),
      }
    } finally {
      if (session) {
        if (!sessionTerminal) {
          await this.options.agentSessions.abandon(
            session.id,
            "The Analyzer Agent Session was abandoned before reaching a terminal event.",
          )
          sessionTerminal = true
        }
        this.options.agentSessions.release(session.id)
        this.activeSessions.delete(analysisId)
      }
    }

    try {
      await this.workspace.remove(analysisId)
    } catch (error) {
      this.options.logger.error(
        { analysisId, error },
        "Analyzer workspace cleanup failed",
      )
      result = {
        ok: false,
        code: "TEST_REPORT_ANALYZER_CLEANUP_FAILED",
        message: "The Analyzer workspace could not be safely removed.",
        usage: result.usage,
        ...(result.modelId ? { modelId: result.modelId } : {}),
      }
    }

    if (result.ok) {
      await this.options.repository.completeAnalysis(
        analysisId,
        result.analysis,
        result.usage,
        result.modelId,
      )
    } else {
      await this.options.repository.failAnalysis(
        analysisId,
        result.code,
        result.message,
        result.usage,
        result.modelId,
      )
    }
  }

  private validateResult(
    report: StructuredTestReportV1,
    revision: TestReportAnalysisRevisionView,
    folded: FoldedAnalysisSession,
    timedOut: boolean,
  ):
    | {
        readonly ok: true
        readonly analysis: ReturnType<typeof parseTestReportAnalysis>
        readonly usage: StoredTestRunUsage
        readonly modelId: string
      }
    | {
        readonly ok: false
        readonly code: string
        readonly message: string
        readonly usage: StoredTestRunUsage | null
        readonly modelId?: string
      } {
    const model = folded.actualModelId ?? undefined
    if (timedOut) {
      return {
        ok: false,
        code: "TEST_REPORT_ANALYZER_TIMEOUT",
        message: "The Analyzer Agent Session exceeded its time limit.",
        usage: folded.usage,
        ...(model ? { modelId: model } : {}),
      }
    }
    if (!folded.initialized || !model) {
      return {
        ok: false,
        code: "TEST_REPORT_ANALYZER_INITIALIZATION_INCOMPLETE",
        message: "The Analyzer runtime did not provide initialization facts.",
        usage: folded.usage,
      }
    }
    if (
      folded.exposedTools.length > 0 ||
      folded.exposedSkills.length > 0 ||
      folded.exposedMcpServers.length > 0 ||
      folded.toolUseObserved
    ) {
      return {
        ok: false,
        code: "TEST_REPORT_ANALYZER_ISOLATION_VIOLATION",
        message: "The Analyzer runtime exposed a prohibited tool, Skill, or MCP surface.",
        usage: folded.usage,
        modelId: model,
      }
    }
    if (folded.terminalType !== "turn.completed") {
      return {
        ok: false,
        code: folded.error?.code ?? "TEST_REPORT_ANALYZER_RUNTIME_FAILED",
        message:
          folded.error?.message ?? "The Analyzer Agent Session did not complete.",
        usage: folded.usage,
        modelId: model,
      }
    }
    if (!folded.usage) {
      return {
        ok: false,
        code: "TEST_REPORT_ANALYZER_USAGE_MISSING",
        message: "The Analyzer Agent Session did not provide Usage facts.",
        usage: null,
        modelId: model,
      }
    }
    if (
      !folded.finalOutput ||
      folded.finalOutput.length > revision.runtimePolicy.maxResponseCharacters
    ) {
      return {
        ok: false,
        code: "TEST_REPORT_ANALYZER_OUTPUT_INVALID",
        message: "The Analyzer response was empty or exceeded its size limit.",
        usage: folded.usage,
        modelId: model,
      }
    }
    const sanitized = String(
      sanitizeTestRunPublicValue(folded.finalOutput),
    )
    return {
      ok: true,
      analysis: parseTestReportAnalysis(
        sanitized,
        report,
        revision.selectedEvalRevisionCaseIds,
      ),
      usage: folded.usage,
      modelId: model,
    }
  }

  private async waitForTerminal(
    sessionId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    let resolve: ((value: boolean) => void) | null = null
    let settled = false
    const completion = new Promise<boolean>((done) => {
      resolve = done
    })
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve?.(value)
    }
    const unsubscribe = this.options.agentSessions.subscribe(
      sessionId,
      (event) => {
        if (terminalAgentEvents.has(event.type)) finish(true)
      },
    )
    const timeout = setTimeout(() => finish(false), timeoutMs)
    try {
      const backlog = await this.options.agentSessions.listEvents(sessionId, 0)
      if (backlog.some((event) => terminalAgentEvents.has(event.type))) {
        finish(true)
      }
      return await completion
    } finally {
      clearTimeout(timeout)
      unsubscribe()
    }
  }
}
