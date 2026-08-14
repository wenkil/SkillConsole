import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import type { SDKMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk"
import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "../../infrastructure/database/index.js"
import {
  agentSessionLogArtifacts,
  agentSessions,
} from "../../infrastructure/database/schema/index.js"
import type {
  AgentRuntimeDiagnostic,
  AgentSessionLogStatus,
  AgentSessionOrigin,
} from "./agent-session.domain.js"
import { AgentSessionJsonlWriter } from "./agent-session-jsonl-writer.js"
import { AgentSessionTranscriptStore } from "./agent-session-transcript-store.js"

const artifactTypes: Readonly<Record<string, string>> = {
  "metadata.json": "METADATA",
  "sdk-messages.jsonl": "SDK_MESSAGES",
  "transcript/main.jsonl": "TRANSCRIPT_MAIN",
  "diagnostics.jsonl": "DIAGNOSTICS",
  "usage.json": "USAGE",
  "final-output.json": "FINAL_OUTPUT",
}

interface AgentSessionLogLogger {
  readonly error: (
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ) => void
}

interface TerminalEvidence {
  readonly kind:
    | "result"
    | "canceled"
    | "runtime_failure"
    | "startup_failure"
    | "shutdown"
    | "recovery"
  readonly errorCode?: string
  readonly errorMessage?: string
}

interface ResultUsageEvidence {
  readonly usage: Readonly<Record<string, number>>
  readonly output: string
  readonly totalCostUsd: number
  readonly durationMs: number
  readonly durationApiMs: number
  readonly numTurns: number
  readonly subtype: string
}

interface AssistantEvidence {
  readonly messageId: string
  readonly usage: Readonly<Record<string, number>> | null
  readonly text: string
  readonly thinking: string
  readonly aborted: boolean
}

interface LogCollector {
  resultUsages: ResultUsageEvidence[]
  assistantMessages: AssistantEvidence[]
  partialText: string
  partialThinking: string
}

interface SessionLogHandle {
  readonly sessionId: string
  root: string
  readonly runtimeRoot: string
  readonly origin: AgentSessionOrigin
  readonly rawWriter: AgentSessionJsonlWriter
  readonly diagnosticWriter: AgentSessionJsonlWriter
  readonly transcriptStore: AgentSessionTranscriptStore
  readonly collector: LogCollector
  readonly startedAt: string
  sdkSessionId: string | null
  model: string | null
  mirrorFailed: boolean
  metadataWrite: Promise<void>
}

type GroupedSessionOrigin = Extract<
  AgentSessionOrigin,
  { readonly type: "test_run_execution" | "test_run_grader" | "report_analyzer" }
>

interface RunLogManifestSession {
  readonly agentSessionId: string
  readonly sdkSessionId: string | null
  readonly relativePath: string
  readonly origin: AgentSessionOrigin
  readonly status: AgentSessionLogStatus
  readonly updatedAt: string
}

interface RunLogManifestSideSessions {
  readonly execution: RunLogManifestSession | null
  readonly grading: RunLogManifestSession | null
}

interface RunLogManifestCase {
  readonly caseKey: string
  readonly externalId: number
  readonly targetCaseId: string | null
  readonly baselineCaseId: string | null
  readonly sessions: {
    readonly target: RunLogManifestSideSessions
    readonly baseline: RunLogManifestSideSessions
  }
}

interface RunLogManifestReport {
  readonly reportId: string
  readonly url: string
  readonly relativePath: string
  readonly analyses: readonly {
    readonly analysisId: string
    readonly revisionId: string
  }[]
}

interface RunLogManifest {
  readonly schemaVersion: "run-log-manifest.v1"
  readonly runId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly cases: readonly RunLogManifestCase[]
  readonly report: RunLogManifestReport | null
}

function isGroupedSessionOrigin(
  origin: AgentSessionOrigin,
): origin is GroupedSessionOrigin {
  if (origin.type === "test_run_execution" || origin.type === "test_run_grader") {
    return (
      typeof origin.runId === "string" &&
      typeof origin.caseId === "string" &&
      Number.isSafeInteger(origin.externalId) &&
      (origin.side === "TARGET" || origin.side === "BASELINE") &&
      (origin.phase === "execution" || origin.phase === "grading")
    )
  }
  return (
    origin.type === "report_analyzer" &&
    typeof origin.runId === "string" &&
    typeof origin.reportId === "string" &&
    typeof origin.analysisId === "string" &&
    typeof origin.revisionId === "string" &&
    origin.phase === "analysis"
  )
}

function groupedRunId(origin: AgentSessionOrigin): string | null {
  return isGroupedSessionOrigin(origin) ? origin.runId : null
}

function caseKey(externalId: number): string {
  return `case-${String(externalId).padStart(3, "0")}`
}

function canonicalRelativePath(
  origin: AgentSessionOrigin,
  sessionLeaf: string,
): string | null {
  if (!isGroupedSessionOrigin(origin)) return null
  if (!/^[A-Za-z0-9._-]+$/u.test(sessionLeaf)) {
    throw new Error("Claude SDK Session ID is not a safe path segment.")
  }
  if (origin.type === "report_analyzer") {
    return path.posix.join(
      origin.runId,
      "report",
      origin.reportId,
      "analyses",
      origin.analysisId,
      sessionLeaf,
    )
  }
  return path.posix.join(
    origin.runId,
    "cases",
    caseKey(origin.externalId),
    origin.side.toLowerCase(),
    origin.phase,
    sessionLeaf,
  )
}

function emptyRunLogManifest(runId: string): RunLogManifest {
  const now = new Date().toISOString()
  return {
    schemaVersion: "run-log-manifest.v1",
    runId,
    createdAt: now,
    updatedAt: now,
    cases: [],
    report: null,
  }
}

function emptyRunLogManifestSideSessions(): RunLogManifestSideSessions {
  return { execution: null, grading: null }
}

function metadataContext(origin: AgentSessionOrigin): Readonly<Record<string, unknown>> {
  if (origin.type === "test_run_execution" || origin.type === "test_run_grader") {
    return {
      runId: origin.runId,
      caseKey: caseKey(origin.externalId),
      caseId: origin.caseId,
      externalId: origin.externalId,
      side: origin.side,
      phase: origin.phase,
    }
  }
  if (origin.type === "report_analyzer") {
    return {
      runId: origin.runId,
      reportId: origin.reportId,
      analysisId: origin.analysisId,
      revisionId: origin.revisionId,
      phase: origin.phase,
    }
  }
  return {}
}

function numericRecord(value: unknown): Readonly<Record<string, number>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  )
}

