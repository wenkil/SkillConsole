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
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

export const skillSourceType = pgEnum("skill_source_type", [
  "single_file",
  "folder",
  "zip",
])

export const skillSnapshotKind = pgEnum("skill_snapshot_kind", [
  "DRAFT_WORKING",
  "DRAFT_FROZEN",
  "VERSION",
])

export const skillSnapshotState = pgEnum("skill_snapshot_state", [
  "STAGING",
  "READY",
  "CORRUPTED",
])

export const uploadOperationState = pgEnum("upload_operation_state", [
  "RECEIVING",
  "VALIDATING",
  "COMMITTING",
  "SUCCEEDED",
  "FAILED",
])

export const skillDraftStatus = pgEnum("skill_draft_status", [
  "OPEN",
  "FINALIZING",
  "CLOSED",
  "ABANDONED",
])

export const skillImprovementCycleStatus = pgEnum(
  "skill_improvement_cycle_status",
  ["DRAFTING", "VERSION_PUBLISHED", "VALIDATING", "COMPLETED", "ABANDONED"],
)

export const skillWorkspaces = pgTable(
  "skill_workspaces",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => skillVersions.id,
      { onDelete: "restrict" },
    ),
    defaultBaselineVersionId: uuid("default_baseline_version_id").references(
      (): AnyPgColumn => skillVersions.id,
      { onDelete: "restrict" },
    ),
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
      "skill_workspaces_name_length_check",
      sql`char_length(trim(${table.name})) between 1 and 120`,
    ),
    uniqueIndex("skill_workspaces_name_unique").on(sql`lower(${table.name})`),
  ],
)

export const skillSnapshots = pgTable(
  "skill_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
    kind: skillSnapshotKind("kind").notNull(),
    state: skillSnapshotState("state").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    storageLocator: text("storage_locator").notNull(),
    fileCount: integer("file_count").notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "skill_snapshots_manifest_hash_check",
      sql`${table.manifestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("skill_snapshots_file_count_check", sql`${table.fileCount} >= 1`),
    check("skill_snapshots_total_bytes_check", sql`${table.totalBytes} >= 0`),
    uniqueIndex("skill_snapshots_storage_locator_unique").on(
      table.storageLocator,
    ),
    index("skill_snapshots_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
)

export const skillSnapshotFiles = pgTable(
  "skill_snapshot_files",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mediaTypeHint: text("media_type_hint").notNull(),
    contentKind: text("content_kind").notNull(),
  },
  (table) => [
    check(
      "skill_snapshot_files_path_check",
      sql`char_length(${table.relativePath}) between 1 and 512`,
    ),
    check(
      "skill_snapshot_files_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "skill_snapshot_files_byte_size_check",
      sql`${table.byteSize} >= 0`,
    ),
    check(
      "skill_snapshot_files_content_kind_check",
      sql`${table.contentKind} in ('text', 'binary')`,
    ),
    uniqueIndex("skill_snapshot_files_path_unique").on(
      table.snapshotId,
      table.relativePath,
    ),
    uniqueIndex("skill_snapshot_files_casefold_path_unique").on(
      table.snapshotId,
      sql`lower(${table.relativePath})`,
    ),
  ],
)

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    sourceType: skillSourceType("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "skill_versions_version_number_check",
      sql`${table.versionNumber} >= 1`,
    ),
    uniqueIndex("skill_versions_workspace_number_unique").on(
      table.workspaceId,
      table.versionNumber,
    ),
    uniqueIndex("skill_versions_snapshot_unique").on(table.snapshotId),
    index("skill_versions_workspace_published_idx").on(
      table.workspaceId,
      table.publishedAt,
    ),
  ],
)

export const skillDrafts = pgTable(
  "skill_drafts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
    baseVersionId: uuid("base_version_id").references(
      () => skillVersions.id,
      { onDelete: "set null" },
    ),
    baseSnapshotId: uuid("base_snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    currentSnapshotId: uuid("current_snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    status: skillDraftStatus("status").notNull(),
    contentRevision: integer("content_revision").default(1).notNull(),
    sourceType: skillSourceType("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    ignoreRules: jsonb("ignore_rules")
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    currentIgnoredPaths: jsonb("current_ignored_paths")
      .$type<
        readonly {
          readonly relativePath: string
          readonly reason: "protected" | "skillconsoleignore" | "custom"
        }[]
      >()
      .default(sql`'[]'::jsonb`)
      .notNull(),
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
      "skill_drafts_content_revision_check",
      sql`${table.contentRevision} >= 1`,
    ),
    uniqueIndex("skill_drafts_active_workspace_unique")
      .on(table.workspaceId)
      .where(sql`${table.status} in ('OPEN', 'FINALIZING')`),
    index("skill_drafts_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
)

export const skillDraftRevisions = pgTable(
  "skill_draft_revisions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => skillDrafts.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    sourceContentRevision: integer("source_content_revision").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "skill_draft_revisions_source_revision_check",
      sql`${table.sourceContentRevision} >= 1`,
    ),
    check(
      "skill_draft_revisions_reason_check",
      sql`${table.reason} in ('TRIAL', 'PRE_REGRESSION', 'RELEASE_GATE', 'FINALIZE')`,
    ),
    uniqueIndex("skill_draft_revisions_snapshot_unique").on(table.snapshotId),
    index("skill_draft_revisions_draft_created_idx").on(
      table.draftId,
      table.createdAt,
    ),
  ],
)

export const skillDraftMutations = pgTable(
  "skill_draft_mutations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => skillDrafts.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    baseContentRevision: integer("base_content_revision").notNull(),
    resultContentRevision: integer("result_content_revision").notNull(),
    resultSnapshotId: uuid("result_snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "skill_draft_mutations_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) between 1 and 200`,
    ),
    check(
      "skill_draft_mutations_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "skill_draft_mutations_revision_check",
      sql`${table.baseContentRevision} >= 1 and ${table.resultContentRevision} = ${table.baseContentRevision} + 1`,
    ),
    uniqueIndex("skill_draft_mutations_idempotency_unique").on(
      table.draftId,
      table.idempotencyKey,
    ),
    index("skill_draft_mutations_draft_created_idx").on(
      table.draftId,
      table.createdAt,
    ),
  ],
)

