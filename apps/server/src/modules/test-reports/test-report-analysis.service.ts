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
  buildTaskAgentRuntimeEnvironment,
  forTaskAgentWorkspace,
} from "../test-runs/test-run-runtime-environment.js"
import { sanitizeTestRunPublicValue } from "../test-runs/test-run-public-safety.js"
import type {
  StructuredTestReportV1,
  TestReportAnalysisLogEvent,
  TestReportAnalysisLogPage,
  TestReportAnalysisRevisionView,
  TestReportAnalyzerRuntimePolicy,
} from "./test-report.domain.js"
import { TestReportAnalysisDiagnostics } from "./test-report-analysis-diagnostics.js"
import {
  createTestReportAnalysisInputFingerprint,
  parseTestReportAnalysis,
  TestReportAnalysisProtocolError,
} from "./test-report-analysis-protocol.js"
import {
  getTestReportAnalysisDocumentFilename,
  renderTestReportAnalysisHtml,
  renderTestReportAnalysisMarkdown,
} from "./test-report-analysis-renderer.js"
import {
  getCombinedTestReportDocumentFilename,
  renderCombinedTestReportHtml,
} from "./test-report-combined-renderer.js"
import { TestReportAnalysisWorkspace } from "./test-report-analysis-workspace.js"
import type { TestReportDocumentLocale } from "./test-report-renderer.js"
import { TestReportRepository } from "./test-report.repository.js"