function contentText(
  content: unknown,
  key: "text" | "thinking",
): string {
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return []
      const record = block as Readonly<Record<string, unknown>>
      return typeof record[key] === "string" ? [record[key]] : []
    })
    .join("")
}

function observeMessage(collector: LogCollector, message: SDKMessage): void {
  const record = message as unknown as Readonly<Record<string, unknown>>
  if (record.type === "assistant") {
    const nested = record.message as Readonly<Record<string, unknown>> | undefined
    collector.assistantMessages.push({
      messageId:
        typeof nested?.id === "string"
          ? nested.id
          : typeof record.uuid === "string"
            ? record.uuid
            : "unknown",
      usage: numericRecord(nested?.usage),
      text: contentText(nested?.content, "text"),
      thinking: contentText(nested?.content, "thinking"),
      aborted: record.aborted === true,
    })
  }
  if (record.type === "result") {
    collector.resultUsages.push({
      usage: numericRecord(record.usage) ?? {},
      output: typeof record.result === "string" ? record.result : "",
      totalCostUsd: typeof record.total_cost_usd === "number" ? record.total_cost_usd : 0,
      durationMs: typeof record.duration_ms === "number" ? record.duration_ms : 0,
      durationApiMs: typeof record.duration_api_ms === "number" ? record.duration_api_ms : 0,
      numTurns: typeof record.num_turns === "number" ? record.num_turns : 0,
      subtype: typeof record.subtype === "string" ? record.subtype : "unknown",
    })
  }
  if (record.type === "stream_event") {
    const event = record.event as Readonly<Record<string, unknown>> | undefined
    const delta = event?.delta as Readonly<Record<string, unknown>> | undefined
    if (typeof delta?.text === "string") collector.partialText += delta.text
    if (typeof delta?.thinking === "string") collector.partialThinking += delta.thinking
  }
}

function sumUsage(results: readonly ResultUsageEvidence[]) {
  const keys = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ] as const
  return Object.fromEntries(
    keys.map((key) => [
      key,
      results.reduce((sum, result) => sum + (result.usage[key] ?? 0), 0),
    ]),
  )
}

function sumNumericRecords(
  records: readonly Readonly<Record<string, number>>[],
): Readonly<Record<string, number>> {
  const total: Record<string, number> = {}
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      total[key] = (total[key] ?? 0) + value
    }
  }
  return total
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await rename(temporary, filePath)
  await chmod(filePath, 0o600).catch(() => undefined)
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex")
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const target = path.join(current, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, target))
    if (entry.isFile()) files.push(path.relative(root, target).split(path.sep).join("/"))
  }
  return files
}

