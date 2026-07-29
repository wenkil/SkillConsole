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

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey(),
    sdkSessionId: text("sdk_session_id"),
    status: agentSessionStatus("status").notNull(),
    workspaceLocator: text("workspace_locator").notNull(),
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

export type AgentSessionStatus = (typeof agentSessionStatus.enumValues)[number]
export type AgentSessionTurnStatus =
  (typeof agentSessionTurnStatus.enumValues)[number]
export type AgentSessionRow = typeof agentSessions.$inferSelect
export type AgentSessionTurnRow = typeof agentSessionTurns.$inferSelect
export type AgentSessionEventRow = typeof agentSessionEvents.$inferSelect
