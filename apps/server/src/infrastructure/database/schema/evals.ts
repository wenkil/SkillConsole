import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { agentSessions } from "./agent-sessions.js"
import {
  skillDraftRevisions,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
} from "./skill-workspaces.js"

export const evalGenerationStatus = pgEnum("eval_generation_status", [
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "SUCCEEDED",
  "CANCELING",
  "CANCELED",
  "INTERRUPTED",
  "FAILED",
])

export const evalGenerationDraftStatus = pgEnum(
  "eval_generation_draft_status",
  ["READY", "PUBLISHED", "DISCARDED"],
)

export const evalTargetSourceKind = pgEnum("eval_target_source_kind", [
  "DRAFT_REVISION",
  "SKILL_VERSION",
])

export interface StoredEvalCase {
  readonly externalId: number
  readonly name: string
  readonly prompt: string
  readonly expectedOutput: string
  readonly assertions: readonly string[]
  readonly files: readonly string[]
}

export interface StoredEvalFile {
  readonly relativePath: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: "text" | "binary"
}

export const evalSuites = pgTable(
  "eval_suites",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
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
    uniqueIndex("eval_suites_workspace_unique").on(table.workspaceId),
  ],
)

export const evalGenerationTasks = pgTable(
  "eval_generation_tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => evalSuites.id, { onDelete: "cascade" }),
    agentSessionId: uuid("agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "set null" },
    ),
    targetSnapshotId: uuid("target_snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    targetSourceKind: evalTargetSourceKind("target_source_kind").notNull(),
    targetVersionId: uuid("target_version_id").references(
      () => skillVersions.id,
      { onDelete: "restrict" },
    ),
    targetDraftRevisionId: uuid("target_draft_revision_id").references(
      () => skillDraftRevisions.id,
      { onDelete: "restrict" },
    ),
    skillName: text("skill_name").notNull(),
    status: evalGenerationStatus("status").notNull(),
    maxEvalCount: integer("max_eval_count").notNull(),
    generationBrief: text("generation_brief"),
    promptContractVersion: text("prompt_contract_version").notNull(),
    configurationFingerprint: text("configuration_fingerprint").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details").$type<
      Readonly<Record<string, unknown>>
    >(),
    usage: jsonb("usage").$type<Readonly<Record<string, number>>>(),
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
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    check(
      "eval_generation_tasks_source_check",
      sql`(
        ${table.targetSourceKind} = 'SKILL_VERSION'
        and ${table.targetVersionId} is not null
        and ${table.targetDraftRevisionId} is null
      ) or (
        ${table.targetSourceKind} = 'DRAFT_REVISION'
        and ${table.targetVersionId} is null
        and ${table.targetDraftRevisionId} is not null
      )`,
    ),
    check(
      "eval_generation_tasks_skill_name_check",
      sql`char_length(${table.skillName}) between 1 and 64`,
    ),
    check(
      "eval_generation_tasks_count_check",
      sql`${table.maxEvalCount} between 1 and 20`,
    ),
    check(
      "eval_generation_tasks_brief_check",
      sql`${table.generationBrief} is null or char_length(${table.generationBrief}) <= 4000`,
    ),
    check(
      "eval_generation_tasks_config_hash_check",
      sql`${table.configurationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "eval_generation_tasks_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "eval_generation_tasks_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) between 1 and 200`,
    ),
    uniqueIndex("eval_generation_tasks_agent_session_unique")
      .on(table.agentSessionId)
      .where(sql`${table.agentSessionId} is not null`),
    uniqueIndex("eval_generation_tasks_idempotency_unique").on(
      table.suiteId,
      table.idempotencyKey,
    ),
    uniqueIndex("eval_generation_tasks_active_suite_unique")
      .on(table.suiteId)
      .where(
        sql`${table.status} in ('PREPARING', 'RUNNING', 'VALIDATING', 'CANCELING')`,
      ),
    index("eval_generation_tasks_suite_created_idx").on(
      table.suiteId,
      table.createdAt,
    ),
    index("eval_generation_tasks_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
)

export const evalGenerationAttempts = pgTable(
  "eval_generation_attempts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id").notNull().references(() => evalGenerationTasks.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    requestIdempotencyKey: text("request_idempotency_key").notNull(),
    agentSessionId: uuid("agent_session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    status: evalGenerationStatus("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details").$type<Readonly<Record<string, unknown>>>(),
    usage: jsonb("usage").$type<Readonly<Record<string, number>>>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("eval_generation_attempts_task_number_unique").on(table.taskId, table.attemptNumber),
    uniqueIndex("eval_generation_attempts_task_request_unique").on(table.taskId, table.requestIdempotencyKey),
    uniqueIndex("eval_generation_attempts_agent_session_unique").on(table.agentSessionId).where(sql`${table.agentSessionId} is not null`),
    uniqueIndex("eval_generation_attempts_active_task_unique").on(table.taskId).where(sql`${table.status} in ('PREPARING', 'RUNNING', 'VALIDATING', 'CANCELING')`),
    index("eval_generation_attempts_task_number_idx").on(table.taskId, table.attemptNumber),
  ],
)

export const evalGenerationEvents = pgTable(
  "eval_generation_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => evalGenerationTasks.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").notNull().references(() => evalGenerationAttempts.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    sourceAgentSequence: bigint("source_agent_sequence", {
      mode: "number",
    }),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "eval_generation_events_sequence_check",
      sql`${table.sequence} >= 1`,
    ),
    uniqueIndex("eval_generation_events_sequence_unique").on(
      table.taskId,
      table.sequence,
    ),
    uniqueIndex("eval_generation_events_source_agent_unique")
      .on(table.attemptId, table.sourceAgentSequence)
      .where(sql`${table.sourceAgentSequence} is not null`),
    index("eval_generation_events_task_occurred_idx").on(
      table.taskId,
      table.occurredAt,
    ),
  ],
)

