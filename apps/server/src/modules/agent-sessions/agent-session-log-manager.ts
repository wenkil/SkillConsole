import { createHash } from "node:crypto"
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
  readonly root: string
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

function originKey(origin: AgentSessionOrigin): string {
  switch (origin.type) {
    case "eval_generation":
      return origin.taskId
    case "test_run_execution":
    case "test_run_grader":
      return `${origin.runId}:${origin.caseId}`
    case "report_analyzer":
      return `${origin.reportId}:${origin.analysisId}:${origin.revisionId}`
    case "generic":
      return "generic"
  }
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
    const filePath = path.join(this.logsRoot, sessionId, "final-output.json")
    const current = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
    await atomicWriteJson(filePath, { ...current, protocolStatus })
    const finalInfo = await stat(filePath)
    const finalSha256 = await sha256File(filePath)
    const metadataPath = path.join(this.logsRoot, sessionId, "metadata.json")
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
    const root = path.join(this.logsRoot, sessionId)
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
        schemaVersion: "agent-session-log.v1",
        agentSessionId: handle.sessionId,
        sdkSessionId: handle.sdkSessionId,
        origin: handle.origin,
        model: handle.model,
        status,
        startedAt: handle.startedAt,
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
