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
  "PUBLISHING",
  "SUCCEEDED",
  "FAILED",
])

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
    versionId: uuid("version_id").references(() => skillVersions.id, {
      onDelete: "set null",
    }),
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
export type UploadOperationRow = typeof uploadOperations.$inferSelect
