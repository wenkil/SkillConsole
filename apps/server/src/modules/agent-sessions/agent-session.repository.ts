import { randomUUID } from "node:crypto"

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  agentSessionEvents,
  agentSessions,
  agentSessionTurns,
  type AgentSessionRow,
  type AgentSessionTurnRow,
} from "../../infrastructure/database/schema/index.js"
import type { Database } from "../../infrastructure/database/index.js"
import {
  claudeErrorCodes,
  type ClaudeErrorCode,
  type AgentRuntimeFailure,
  type AgentRuntimeEvent,
  type AgentSessionEvent,
  type AgentSessionEventType,
  type AgentSessionStatus,
  type AgentSessionView,
  type AgentSessionOrigin,
} from "./agent-session.domain.js"

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

const claudeErrorCodeSet = new Set<string>(claudeErrorCodes)

function normalizeClaudeErrorCode(value: string): ClaudeErrorCode {
  return claudeErrorCodeSet.has(value)
    ? (value as ClaudeErrorCode)
    : "CLAUDE_EXECUTION_FAILED"
}

interface AgentSessionExecutionContext {
  readonly sdkSessionId: string | null
  readonly workspaceLocator: string
}

interface RepositoryResult {
  readonly session: AgentSessionView
  readonly events: readonly AgentSessionEvent[]
}