function emptyCollector(): LogCollector {
  return {
    resultUsages: [],
    assistantMessages: [],
    partialText: "",
    partialThinking: "",
  }
}

export class AgentSessionLogManager {
  private readonly logsRoot: string
  private readonly runtimeRoot: string
  private readonly handles = new Map<string, SessionLogHandle>()
  private readonly manifestWrites = new Map<string, Promise<void>>()

  constructor(
    dataRoot: string,
    private readonly database: Database,
    private readonly logger: AgentSessionLogLogger,
  ) {
    this.logsRoot = path.resolve(dataRoot, "agent-session-logs")
    this.runtimeRoot = path.resolve(dataRoot, "claude-runtime")
  }

  async initialize(): Promise<void> {
    await mkdir(this.logsRoot, { recursive: true, mode: 0o700 })
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 })
    await Promise.all([
      chmod(this.logsRoot, 0o700).catch(() => undefined),
      chmod(this.runtimeRoot, 0o700).catch(() => undefined),
    ])
    await this.recover()
  }

  async registerRunReport(runId: string, reportId: string): Promise<void> {
    const previous = this.manifestWrites.get(runId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const manifestPath = path.join(this.logsRoot, runId, "manifest.json")
      const manifest = await this.readRunManifest(manifestPath, runId)
      const existingReport = manifest.report?.reportId === reportId
        ? manifest.report
        : null
      await atomicWriteJson(manifestPath, {
        ...manifest,
        updatedAt: new Date().toISOString(),
        report: {
          reportId,
          url: `/reports/${reportId}`,
          relativePath: path.posix.join("report", reportId),
          analyses: existingReport?.analyses ?? [],
        },
      } satisfies RunLogManifest)
    })
    this.manifestWrites.set(runId, next.catch(() => undefined))
    await next
  }

  async prepare(sessionId: string, origin: AgentSessionOrigin): Promise<void> {
    const handle = this.createHandle(sessionId, origin)
    await mkdir(path.join(handle.root, "transcript", "subagents"), {
      recursive: true,
      mode: 0o700,
    })
    await mkdir(handle.runtimeRoot, { recursive: true, mode: 0o700 })
    await Promise.all([
      chmod(handle.root, 0o700).catch(() => undefined),
      chmod(handle.runtimeRoot, 0o700).catch(() => undefined),
    ])
    await Promise.all([
      handle.rawWriter.initialize(),
      handle.diagnosticWriter.initialize(),
      handle.transcriptStore.initialize(),
    ])
    await atomicWriteJson(path.join(handle.root, "usage.json"), {
      status: "UNAVAILABLE",
      source: null,
      resultUsages: [],
      assistantUsages: [],
    })
    await atomicWriteJson(path.join(handle.root, "final-output.json"), {
      status: "UNAVAILABLE",
      protocolStatus: "UNKNOWN",
      text: "",
      thinking: "",
      messageId: null,
      characterCount: 0,
      sha256: createHash("sha256").update("").digest("hex"),
      complete: false,
      aborted: false,
    })
    await this.writeMetadata(handle, "WRITING")
    await this.writeRunManifest(handle, "WRITING")
    this.handles.set(sessionId, handle)
  }

  async beginTurn(sessionId: string): Promise<void> {
    const handle = await this.requireHandle(sessionId)
    await this.database
      .update(agentSessions)
      .set({
        logStatus: "WRITING",
        logErrorCode: null,
        logErrorMessage: null,
        logsFinalizedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, sessionId))
    await this.writeMetadata(handle, "WRITING")
  }

  getRuntimeConfiguration(sessionId: string): {
    readonly claudeConfigDir: string
    readonly sessionStore: AgentSessionTranscriptStore
  } {
    const handle = this.handles.get(sessionId)
    if (!handle) throw new Error("Agent Session log handle is unavailable.")
    return {
      claudeConfigDir: handle.runtimeRoot,
      sessionStore: handle.transcriptStore,
    }
  }

  async recordRawMessage(sessionId: string, message: SDKMessage): Promise<void> {
    const handle = await this.requireHandle(sessionId)
    await handle.rawWriter.append(message)
    observeMessage(handle.collector, message)
  }

  async recordDiagnostic(
    sessionId: string,
    diagnostic: AgentRuntimeDiagnostic | Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const handle = await this.requireHandle(sessionId)
    await handle.diagnosticWriter.append({
      schemaVersion: "agent-session-diagnostic.v1",
      sessionId,
      occurredAt: new Date().toISOString(),
      ...diagnostic,
    })
  }

  async markInitialized(
    sessionId: string,
    sdkSessionId: string,
    model: string,
  ): Promise<void> {
    const handle = await this.requireHandle(sessionId)
    await this.bindSdkSessionId(handle, sdkSessionId)
    handle.model = model
    await this.writeMetadata(handle, "WRITING")
    await this.writeRunManifest(handle, "WRITING")
  }

  async finalize(
    sessionId: string,
    terminal: TerminalEvidence,
  ): Promise<{ readonly status: AgentSessionLogStatus; readonly error: string | null }> {
    const handle = await this.requireHandle(sessionId)
    await this.recordDiagnostic(sessionId, {
      messageType: "session.logs.finalizing",
      subtype: terminal.kind,
      details: {
        ...(terminal.errorCode ? { errorCode: terminal.errorCode } : {}),
        ...(terminal.errorMessage ? { errorMessage: terminal.errorMessage } : {}),
      },
    }).catch(() => undefined)

    await this.backfillLocalTranscript(handle).catch((error) => {
      handle.mirrorFailed = true
      this.logger.error({ sessionId, error }, "Claude transcript backfill failed")
    })

    let flushError: unknown = null
    try {
      await Promise.all([
        handle.rawWriter.flush(),
        handle.diagnosticWriter.flush(),
        handle.transcriptStore.flush(),
      ])
    } catch (error) {
      flushError = error
    }

    await this.writeUsage(handle)
    await this.writeFinalOutput(handle)

    const rawSize = await this.fileSize(path.join(handle.root, "sdk-messages.jsonl"))
    const transcriptSize = await this.fileSize(path.join(handle.root, "transcript", "main.jsonl"))
    const explicitStartupFailure = terminal.kind === "startup_failure"
    let status: AgentSessionLogStatus
    let error: string | null = null
    if (flushError) {
      status = rawSize > 0 || transcriptSize > 0 ? "RECOVERY_REQUIRED" : "FAILED"
      error = "Agent Session log flush failed."
    } else if (rawSize > 0 && transcriptSize > 0 && !handle.mirrorFailed) {
      status = "COMPLETE"
    } else if (explicitStartupFailure) {
      status = "COMPLETE"
    } else if (rawSize > 0 || transcriptSize > 0) {
      status = "DEGRADED"
      error = "One native Agent Session evidence channel is unavailable."
    } else {
      status = "FAILED"
      error = "Neither the SDK message stream nor Claude transcript was saved."
    }

    const artifactSummary = await this.collectArtifactSummary(handle)
    await this.writeMetadata(
      handle,
      status,
      terminal,
      error,
      artifactSummary,
    )
    await Promise.allSettled([
      handle.rawWriter.close(),
      handle.diagnosticWriter.close(),
      handle.transcriptStore.close(),
    ])
    const movedToCanonicalPath = await this.moveToCanonicalPath(handle)
    if (movedToCanonicalPath) {
      await this.writeMetadata(
        handle,
        status,
        terminal,
        error,
        artifactSummary,
      )
    }
    await this.writeRunManifest(handle, status)
    await this.indexArtifacts(handle, status)
    const finalizedAt = new Date()
    await this.database
      .update(agentSessions)
      .set({
        logStatus: status,
        logErrorCode: error ? "AGENT_SESSION_LOG_PERSISTENCE_FAILED" : null,
        logErrorMessage: error,
        logsFinalizedAt: finalizedAt,
        updatedAt: finalizedAt,
      })
      .where(eq(agentSessions.id, sessionId))
    return { status, error }
  }

  async annotateProtocol(
    sessionId: string,
    protocolStatus: "VALID" | "INVALID" | "NOT_APPLICABLE",
  ): Promise<void> {
    const root = await this.resolveExistingSessionRoot(sessionId)
    const filePath = path.join(root, "final-output.json")
    const current = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
    await atomicWriteJson(filePath, { ...current, protocolStatus })
    const finalInfo = await stat(filePath)
    const finalSha256 = await sha256File(filePath)
    const metadataPath = path.join(root, "metadata.json")
    const metadata = JSON.parse(
      await readFile(metadataPath, "utf8"),
    ) as Record<string, unknown>
    const artifacts = Array.isArray(metadata.artifacts)
      ? metadata.artifacts.map((artifact) => {
          if (
            !artifact ||
            typeof artifact !== "object" ||
            Array.isArray(artifact) ||
            (artifact as Record<string, unknown>).storagePath !==
              "final-output.json"
          ) {
            return artifact
          }
          return {
            ...(artifact as Record<string, unknown>),
            byteSize: finalInfo.size,
            sha256: finalSha256,
          }
        })
      : metadata.artifacts
    await atomicWriteJson(metadataPath, { ...metadata, artifacts })
    const metadataInfo = await stat(metadataPath)
    const finalizedAt = new Date()
    for (const artifact of [
      {
        storagePath: "final-output.json",
        byteSize: finalInfo.size,
        sha256: finalSha256,
      },
      {
        storagePath: "metadata.json",
        byteSize: metadataInfo.size,
        sha256: await sha256File(metadataPath),
      },
    ]) {
      await this.database
        .update(agentSessionLogArtifacts)
        .set({
          byteSize: artifact.byteSize,
          sha256: artifact.sha256,
          finalizedAt,
        })
        .where(
          and(
            eq(agentSessionLogArtifacts.agentSessionId, sessionId),
            eq(
              agentSessionLogArtifacts.storagePath,
              artifact.storagePath,
            ),
          ),
        )
    }
  }

  async release(sessionId: string): Promise<void> {
    const handle = this.handles.get(sessionId)
    if (!handle) return
    await Promise.allSettled([
      handle.rawWriter.close(),
      handle.diagnosticWriter.close(),
      handle.transcriptStore.close(),
    ])
    this.handles.delete(sessionId)
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.handles.keys()].map((sessionId) =>
        this.finalize(sessionId, { kind: "shutdown" }),
      ),
    )
    this.handles.clear()
  }

  private createHandle(
    sessionId: string,
    origin: AgentSessionOrigin,
    input?: { readonly sdkSessionId?: string | null; readonly model?: string | null },
  ): SessionLogHandle {
    const root = this.resolveSessionRoot(
      sessionId,
      origin,
      input?.sdkSessionId ?? null,
    )
    const handle = {} as SessionLogHandle
    Object.assign(handle, {
      sessionId,
      root,
      runtimeRoot: path.join(this.runtimeRoot, sessionId),
      origin,
      rawWriter: new AgentSessionJsonlWriter(path.join(root, "sdk-messages.jsonl")),
      diagnosticWriter: new AgentSessionJsonlWriter(path.join(root, "diagnostics.jsonl")),
      collector: emptyCollector(),
      startedAt: new Date().toISOString(),
      sdkSessionId: input?.sdkSessionId ?? null,
      model: input?.model ?? null,
      mirrorFailed: false,
      metadataWrite: Promise.resolve(),
    })
    Object.assign(handle, {
      transcriptStore: new AgentSessionTranscriptStore(
        path.join(root, "transcript"),
        (sdkSessionId) => this.bindSdkSessionId(handle, sdkSessionId),
        async (error) => {
          handle.mirrorFailed = true
          await this.recordDiagnostic(sessionId, {
            messageType: "session_store.error",
            subtype: "append_failed",
            details: { message: error instanceof Error ? error.message : String(error) },
          })
        },
      ),
    })
    return handle
  }

  private async requireHandle(sessionId: string): Promise<SessionLogHandle> {
    const existing = this.handles.get(sessionId)
    if (existing) return existing
    const [row] = await this.database
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1)
    if (!row?.origin) throw new Error("Agent Session log metadata is unavailable.")
    const handle = this.createHandle(
      sessionId,
      row.origin as unknown as AgentSessionOrigin,
      { sdkSessionId: row.sdkSessionId },
    )
    await Promise.all([
      handle.rawWriter.initialize(),
      handle.diagnosticWriter.initialize(),
      handle.transcriptStore.initialize(),
    ])
    try {
      const rawMessages = await readFile(
        path.join(handle.root, "sdk-messages.jsonl"),
        "utf8",
      )
      for (const line of rawMessages.split(/\r?\n/u).filter(Boolean)) {
        observeMessage(handle.collector, JSON.parse(line) as SDKMessage)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    this.handles.set(sessionId, handle)
    return handle
  }

  private resolveSessionRoot(
    sessionId: string,
    origin: AgentSessionOrigin,
    sdkSessionId: string | null,
  ): string {
    const legacyRoot = path.join(this.logsRoot, sessionId)
    const canonicalRelative = canonicalRelativePath(
      origin,
      sdkSessionId ?? `pending-${sessionId}`,
    )
    if (!canonicalRelative) return legacyRoot

    const canonicalRoot = path.join(this.logsRoot, canonicalRelative)
    const pendingRoot = path.join(
      this.logsRoot,
      canonicalRelativePath(origin, `pending-${sessionId}`) ?? canonicalRelative,
    )
    if (existsSync(canonicalRoot)) return canonicalRoot
    if (existsSync(pendingRoot)) return pendingRoot
    if (existsSync(legacyRoot)) return legacyRoot
    return sdkSessionId ? canonicalRoot : pendingRoot
  }

  private async resolveExistingSessionRoot(sessionId: string): Promise<string> {
    const handle = this.handles.get(sessionId)
    if (handle) return handle.root
    const [row] = await this.database
      .select({ origin: agentSessions.origin, sdkSessionId: agentSessions.sdkSessionId })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1)
    if (!row?.origin) {
      throw new Error("Agent Session log metadata is unavailable.")
    }
    return this.resolveSessionRoot(
      sessionId,
      row.origin as unknown as AgentSessionOrigin,
      row.sdkSessionId,
    )
  }

  private async moveToCanonicalPath(handle: SessionLogHandle): Promise<boolean> {
    if (!handle.sdkSessionId) return false
    const relativePath = canonicalRelativePath(handle.origin, handle.sdkSessionId)
    if (!relativePath) return false
    const target = path.join(this.logsRoot, relativePath)
    if (path.resolve(target) === path.resolve(handle.root)) return false
    if (existsSync(target)) {
      this.logger.error(
        {
          sessionId: handle.sessionId,
          sdkSessionId: handle.sdkSessionId,
          currentPath: handle.root,
          targetPath: target,
        },
        "Canonical Agent Session log path already exists.",
      )
      return false
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await rename(handle.root, target)
    handle.root = target
    return true
  }

  private async bindSdkSessionId(
    handle: SessionLogHandle,
    sdkSessionId: string,
  ): Promise<void> {
    if (handle.sdkSessionId && handle.sdkSessionId !== sdkSessionId) {
      throw new Error("Agent Session received conflicting Claude SDK Session IDs.")
    }
    if (handle.sdkSessionId === sdkSessionId) return
    handle.sdkSessionId = sdkSessionId
    await this.writeMetadata(handle, "WRITING")
  }

  private writeRunManifest(
    handle: SessionLogHandle,
    status: AgentSessionLogStatus,
  ): Promise<void> {
    const origin = handle.origin
    const runId = groupedRunId(origin)
    if (!runId) return Promise.resolve()
    const entry: RunLogManifestSession = {
      agentSessionId: handle.sessionId,
      sdkSessionId: handle.sdkSessionId,
      relativePath: path.relative(this.logsRoot, handle.root).split(path.sep).join("/"),
      origin,
      status,
      updatedAt: new Date().toISOString(),
    }
    const previous = this.manifestWrites.get(runId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const manifestPath = path.join(this.logsRoot, runId, "manifest.json")
      const manifest = await this.readRunManifest(manifestPath, runId)
      let cases = [...manifest.cases]
      let report = manifest.report
      if (origin.type === "test_run_execution" ||
          origin.type === "test_run_grader") {
        const existingCase = cases.find(
          (item) => item.externalId === origin.externalId,
        )
        const currentSessions = existingCase?.sessions ?? {
          target: emptyRunLogManifestSideSessions(),
          baseline: emptyRunLogManifestSideSessions(),
        }
        const side = origin.side.toLowerCase() as "target" | "baseline"
        const nextSideSessions: RunLogManifestSideSessions = {
          ...currentSessions[side],
          [origin.phase]: entry,
        }
        const nextSessions = side === "target"
          ? { ...currentSessions, target: nextSideSessions }
          : { ...currentSessions, baseline: nextSideSessions }
        const nextCase: RunLogManifestCase = {
          caseKey: caseKey(origin.externalId),
          externalId: origin.externalId,
          targetCaseId:
            origin.side === "TARGET"
              ? origin.caseId
              : existingCase?.targetCaseId ?? null,
          baselineCaseId:
            origin.side === "BASELINE"
              ? origin.caseId
              : existingCase?.baselineCaseId ?? null,
          sessions: nextSessions,
        }
        cases = [
          ...cases.filter(
            (item) => item.externalId !== origin.externalId,
          ),
          nextCase,
        ].sort((left, right) => left.externalId - right.externalId)
      }
      if (origin.type === "report_analyzer") {
        const existingReport = report?.reportId === origin.reportId
          ? report
          : null
        const analyses = existingReport?.analyses ?? []
        report = {
          reportId: origin.reportId,
          url: existingReport?.url ?? `/reports/${origin.reportId}`,
          relativePath:
            existingReport?.relativePath ??
            path.posix.join("report", origin.reportId),
          analyses: [
            ...analyses.filter(
              (item) => item.analysisId !== origin.analysisId,
            ),
            {
              analysisId: origin.analysisId,
              revisionId: origin.revisionId,
            },
          ],
        }
      }
      await atomicWriteJson(manifestPath, {
        ...manifest,
        updatedAt: new Date().toISOString(),
        cases,
        report,
      } satisfies RunLogManifest)
    })
    this.manifestWrites.set(runId, next.catch(() => undefined))
    return next
  }

  private async readRunManifest(
    manifestPath: string,
    runId: string,
  ): Promise<RunLogManifest> {
    try {
      const content = await readFile(manifestPath, "utf8")
      const parsed = JSON.parse(content) as Partial<RunLogManifest>
      return {
        schemaVersion: "run-log-manifest.v1",
        runId,
        createdAt: typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date().toISOString(),
        updatedAt: typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
        cases: Array.isArray(parsed.cases) ? parsed.cases : [],
        report: parsed.report ?? null,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return emptyRunLogManifest(runId)
    }
  }

  private writeMetadata(
    handle: SessionLogHandle,
    status: AgentSessionLogStatus,
    terminal?: TerminalEvidence,
    error?: string | null,
    artifacts?: readonly Readonly<Record<string, unknown>>[],
  ): Promise<void> {
    const next = handle.metadataWrite.then(() => atomicWriteJson(
      path.join(handle.root, "metadata.json"),
      {
        schemaVersion: isGroupedSessionOrigin(handle.origin)
          ? "agent-session-log.v2"
          : "agent-session-log.v1",
        agentSessionId: handle.sessionId,
        sdkSessionId: handle.sdkSessionId,
        ...metadataContext(handle.origin),
        origin: handle.origin,
        relativePath: path.relative(this.logsRoot, handle.root).split(path.sep).join("/"),
        runtimeLocator: path
          .relative(path.dirname(this.logsRoot), handle.runtimeRoot)
          .split(path.sep)
          .join("/"),
        model: handle.model,
        status,
        startedAt: handle.startedAt,
        finishedAt: terminal ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
        ...(terminal ? { terminal } : {}),
        ...(error ? { error } : {}),
        ...(artifacts ? { artifacts } : {}),
      },
    ))
    handle.metadataWrite = next.catch(() => undefined)
    return next
  }

  private async writeUsage(handle: SessionLogHandle): Promise<void> {
    const resultUsage = sumUsage(handle.collector.resultUsages)
    const assistantUsages = handle.collector.assistantMessages
      .flatMap((message) => message.usage ? [message.usage] : [])
    const assistantUsage = sumNumericRecords(assistantUsages)
    const mismatch = Boolean(
      handle.collector.resultUsages.length > 0 && assistantUsages.length > 0 &&
      Object.entries(resultUsage).some(
        ([key, value]) => assistantUsage[key] !== value,
      ),
    )
    await atomicWriteJson(path.join(handle.root, "usage.json"), {
      status: handle.collector.resultUsages.length > 0
        ? mismatch ? "USAGE_MISMATCH" : "COMPLETE"
        : "UNAVAILABLE",
      source: handle.collector.resultUsages.length > 0 ? "sdk-result" : null,
      inputTokens: resultUsage.input_tokens,
      outputTokens: resultUsage.output_tokens,
      cacheCreationInputTokens: resultUsage.cache_creation_input_tokens,
      cacheReadInputTokens: resultUsage.cache_read_input_tokens,
      totalCostUsd: handle.collector.resultUsages.reduce((sum, value) => sum + value.totalCostUsd, 0),
      durationMs: handle.collector.resultUsages.reduce((sum, value) => sum + value.durationMs, 0),
      durationApiMs: handle.collector.resultUsages.reduce((sum, value) => sum + value.durationApiMs, 0),
      numTurns: handle.collector.resultUsages.reduce((sum, value) => sum + value.numTurns, 0),
      resultUsages: handle.collector.resultUsages.map(
        ({ output: _output, ...usage }) => usage,
      ),
      assistantUsages,
      assistantUsage,
    })
  }

  private async writeFinalOutput(handle: SessionLogHandle): Promise<void> {
    const last = handle.collector.assistantMessages.at(-1)
    const result = handle.collector.resultUsages.at(-1)
    const text = result?.output || last?.text || handle.collector.partialText
    const thinking = last?.thinking || handle.collector.partialThinking
    await atomicWriteJson(path.join(handle.root, "final-output.json"), {
      status: last || text || thinking ? "AVAILABLE" : "UNAVAILABLE",
      protocolStatus: "UNKNOWN",
      text,
      thinking,
      messageId: last?.messageId ?? null,
      characterCount: text.length,
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      complete: result?.subtype === "success" && !last?.aborted,
      aborted: last?.aborted ?? false,
    })
  }

  private async indexArtifacts(
    handle: SessionLogHandle,
    sessionStatus: AgentSessionLogStatus,
  ): Promise<void> {
    const files = await listFiles(handle.root)
    const finalizedAt = new Date()
    for (const relativePath of files) {
      const filePath = path.join(handle.root, ...relativePath.split("/"))
      const info = await stat(filePath)
      const artifactType = relativePath.startsWith("transcript/subagents/")
        ? "TRANSCRIPT_SUBAGENT"
        : artifactTypes[relativePath] ?? "OTHER"
      await this.database
        .insert(agentSessionLogArtifacts)
        .values({
          agentSessionId: handle.sessionId,
          sdkSessionId: handle.sdkSessionId,
          artifactType,
          storagePath: relativePath,
          status: sessionStatus === "FAILED" ? "FAILED" : "COMPLETE",
          byteSize: info.size,
          sha256: await sha256File(filePath),
          finalizedAt,
        })
        .onConflictDoUpdate({
          target: [
            agentSessionLogArtifacts.agentSessionId,
            agentSessionLogArtifacts.storagePath,
          ],
          set: {
            sdkSessionId: handle.sdkSessionId,
            artifactType,
            status: sessionStatus === "FAILED" ? "FAILED" : "COMPLETE",
            byteSize: info.size,
            sha256: await sha256File(filePath),
            finalizedAt,
          },
        })
    }
  }

  private async collectArtifactSummary(
    handle: SessionLogHandle,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const files = (await listFiles(handle.root)).filter(
      (relativePath) => relativePath !== "metadata.json",
    )
    return Promise.all(files.map(async (relativePath) => {
      const filePath = path.join(handle.root, ...relativePath.split("/"))
      const info = await stat(filePath)
      return {
        storagePath: relativePath,
        byteSize: info.size,
        sha256: await sha256File(filePath),
      }
    }))
  }

  private async fileSize(filePath: string): Promise<number> {
    try {
      return (await stat(filePath)).size
    } catch {
      return 0
    }
  }

  private async backfillLocalTranscript(handle: SessionLogHandle): Promise<void> {
    if (!handle.sdkSessionId) return
    const files = await listFiles(handle.runtimeRoot).catch(() => [])
    const mainSuffix = `${handle.sdkSessionId}.jsonl`
    const main = files.find((file) => file.endsWith(mainSuffix))
    if (main) {
      const entries = this.parseTranscript(
        await readFile(path.join(handle.runtimeRoot, ...main.split("/")), "utf8"),
      )
      await handle.transcriptStore.append(
        { projectKey: "recovery", sessionId: handle.sdkSessionId },
        entries,
      )
    }
    for (const file of files.filter((candidate) =>
      candidate.includes(`/${handle.sdkSessionId}/subagents/`) &&
      candidate.endsWith(".jsonl"),
    )) {
      const subpath = file.slice(file.indexOf(`/${handle.sdkSessionId}/`) + handle.sdkSessionId.length + 2)
      await handle.transcriptStore.append(
        { projectKey: "recovery", sessionId: handle.sdkSessionId, subpath },
        this.parseTranscript(
          await readFile(path.join(handle.runtimeRoot, ...file.split("/")), "utf8"),
        ),
      )
    }
  }

  private parseTranscript(content: string): SessionStoreEntry[] {
    return content
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionStoreEntry)
  }

  private async recover(): Promise<void> {
    const sessions = await this.database
      .select()
      .from(agentSessions)
      .where(inArray(agentSessions.logStatus, [
        "WRITING",
        "DEGRADED",
        "RECOVERY_REQUIRED",
      ]))
    for (const session of sessions) {
      if (!session.origin) continue
      try {
        await this.requireHandle(session.id)
        await this.finalize(session.id, { kind: "recovery" })
        await this.release(session.id)
      } catch (error) {
        this.logger.error(
          { sessionId: session.id, error },
          "Agent Session logs could not be recovered",
        )
        await this.database
          .update(agentSessions)
          .set({
            logStatus: "FAILED",
            logErrorCode: "AGENT_SESSION_LOG_PERSISTENCE_FAILED",
            logErrorMessage: "Agent Session log recovery failed.",
            logsFinalizedAt: new Date(),
          })
          .where(eq(agentSessions.id, session.id))
      }
    }
  }
}

export type { TerminalEvidence }