export const skillImprovementCycles = pgTable(
  "skill_improvement_cycles",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
    baseVersionId: uuid("base_version_id").references(
      () => skillVersions.id,
      { onDelete: "set null" },
    ),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => skillDrafts.id, { onDelete: "cascade" }),
    releasedVersionId: uuid("released_version_id").references(
      () => skillVersions.id,
      { onDelete: "set null" },
    ),
    status: skillImprovementCycleStatus("status").notNull(),
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
    versionPublishedAt: timestamp("version_published_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("skill_improvement_cycles_draft_unique").on(table.draftId),
    index("skill_improvement_cycles_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
)

export const uploadOperations = pgTable(
  "upload_operations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => skillWorkspaces.id, {
      onDelete: "set null",
    }),
    snapshotId: uuid("snapshot_id").references(() => skillSnapshots.id, {
      onDelete: "set null",
    }),
    draftId: uuid("draft_id").references(() => skillDrafts.id, {
      onDelete: "set null",
    }),
    improvementCycleId: uuid("improvement_cycle_id").references(
      () => skillImprovementCycles.id,
      {
        onDelete: "set null",
      },
    ),
    workspaceName: text("workspace_name").notNull(),
    sourceType: skillSourceType("source_type").notNull(),
    sourceName: text("source_name"),
    ignoredFileCount: integer("ignored_file_count").default(0).notNull(),
    strippedRoot: text("stripped_root"),
    state: uploadOperationState("state").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
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
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    check(
      "upload_operations_workspace_name_check",
      sql`char_length(trim(${table.workspaceName})) between 1 and 120`,
    ),
    check(
      "upload_operations_ignored_count_check",
      sql`${table.ignoredFileCount} >= 0`,
    ),
    index("upload_operations_state_updated_idx").on(
      table.state,
      table.updatedAt,
    ),
  ],
)

export type SkillSourceType = (typeof skillSourceType.enumValues)[number]
export type SkillWorkspaceRow = typeof skillWorkspaces.$inferSelect
export type NewSkillWorkspaceRow = typeof skillWorkspaces.$inferInsert
export type SkillSnapshotRow = typeof skillSnapshots.$inferSelect
export type SkillSnapshotFileRow = typeof skillSnapshotFiles.$inferSelect
export type SkillVersionRow = typeof skillVersions.$inferSelect
export type SkillDraftRow = typeof skillDrafts.$inferSelect
export type SkillDraftRevisionRow = typeof skillDraftRevisions.$inferSelect
export type SkillDraftMutationRow = typeof skillDraftMutations.$inferSelect
export type SkillImprovementCycleRow =
  typeof skillImprovementCycles.$inferSelect
export type UploadOperationRow = typeof uploadOperations.$inferSelect