export const evalGenerationDrafts = pgTable(
  "eval_generation_drafts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => evalGenerationTasks.id, { onDelete: "cascade" }),
    status: evalGenerationDraftStatus("status").notNull(),
    storageLocator: text("storage_locator").notNull(),
    sourceSchemaVariant: text("source_schema_variant").notNull(),
    rawEvalsSha256: text("raw_evals_sha256").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    evalCount: integer("eval_count").notNull(),
    fileCount: integer("file_count").notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
    cases: jsonb("cases").$type<readonly StoredEvalCase[]>().notNull(),
    files: jsonb("files").$type<readonly StoredEvalFile[]>().notNull(),
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
    check(
      "eval_generation_drafts_raw_hash_check",
      sql`${table.rawEvalsSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "eval_generation_drafts_manifest_hash_check",
      sql`${table.manifestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "eval_generation_drafts_schema_variant_check",
      sql`${table.sourceSchemaVariant} in ('assertions', 'expectations', 'mixed')`,
    ),
    check(
      "eval_generation_drafts_counts_check",
      sql`${table.evalCount} >= 1 and ${table.fileCount} >= 0 and ${table.totalBytes} >= 0`,
    ),
    uniqueIndex("eval_generation_drafts_task_unique").on(table.taskId),
    uniqueIndex("eval_generation_drafts_storage_unique").on(
      table.storageLocator,
    ),
    index("eval_generation_drafts_created_idx").on(table.createdAt),
  ],
)