function mapTurn(
  row: AgentSessionTurnRow | undefined,
): AgentSessionView["latestTurn"] {
  if (!row) return null

  return {
    id: row.id,
    status: row.status,
    error:
      row.errorCode && row.errorMessage
        ? {
            code: normalizeClaudeErrorCode(row.errorCode),
            message: row.errorMessage,
          }
        : null,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

function mapSession(
  row: AgentSessionRow,
  latestTurn: AgentSessionTurnRow | undefined,
): AgentSessionView {
  return {
    id: row.id,
    status: row.status,
    resumable:
      row.sdkSessionId !== null &&
      (row.status === "IDLE" || row.status === "INTERRUPTED"),
    latestTurn: mapTurn(latestTurn),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function mapEvent(
  row: typeof agentSessionEvents.$inferSelect,
): AgentSessionEvent {
  return {
    sequence: row.sequence,
    type: row.type as AgentSessionEventType,
    sessionId: row.sessionId,
    turnId: row.turnId,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
  }
}

function notFound(sessionId: string): DomainError {
  return new DomainError({
    code: "AGENT_SESSION_NOT_FOUND",
    kind: "not_found",
    message: "The requested Agent Session does not exist.",
    details: { sessionId },
  })
}

export class AgentSessionRepository {
  constructor(private readonly database: Database) {}

  async create(
    sessionId: string,
    workspaceLocator: string,
    turnId: string,
    origin: AgentSessionOrigin,
  ): Promise<RepositoryResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .insert(agentSessions)
        .values({
          id: sessionId,
          status: "STARTING",
          workspaceLocator,
          originType: origin.type,
          originKey: originKey(origin),
          origin,
          logStatus: "WRITING",
          nextEventSequence: 1,
        })
        .returning()
      const [turn] = await transaction
        .insert(agentSessionTurns)
        .values({
          id: turnId,
          sessionId,
          status: "RUNNING",
        })
        .returning()

      if (!session || !turn) {
        throw new Error("Agent Session creation returned no database rows.")
      }

      const sessionStarted = await this.appendEvent(
        transaction,
        sessionId,
        null,
        "session.started",
        { schemaVersion: 1 },
      )
      const turnStarted = await this.appendEvent(
        transaction,
        sessionId,
        turnId,
        "turn.started",
        { schemaVersion: 1 },
      )

      return {
        session: mapSession(
          { ...session, nextEventSequence: 3 },
          turn,
        ),
        events: [sessionStarted, turnStarted],
      }
    })
  }

  async get(sessionId: string): Promise<AgentSessionView> {
    const session = await this.getSessionRow(sessionId)
    const latestTurn = await this.getLatestTurnRow(sessionId)
    return mapSession(session, latestTurn)
  }

  async beginTurn(
    sessionId: string,
    turnId: string,
    requireSdkSessionId = false,
  ): Promise<RepositoryResult & { readonly context: AgentSessionExecutionContext }> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .for("update")

      if (!session) throw notFound(sessionId)
      if (session.status !== "IDLE" && session.status !== "INTERRUPTED") {
        throw new DomainError({
          code: "AGENT_SESSION_BUSY",
          kind: "conflict",
          message: "The Agent Session already has an active turn.",
          details: { sessionId, status: session.status },
        })
      }
      if (session.status === "INTERRUPTED" && !session.sdkSessionId) {
        throw new DomainError({
          code: "AGENT_SESSION_RESUME_UNAVAILABLE",
          kind: "conflict",
          message:
            "The interrupted Agent Session cannot resume because no SDK Session ID was captured.",
          details: { sessionId },
        })
      }
      if (requireSdkSessionId && !session.sdkSessionId) {
        throw new DomainError({
          code: "AGENT_SESSION_RESUME_UNAVAILABLE",
          kind: "conflict",
          message:
            "The Agent Session cannot resume because no SDK Session ID was captured.",
          details: { sessionId },
        })
      }

      const [turn] = await transaction
        .insert(agentSessionTurns)
        .values({
          id: turnId,
          sessionId,
          status: "RUNNING",
        })
        .returning()
      const nextStatus =
        session.status === "INTERRUPTED" ? "STARTING" : "RUNNING"
      const [updatedSession] = await transaction
        .update(agentSessions)
        .set({
          status: nextStatus,
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId))
        .returning()

      if (!turn || !updatedSession) {
        throw new Error("Agent Session turn creation returned no database rows.")
      }

      const event = await this.appendEvent(
        transaction,
        sessionId,
        turnId,
        "turn.started",
        { schemaVersion: 1 },
      )

      return {
        session: mapSession(updatedSession, turn),
        events: [event],
        context: {
          sdkSessionId: updatedSession.sdkSessionId,
          workspaceLocator: updatedSession.workspaceLocator,
        },
      }
    })
  }

  async markInitialized(
    sessionId: string,
    event: Extract<AgentRuntimeEvent, { type: "initialized" }>,
  ): Promise<AgentSessionEvent> {
    return this.database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(agentSessions)
        .set({
          sdkSessionId: event.sdkSessionId,
          status: "RUNNING",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentSessions.id, sessionId),
            inArray(agentSessions.status, ["STARTING", "RUNNING"]),
          ),
        )
        .returning({ id: agentSessions.id })
      if (!updated) throw notFound(sessionId)
      return this.appendEvent(transaction, sessionId, null, "session.initialized", {
        schemaVersion: 1,
        model: event.model,
        tools: [...event.tools],
        skills: [...event.skills],
        mcpServers: event.mcpServers.map((server) => ({ ...server })),
      })
    })
  }

  async recordRuntimeEvent(
    sessionId: string,
    turnId: string,
    event: Exclude<
      AgentRuntimeEvent,
      { type: "initialized" } | { type: "turn_result" }
    >,
  ): Promise<AgentSessionEvent> {
    if (event.type === "assistant_message") {
      return this.persistEvent(
        sessionId,
        turnId,
        "assistant.message",
        {
          schemaVersion: 1,
          messageId: event.messageId,
          content: event.content,
        },
      )
    }

    return this.persistEvent(sessionId, turnId, "tool.completed", {
      schemaVersion: 1,
      toolUseId: event.toolUseId,
      content: event.content,
      isError: event.isError,
    })
  }

  async completeTurn(
    sessionId: string,
    turnId: string,
    result: Extract<AgentRuntimeEvent, { type: "turn_result" }>,
  ): Promise<RepositoryResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .for("update")
      if (!session) throw notFound(sessionId)

      const latestTurn = await this.getLatestTurnRow(sessionId, transaction)
      if (
        !latestTurn ||
        latestTurn.id !== turnId ||
        latestTurn.status !== "RUNNING" ||
        !["STARTING", "RUNNING", "CANCELING"].includes(session.status)
      ) {
        return {
          session: mapSession(session, latestTurn),
          events: [],
        }
      }

      const events: AgentSessionEvent[] = []
      events.push(
        await this.appendEvent(
          transaction,
          sessionId,
          turnId,
          "usage.updated",
          {
            schemaVersion: 1,
            durationMs: result.durationMs,
            durationApiMs: result.durationApiMs,
            numTurns: result.numTurns,
            totalCostUsd: result.totalCostUsd,
            usage: result.usage,
          },
        ),
      )

      const completedAt = new Date()
      const wasCanceled = session.status === "CANCELING"
      const turnStatus = wasCanceled
        ? "CANCELED"
        : result.success
          ? "COMPLETED"
          : "FAILED"
      const nextSessionStatus =
        wasCanceled || result.success ? "IDLE" : "FAILED"
      const error =
        result.success || wasCanceled
          ? null
          : (result.error ?? {
              code: "CLAUDE_EXECUTION_FAILED",
              message: `Claude Agent SDK ended with ${result.subtype}.`,
            })

      const [turn] = await transaction
        .update(agentSessionTurns)
        .set({
          status: turnStatus,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
          completedAt,
        })
        .where(
          and(
            eq(agentSessionTurns.id, latestTurn.id),
            eq(agentSessionTurns.sessionId, sessionId),
          ),
        )
        .returning()
      const [updatedSession] = await transaction
        .update(agentSessions)
        .set({
          status: nextSessionStatus,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
          updatedAt: completedAt,
        })
        .where(eq(agentSessions.id, sessionId))
        .returning()

      if (!turn || !updatedSession) {
        throw new Error("Agent Session completion returned no database rows.")
      }

      const terminalType = wasCanceled
        ? "turn.canceled"
        : result.success
          ? "turn.completed"
          : "turn.failed"
      events.push(
        await this.appendEvent(
          transaction,
          sessionId,
          turnId,
          terminalType,
          {
            schemaVersion: 1,
            subtype: result.subtype,
            ...(error ? { error } : {}),
          },
        ),
      )

      if (nextSessionStatus === "FAILED" && error) {
        events.push(
          await this.appendEvent(
            transaction,
            sessionId,
            turnId,
            "session.failed",
            { schemaVersion: 1, error },
          ),
        )
      }

      return {
        session: mapSession(updatedSession, turn),
        events,
      }
    })
  }

  async requestCancellation(sessionId: string): Promise<{
    readonly session: AgentSessionView
    readonly newlyRequested: boolean
  }> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .for("update")
      if (!session) throw notFound(sessionId)

      if (session.status === "CANCELING") {
        return {
          session: mapSession(
            session,
            await this.getLatestTurnRow(sessionId, transaction),
          ),
          newlyRequested: false,
        }
      }
      if (session.status !== "STARTING" && session.status !== "RUNNING") {
        throw new DomainError({
          code: "AGENT_SESSION_NOT_RUNNING",
          kind: "conflict",
          message: "The Agent Session has no active turn to cancel.",
          details: { sessionId, status: session.status },
        })
      }

      const [updatedSession] = await transaction
        .update(agentSessions)
        .set({ status: "CANCELING", updatedAt: new Date() })
        .where(eq(agentSessions.id, sessionId))
        .returning()
      if (!updatedSession) {
        throw new Error("Agent Session cancellation returned no database row.")
      }
      return {
        session: mapSession(
          updatedSession,
          await this.getLatestTurnRow(sessionId, transaction),
        ),
        newlyRequested: true,
      }
    })
  }

  async markRuntimeFailed(
    sessionId: string,
    failure: AgentRuntimeFailure,
  ): Promise<RepositoryResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .for("update")
      if (!session) throw notFound(sessionId)

      const latestTurn = await this.getLatestTurnRow(sessionId, transaction)
      if (
        !latestTurn ||
        !["STARTING", "RUNNING", "CANCELING"].includes(session.status)
      ) {
        return { session: mapSession(session, latestTurn), events: [] }
      }

      const completedAt = new Date()
      const error = { code: failure.code, message: failure.message }
      const [turn] = await transaction
        .update(agentSessionTurns)
        .set({
          status: "FAILED",
          errorCode: error.code,
          errorMessage: error.message,
          completedAt,
        })
        .where(eq(agentSessionTurns.id, latestTurn.id))
        .returning()
      const [updatedSession] = await transaction
        .update(agentSessions)
        .set({
          status: "FAILED",
          errorCode: error.code,
          errorMessage: error.message,
          updatedAt: completedAt,
        })
        .where(eq(agentSessions.id, sessionId))
        .returning()
      if (!turn || !updatedSession) {
        throw new Error("Agent Session failure returned no database rows.")
      }

      const turnFailed = await this.appendEvent(
        transaction,
        sessionId,
        turn.id,
        "turn.failed",
        { schemaVersion: 1, error },
      )
      const sessionFailed = await this.appendEvent(
        transaction,
        sessionId,
        turn.id,
        "session.failed",
        { schemaVersion: 1, error },
      )
      return {
        session: mapSession(updatedSession, turn),
        events: [turnFailed, sessionFailed],
      }
    })
  }

  async markRuntimeInterrupted(
    sessionId: string,
    error?: unknown,
  ): Promise<RepositoryResult> {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .for("update")
      if (!session) throw notFound(sessionId)

      const latestTurn = await this.getLatestTurnRow(sessionId, transaction)
      if (
        !latestTurn ||
        !["STARTING", "RUNNING", "CANCELING"].includes(session.status)
      ) {
        return { session: mapSession(session, latestTurn), events: [] }
      }

      const interruption = {
        code: "CLAUDE_RUNTIME_INTERRUPTED",
        message:
          error instanceof Error
            ? error.message
            : "The Claude Agent SDK runtime was interrupted.",
      }
      const completedAt = new Date()
      const [turn] = await transaction
        .update(agentSessionTurns)
        .set({
          status: "INTERRUPTED",
          errorCode: interruption.code,
          errorMessage: interruption.message,
          completedAt,
        })
        .where(eq(agentSessionTurns.id, latestTurn.id))
        .returning()
      const [updatedSession] = await transaction
        .update(agentSessions)
        .set({
          status: "INTERRUPTED",
          errorCode: interruption.code,
          errorMessage: interruption.message,
          updatedAt: completedAt,
        })
        .where(eq(agentSessions.id, sessionId))
        .returning()

      if (!turn || !updatedSession) {
        throw new Error("Agent Session interruption returned no database rows.")
      }

      const event = await this.appendEvent(
        transaction,
        sessionId,
        turn.id,
        "turn.interrupted",
        { schemaVersion: 1, error: interruption },
      )
      return {
        session: mapSession(updatedSession, turn),
        events: [event],
      }
    })
  }

  async reconcileInterruptedSessions(): Promise<readonly AgentSessionEvent[]> {
    const rows = await this.database
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(
        inArray(agentSessions.status, ["STARTING", "RUNNING", "CANCELING"]),
      )
    const events: AgentSessionEvent[] = []

    for (const row of rows) {
      const result = await this.markRuntimeInterrupted(row.id)
      events.push(...result.events)
    }

    return events
  }

  async listEvents(
    sessionId: string,
    afterSequence: number,
  ): Promise<readonly AgentSessionEvent[]> {
    await this.getSessionRow(sessionId)
    const rows = await this.database
      .select()
      .from(agentSessionEvents)
      .where(
        and(
          eq(agentSessionEvents.sessionId, sessionId),
          gt(agentSessionEvents.sequence, afterSequence),
        ),
      )
      .orderBy(agentSessionEvents.sequence)
    return rows.map(mapEvent)
  }

  private async persistEvent(
    sessionId: string,
    turnId: string | null,
    type: AgentSessionEventType,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<AgentSessionEvent> {
    return this.database.transaction((transaction) =>
      this.appendEvent(
        transaction,
        sessionId,
        turnId,
        type,
        payload,
      ),
    )
  }

  private async appendEvent(
    transaction: Parameters<
      Parameters<Database["transaction"]>[0]
    >[0],
    sessionId: string,
    turnId: string | null,
    type: AgentSessionEventType,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<AgentSessionEvent> {
    const [sequenceRow] = await transaction
      .update(agentSessions)
      .set({
        nextEventSequence: sql`${agentSessions.nextEventSequence} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, sessionId))
      .returning({ nextEventSequence: agentSessions.nextEventSequence })
    if (!sequenceRow) throw notFound(sessionId)

    const [event] = await transaction
      .insert(agentSessionEvents)
      .values({
        id: randomUUID(),
        sessionId,
        turnId,
        sequence: sequenceRow.nextEventSequence - 1,
        type,
        payload,
      })
      .returning()
    if (!event) {
      throw new Error("Agent Session event insertion returned no database row.")
    }
    return mapEvent(event)
  }

  private async getSessionRow(sessionId: string): Promise<AgentSessionRow> {
    const [session] = await this.database
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
    if (!session) throw notFound(sessionId)
    return session
  }

  private async getLatestTurnRow(
    sessionId: string,
    database: Pick<Database, "select"> = this.database,
  ): Promise<AgentSessionTurnRow | undefined> {
    const [turn] = await database
      .select()
      .from(agentSessionTurns)
      .where(eq(agentSessionTurns.sessionId, sessionId))
      .orderBy(desc(agentSessionTurns.startedAt))
      .limit(1)
    return turn
  }
}
