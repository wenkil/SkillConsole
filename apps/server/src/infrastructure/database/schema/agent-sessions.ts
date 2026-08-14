import { sql } from "drizzle-orm"
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const agentSessionStatus = pgEnum("agent_session_status", [
  "STARTING",
  "RUNNING",
  "IDLE",
  "CANCELING",
  "INTERRUPTED",
  "FAILED",
])

export const agentSessionTurnStatus = pgEnum("agent_session_turn_status", [
  "RUNNING",
  "COMPLETED",
  "CANCELED",
  "INTERRUPTED",
  "FAILED",
])

export const agentSessionLogStatus = pgEnum("agent_session_log_status", [
  "WRITING",
  "COMPLETE",
  "DEGRADED",
  "FAILED",
  "RECOVERY_REQUIRED",
])

export const agentSessionLogArtifactStatus = pgEnum(
  "agent_session_log_artifact_status",
  ["WRITING", "COMPLETE", "FAILED"],
)

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey(),
    sdkSessionId: text("sdk_session_id"),
    status: agentSessionStatus("status").notNull(),
    workspaceLocator: text("workspace_locator").notNull(),
    originType: text("origin_type"),
    originKey: text("origin_key"),
    origin: jsonb("origin").$type<Readonly<Record<string, unknown>>>(),
    logStatus: agentSessionLogStatus("log_status"),
    logErrorCode: text("log_error_code"),
    logErrorMessage: text("log_error_message"),
    logsFinalizedAt: timestamp("logs_finalized_at", {
      mode: "date",
      withTimezone: true,
    }),
    nextEventSequence: bigint("next_event_sequence", { mode: "number" })
      .default(1)
      .notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_sessions_sdk_session_unique")
      .on(table.sdkSessionId)
      .where(sql`${table.sdkSessionId} is not null`),
    uniqueIndex("agent_sessions_workspace_locator_unique").on(
      table.workspaceLocator,
    ),
    index("agent_sessions_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("agent_sessions_origin_idx").on(
      table.originType,
      table.originKey,
    ),
    index("agent_sessions_log_status_idx").on(
      table.logStatus,
      table.updatedAt,
    ),
  ],
)

export const agentSessionTurns = pgTable(
  "agent_session_turns",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    status: agentSessionTurnStatus("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("agent_session_turns_session_started_idx").on(
      table.sessionId,
      table.startedAt,
    ),
  ],
)

export const agentSessionEvents = pgTable(
  "agent_session_events",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").references(() => agentSessionTurns.id, {
      onDelete: "cascade",
    }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_session_events_sequence_unique").on(
      table.sessionId,
      table.sequence,
    ),
    index("agent_session_events_session_occurred_idx").on(
      table.sessionId,
      table.occurredAt,
    ),
  ],
)

export const agentSessionLogArtifacts = pgTable(
  "agent_session_log_artifacts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    agentSessionId: uuid("agent_session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    sdkSessionId: text("sdk_session_id"),
    artifactType: text("artifact_type").notNull(),
    storagePath: text("storage_path").notNull(),
    status: agentSessionLogArtifactStatus("status").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    finalizedAt: timestamp("finalized_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("agent_session_log_artifacts_path_unique").on(
      table.agentSessionId,
      table.storagePath,
    ),
    index("agent_session_log_artifacts_session_type_idx").on(
      table.agentSessionId,
      table.artifactType,
    ),
  ],
)

export type AgentSessionStatus = (typeof agentSessionStatus.enumValues)[number]
export type AgentSessionTurnStatus =
  (typeof agentSessionTurnStatus.enumValues)[number]
export type AgentSessionRow = typeof agentSessions.$inferSelect
export type AgentSessionTurnRow = typeof agentSessionTurns.$inferSelect
export type AgentSessionEventRow = typeof agentSessionEvents.$inferSelect
export type AgentSessionLogArtifactRow =
  typeof agentSessionLogArtifacts.$inferSelect