export const evalRevisions = pgTable(
  "eval_revisions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => evalSuites.id, { onDelete: "cascade" }),
    sourceGenerationTaskId: uuid("source_generation_task_id")
      .notNull()
      .references(() => evalGenerationTasks.id, { onDelete: "restrict" }),
    sourceSnapshotId: uuid("source_snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    sourceKind: evalTargetSourceKind("source_kind").notNull(),
    sourceVersionId: uuid("source_version_id").references(
      () => skillVersions.id,
      { onDelete: "restrict" },
    ),
    sourceDraftRevisionId: uuid("source_draft_revision_id").references(
      () => skillDraftRevisions.id,
      { onDelete: "restrict" },
    ),
    sequenceNumber: integer("revision_number").notNull(),
    skillName: text("skill_name").notNull(),
    storageLocator: text("storage_locator").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    rawEvalsSha256: text("raw_evals_sha256").notNull(),
    evalCount: integer("eval_count").notNull(),
    fileCount: integer("file_count").notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
    promptContractVersion: text("prompt_contract_version").notNull(),
    configurationFingerprint: text("configuration_fingerprint").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "eval_revisions_source_check",
      sql`(
        ${table.sourceKind} = 'SKILL_VERSION'
        and ${table.sourceVersionId} is not null
        and ${table.sourceDraftRevisionId} is null
      ) or (
        ${table.sourceKind} = 'DRAFT_REVISION'
        and ${table.sourceVersionId} is null
        and ${table.sourceDraftRevisionId} is not null
      )`,
    ),
    check(
      "eval_revisions_number_check",
      sql`${table.sequenceNumber} >= 1`,
    ),
    check(
      "eval_revisions_skill_name_check",
      sql`char_length(${table.skillName}) between 1 and 64`,
    ),
    check(
      "eval_revisions_hashes_check",
      sql`${table.manifestHash} ~ '^[0-9a-f]{64}$'
        and ${table.rawEvalsSha256} ~ '^[0-9a-f]{64}$'
        and ${table.configurationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "eval_revisions_counts_check",
      sql`${table.evalCount} >= 1 and ${table.fileCount} >= 0 and ${table.totalBytes} >= 0`,
    ),
    uniqueIndex("eval_revisions_suite_number_unique").on(
      table.suiteId,
      table.sequenceNumber,
    ),
    uniqueIndex("eval_revisions_generation_unique").on(
      table.sourceGenerationTaskId,
    ),
    uniqueIndex("eval_revisions_storage_unique").on(table.storageLocator),
    index("eval_revisions_suite_created_idx").on(
      table.suiteId,
      table.createdAt,
    ),
  ],
)

export const evalRevisionCases = pgTable(
  "eval_revision_cases",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => evalRevisions.id, { onDelete: "cascade" }),
    externalId: integer("external_id").notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    expectedOutput: text("expected_output").notNull(),
    assertions: jsonb("assertions").$type<readonly string[]>().notNull(),
    files: jsonb("files").$type<readonly string[]>().notNull(),
  },
  (table) => [
    check(
      "eval_revision_cases_external_id_check",
      sql`${table.externalId} >= 1`,
    ),
    check(
      "eval_revision_cases_text_check",
      sql`char_length(${table.name}) between 1 and 120
        and char_length(${table.prompt}) between 1 and 20000
        and char_length(${table.expectedOutput}) between 1 and 10000`,
    ),
    uniqueIndex("eval_revision_cases_external_id_unique").on(
      table.revisionId,
      table.externalId,
    ),
    index("eval_revision_cases_revision_idx").on(table.revisionId),
  ],
)

export const evalRevisionFiles = pgTable(
  "eval_revision_files",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => evalRevisions.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mediaTypeHint: text("media_type_hint").notNull(),
    contentKind: text("content_kind").notNull(),
  },
  (table) => [
    check(
      "eval_revision_files_path_check",
      sql`char_length(${table.relativePath}) between 1 and 512`,
    ),
    check(
      "eval_revision_files_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "eval_revision_files_byte_size_check",
      sql`${table.byteSize} >= 0`,
    ),
    check(
      "eval_revision_files_content_kind_check",
      sql`${table.contentKind} in ('text', 'binary')`,
    ),
    uniqueIndex("eval_revision_files_path_unique").on(
      table.revisionId,
      table.relativePath,
    ),
    uniqueIndex("eval_revision_files_casefold_path_unique").on(
      table.revisionId,
      sql`lower(${table.relativePath})`,
    ),
  ],
)

export type EvalSuiteRow = typeof evalSuites.$inferSelect
export type EvalGenerationTaskRow = typeof evalGenerationTasks.$inferSelect
export type EvalGenerationAttemptRow = typeof evalGenerationAttempts.$inferSelect
export type EvalGenerationEventRow = typeof evalGenerationEvents.$inferSelect
export type EvalGenerationDraftRow = typeof evalGenerationDrafts.$inferSelect
export type EvalRevisionRow = typeof evalRevisions.$inferSelect
export type EvalRevisionCaseRow = typeof evalRevisionCases.$inferSelect
export type EvalRevisionFileRow = typeof evalRevisionFiles.$inferSelect
export type EvalGenerationStatus =
  (typeof evalGenerationStatus.enumValues)[number]