const analyzerRuntimePolicy = {
  schemaVersion: "test-report-analyzer-runtime-policy.v4",
  timeoutMs: 1_800_000,
  cancellationGraceMs: 5_000,
  maxInputCharacters: 500_000,
  capabilitySource: "project_settings",
  promptControlledFileAccess: true,
} as const satisfies TestReportAnalyzerRuntimePolicy

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
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
  private readonly diagnostics: TestReportAnalysisDiagnostics
  private readonly runtimePolicy: TestReportAnalyzerRuntimePolicy
  private readonly workers = new Map<string, Promise<void>>()
  private readonly activeSessions = new Map<string, string>()
  private readonly recordedAgentEventSequences = new Map<string, Set<number>>()
  private shuttingDown = false

  constructor(private readonly options: TestReportAnalysisServiceOptions) {
    this.workspace = new TestReportAnalysisWorkspace(options.dataRoot)
    this.diagnostics = new TestReportAnalysisDiagnostics(options.dataRoot)
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
      await this.registerAnalysisReport(analysisId)
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
    await this.options.agentSessions.registerRunReport(detail.runId, reportId)
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
    const systemPrompt =
      await this.options.agentSessions.getSystemPrompt("test-report-analyzer")
    const configuredModelId = parseConfiguredModelId(settings)
    const configurationFingerprint = sha256(settings)
    const runtimePolicyFingerprint = stableHash(this.runtimePolicy)
    const inputCharacterCount = JSON.stringify(detail.report).length
    if (inputCharacterCount > this.runtimePolicy.maxInputCharacters) {
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
      promptVersion: systemPrompt.version,
      inputFingerprint: createTestReportAnalysisInputFingerprint({
        report: detail.report,
        selectedEvalRevisionCaseIds: selected,
        configuredModelId,
        semanticConfigurationFingerprint:
          semanticConfigurationFingerprint(settings),
        runtimePolicyFingerprint,
        promptVersion: systemPrompt.version,
      }),
      selectedEvalRevisionCaseIds: selected,
      idempotencyKey,
    })
    if (created.status === "PENDING") this.launch(created.id)
    return created
  }

  async list(reportId: string) {
    await this.options.agentSessions.registerRunReport(
      (await this.options.repository.getRow(reportId)).runId,
      reportId,
    )
    return this.options.repository.listAnalyses(reportId)
  }

  async get(analysisId: string) {
    await this.registerAnalysisReport(analysisId)
    return this.options.repository.getAnalysis(analysisId)
  }

  async listLogs(
    analysisId: string,
    input: { readonly beforeSequence?: number; readonly limit: number },
  ): Promise<TestReportAnalysisLogPage> {
    const analysis = await this.options.repository.getAnalysis(analysisId)
    if (!analysis.agentSessionId) {
      return {
        items: [],
        pagination: {
          limit: input.limit,
          hasMore: false,
          nextBeforeSequence: null,
        },
      }
    }
    const events = (
      await this.options.agentSessions.listEvents(analysis.agentSessionId, 0)
    ).filter(
      (event) =>
        input.beforeSequence === undefined ||
        event.sequence < input.beforeSequence,
    )
    const hasMore = events.length > input.limit
    const selected = events.slice(-input.limit)
    return {
      items: selected.map((event) => this.toLogEvent(analysisId, event)),
      pagination: {
        limit: input.limit,
        hasMore,
        nextBeforeSequence: hasMore ? (selected[0]?.sequence ?? null) : null,
      },
    }
  }

  async subscribeLogs(
    analysisId: string,
    listener: (event: TestReportAnalysisLogEvent) => void,
  ): Promise<() => void> {
    const analysis = await this.options.repository.getAnalysis(analysisId)
    if (!analysis.agentSessionId) return () => undefined
    return this.options.agentSessions.subscribe(
      analysis.agentSessionId,
      (event) => listener(this.toLogEvent(analysisId, event)),
    )
  }

  async replayLogs(
    analysisId: string,
    afterSequence: number,
  ): Promise<readonly TestReportAnalysisLogEvent[]> {
    const analysis = await this.options.repository.getAnalysis(analysisId)
    if (!analysis.agentSessionId) return []
    return (
      await this.options.agentSessions.listEvents(
        analysis.agentSessionId,
        afterSequence,
      )
    ).map((event) => this.toLogEvent(analysisId, event))
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

  async getCombinedHtmlDocument(
    analysisId: string,
    locale: TestReportDocumentLocale,
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
    const renderable = analysis as TestReportAnalysisRevisionView & {
      readonly analysis: NonNullable<
        TestReportAnalysisRevisionView["analysis"]
      >
    }
    return {
      content: renderCombinedTestReportHtml(renderable, report, locale),
      filename: getCombinedTestReportDocumentFilename(renderable, report),
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
    await this.diagnostics.flush()
  }

  private launch(analysisId: string): void {
    if (this.shuttingDown || this.workers.has(analysisId)) return
    const worker = this.run(analysisId)
      .catch(async (error: unknown) => {
        await this.recordDiagnostic(analysisId, "analysis.worker.failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
        })
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
        this.recordedAgentEventSequences.delete(analysisId)
        this.workers.delete(analysisId)
      })
    this.workers.set(analysisId, worker)
  }

  private async registerAnalysisReport(analysisId: string): Promise<void> {
    const analysis = await this.options.repository.getAnalysis(analysisId)
    const report = await this.options.repository.getRow(analysis.reportId)
    await this.options.agentSessions.registerRunReport(report.runId, report.id)
  }

  private async run(analysisId: string): Promise<void> {
    const revision = await this.options.repository.getAnalysis(analysisId)
    if (revision.status !== "PENDING") return
    await this.recordDiagnostic(analysisId, "analysis.execution.started", {
      reportId: revision.reportId,
      reportRevisionId: revision.reportRevisionId,
      revisionNumber: revision.revisionNumber,
      configuredModelId: revision.configuredModelId,
      selectedCaseCount: revision.selectedEvalRevisionCaseIds.length,
      runtimePolicy: revision.runtimePolicy,
      inputFingerprint: revision.inputFingerprint,
    })
    const report = await this.options.repository.getRevisionSnapshot(
      revision.reportId,
      revision.reportRevisionId,
    )
    const systemPrompt =
      await this.options.agentSessions.getSystemPrompt("test-report-analyzer")
    const expectedInputFingerprint =
      createTestReportAnalysisInputFingerprint({
        report,
        selectedEvalRevisionCaseIds: revision.selectedEvalRevisionCaseIds,
        configuredModelId: revision.configuredModelId,
        semanticConfigurationFingerprint:
          revision.semanticConfigurationFingerprint,
        runtimePolicyFingerprint: revision.runtimePolicyFingerprint,
        promptVersion: revision.promptVersion,
      })
    if (
      revision.promptVersion !== systemPrompt.version ||
      revision.inputFingerprint !== expectedInputFingerprint
    ) {
      throw new DomainError({
        code: "TEST_REPORT_ANALYZER_PROTOCOL_CHANGED",
        message:
          "The frozen Analyzer protocol changed before execution; create a new Analysis Revision.",
        kind: "conflict",
      })
    }
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
    const baseEnvironment = buildTaskAgentRuntimeEnvironment(settings)
    const prepared = await this.workspace.prepare(
      analysisId,
      {
        inputFingerprint: revision.inputFingerprint,
        promptVersion: revision.promptVersion,
        configuredModelId: revision.configuredModelId,
        report,
        selectedEvalRevisionCaseIds: revision.selectedEvalRevisionCaseIds,
      },
    )
    const prompt = [
      "Read the analysis task manifest from this exact absolute path:",
      JSON.stringify(prepared.taskPath),
      "Use this path exactly as provided. Do not replace it, resolve it to another directory, or guess an alternative path. Analyze the referenced frozen report and write the required JSON output to the exact outputPath declared in the manifest.",
    ].join("\n")
    await this.recordDiagnostic(analysisId, "analysis.prompt.prepared", {
      characterCount: prompt.length,
      sha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
      systemPromptVersion: systemPrompt.version,
    })
    await this.recordDiagnostic(analysisId, "analysis.workspace.prepared", {
      systemPromptVersion: systemPrompt.version,
      capabilitySource: revision.runtimePolicy.capabilitySource,
      taskPath: "inputs/task.json",
      reportPath: "inputs/fact-report.json",
      selectedCasesPath: "inputs/selected-cases.json",
      contextPath: "inputs/analysis-context.json",
      outputPath: "outputs/analysis.json",
      inputFileCount: prepared.inputFiles.length,
      reportCharacterCount: JSON.stringify(report).length,
      selectedCaseCount: revision.selectedEvalRevisionCaseIds.length,
    })
    const environment = forTaskAgentWorkspace(
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
        origin: {
          type: "report_analyzer",
          runId: report.runId,
          reportId: revision.reportId,
          analysisId,
          revisionId: revision.reportRevisionId,
          phase: "analysis",
        },
        prompt,
        systemPromptRole: "test-report-analyzer",
        expectedSystemPromptFingerprint: systemPrompt.sha256,
        workspaceLocator: prepared.locator,
        expectedConfigurationFingerprint,
        environment: environment.values,
        protectedEnvironmentNames: environment.protectedNames,
        additionalRedactedValues: [
          ...environment.sensitiveValues,
          prepared.absolutePath,
          prepared.taskPath,
          prepared.reportPath,
          prepared.selectedCasesPath,
          prepared.contextPath,
          prepared.outputPath,
        ],
        onRuntimeDiagnostic: (diagnostic) =>
          this.recordDiagnostic(analysisId, "sdk.message", {
            messageType: diagnostic.messageType,
            subtype: diagnostic.subtype,
            details: diagnostic.details,
          }),
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
        analysisId,
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
          analysisId,
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
      if (!timeout && folded.terminalType === "turn.completed") {
        await this.workspace.verifyInputs(prepared)
        const output = await this.workspace.readOutput(prepared)
        await this.recordDiagnostic(analysisId, "analysis.output.loaded", {
          outputPath: "outputs/analysis.json",
          characterCount: output.length,
          sha256: createHash("sha256").update(output, "utf8").digest("hex"),
        })
        folded = {
          ...folded,
          finalOutput: output,
        }
      }
      await this.recordDiagnostic(analysisId, "analysis.session.folded", {
        timedOut: timeout,
        initialized: folded.initialized,
        actualModelId: folded.actualModelId,
        terminalType: folded.terminalType,
        finalOutputCharacterCount: folded.finalOutput?.length ?? 0,
        exposedTools: folded.exposedTools,
        exposedSkills: folded.exposedSkills,
        exposedMcpServers: folded.exposedMcpServers,
        toolUseObserved: folded.toolUseObserved,
        usage: folded.usage,
        error: folded.error,
      })
      await this.options.agentSessions.assertWorkspaceConfigurationFingerprint(
        prepared.locator,
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
        await this.options.agentSessions
          .annotateFinalOutputProtocol(
            session.id,
            result!.ok
              ? "VALID"
              : result!.code === "TEST_REPORT_ANALYZER_OUTPUT_INVALID" ||
                  result!.code.includes("PROTOCOL")
                ? "INVALID"
                : "NOT_APPLICABLE",
          )
          .catch((error) => {
            this.options.logger.error(
              { analysisId, sessionId: session?.id, error },
              "Analyzer native final-output protocol status could not be recorded",
            )
          })
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
      await this.recordDiagnostic(analysisId, "analysis.completed", {
        status: "AVAILABLE",
        modelId: result.modelId,
        usage: result.usage,
      })
    } else {
      await this.options.repository.failAnalysis(
        analysisId,
        result.code,
        result.message,
        result.usage,
        result.modelId,
      )
      await this.recordDiagnostic(analysisId, "analysis.failed", {
        status: "FAILED",
        code: result.code,
        message: result.message,
        modelId: result.modelId ?? null,
        usage: result.usage,
      })
    }
    await this.diagnostics.flush(analysisId)
  }

  private toLogEvent(
    analysisId: string,
    event: AgentSessionEvent,
  ): TestReportAnalysisLogEvent {
    return {
      sequence: event.sequence,
      type: event.type,
      analysisId,
      occurredAt: event.occurredAt,
      payload: sanitizeTestRunPublicValue(event.payload) as Readonly<
        Record<string, unknown>
      >,
    }
  }

  private async recordDiagnostic(
    analysisId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    try {
      await this.diagnostics.append(analysisId, type, payload)
    } catch (error) {
      this.options.logger.error(
        { analysisId, type, error },
        "Analyzer diagnostic event could not be written",
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
    if (!folded.finalOutput) {
      return {
        ok: false,
        code: "TEST_REPORT_ANALYZER_OUTPUT_INVALID",
        message: "The Analyzer response was empty.",
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
    analysisId: string,
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
    const recordedSequences =
      this.recordedAgentEventSequences.get(analysisId) ?? new Set<number>()
    this.recordedAgentEventSequences.set(analysisId, recordedSequences)
    const recordEvent = (
      event: AgentSessionEvent,
      replayed: boolean,
    ): Promise<void> => {
      if (recordedSequences.has(event.sequence)) return Promise.resolve()
      recordedSequences.add(event.sequence)
      return this.recordDiagnostic(
        analysisId,
        replayed ? "agent.event.replayed" : "agent.event",
        {
          sequence: event.sequence,
          type: event.type,
          occurredAt: event.occurredAt,
          payload: event.payload,
        },
      )
    }
    const unsubscribe = this.options.agentSessions.subscribe(
      sessionId,
      (event) => {
        void recordEvent(event, false)
        if (terminalAgentEvents.has(event.type)) finish(true)
      },
    )
    const timeout = setTimeout(() => finish(false), timeoutMs)
    try {
      const backlog = await this.options.agentSessions.listEvents(sessionId, 0)
      for (const event of backlog) {
        await recordEvent(event, true)
      }
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
