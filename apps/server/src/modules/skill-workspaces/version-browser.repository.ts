import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDraftFiles,
  skillDrafts,
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
  type Database,
  type SkillDraftFileRow,
  type SkillSnapshotFileRow,
  type SkillSnapshotRow,
  type SkillSourceType,
} from "../../infrastructure/database/index.js"

import type {
  SkillDraftBrowser,
  SkillVersionBrowser,
  SnapshotFile,
} from "./version-browser.contract.js"

interface VersionQueryRow {
  readonly id: string
  readonly sequenceNumber: number
  readonly name: string
  readonly description: string | null
  readonly labels: readonly string[]
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly createdAt: Date
  readonly frozenAt: Date
  readonly currentOnlineVersionId: string | null
  readonly comparisonBaselineVersionId: string | null
  readonly snapshotId: string
  readonly snapshotState: SkillSnapshotRow["state"]
  readonly manifestHash: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly snapshotCreatedAt: Date
}

function versionSelection() {
  return {
    id: skillVersions.id,
    sequenceNumber: skillVersions.sequenceNumber,
    name: skillVersions.name,
    description: skillVersions.description,
    labels: skillVersions.labels,
    sourceType: skillVersions.sourceType,
    sourceName: skillVersions.sourceName,
    createdAt: skillVersions.createdAt,
    frozenAt: skillVersions.frozenAt,
    currentOnlineVersionId: skillWorkspaces.currentOnlineVersionId,
    comparisonBaselineVersionId:
      skillWorkspaces.comparisonBaselineVersionId,
    snapshotId: skillSnapshots.id,
    snapshotState: skillSnapshots.state,
    manifestHash: skillSnapshots.manifestHash,
    fileCount: skillSnapshots.fileCount,
    totalBytes: skillSnapshots.totalBytes,
    snapshotCreatedAt: skillSnapshots.createdAt,
  }
}

function mapVersion(row: VersionQueryRow): SkillVersionBrowser {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    name: row.name,
    description: row.description,
    labels: [...row.labels],
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    createdAt: row.createdAt.toISOString(),
    frozenAt: row.frozenAt.toISOString(),
    isOnline: row.currentOnlineVersionId === row.id,
    isComparisonBaseline: row.comparisonBaselineVersionId === row.id,
    snapshot: {
      id: row.snapshotId,
      state: row.snapshotState,
      manifestHash: row.manifestHash,
      fileCount: row.fileCount,
      totalBytes: row.totalBytes,
      createdAt: row.snapshotCreatedAt.toISOString(),
    },
  }
}

function versionQuery(database: Database) {
  return database
    .select(versionSelection())
    .from(skillVersions)
    .innerJoin(
      skillWorkspaces,
      eq(skillWorkspaces.id, skillVersions.workspaceId),
    )
    .innerJoin(skillSnapshots, eq(skillSnapshots.id, skillVersions.snapshotId))
}

async function assertWorkspaceExists(
  database: Database,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await database
    .select({ id: skillWorkspaces.id })
    .from(skillWorkspaces)
    .where(eq(skillWorkspaces.id, workspaceId))
    .limit(1)
  if (!workspace) {
    throw new DomainError({
      code: "SKILL_WORKSPACE_NOT_FOUND",
      message: "The requested Skill testing workbench was not found.",
      kind: "not_found",
    })
  }
}

export async function listSkillVersions(
  database: Database,
  workspaceId: string,
): Promise<SkillVersionBrowser[]> {
  await assertWorkspaceExists(database, workspaceId)
  const rows = await versionQuery(database)
    .where(eq(skillVersions.workspaceId, workspaceId))
    .orderBy(desc(skillVersions.sequenceNumber))
  return rows.map(mapVersion)
}

export async function getSkillVersion(
  database: Database,
  workspaceId: string,
  versionId: string,
): Promise<SkillVersionBrowser> {
  const [row] = await versionQuery(database)
    .where(
      and(
        eq(skillVersions.workspaceId, workspaceId),
        eq(skillVersions.id, versionId),
      ),
    )
    .limit(1)
  if (!row) {
    await assertWorkspaceExists(database, workspaceId)
    throw new DomainError({
      code: "SKILL_VERSION_NOT_FOUND",
      message: "The requested immutable Skill version was not found.",
      kind: "not_found",
    })
  }
  return mapVersion(row)
}

export async function getActiveSkillDraft(
  database: Database,
  workspaceId: string,
): Promise<SkillDraftBrowser> {
  const [row] = await database
    .select({
      id: skillDrafts.id,
      contentRevision: skillDrafts.contentRevision,
      status: skillDrafts.status,
      sourceType: skillDrafts.sourceType,
      sourceName: skillDrafts.sourceName,
      ignoreRules: skillDrafts.ignoreRules,
      ignoredPaths: skillDrafts.currentIgnoredPaths,
      fileCount: skillDrafts.fileCount,
      totalBytes: skillDrafts.totalBytes,
      createdAt: skillDrafts.createdAt,
      updatedAt: skillDrafts.updatedAt,
    })
    .from(skillDrafts)
    .where(
      and(
        eq(skillDrafts.workspaceId, workspaceId),
        inArray(skillDrafts.status, ["OPEN", "FINALIZING"]),
      ),
    )
    .limit(1)

  if (!row) {
    await assertWorkspaceExists(database, workspaceId)
    throw new DomainError({
      code: "SKILL_DRAFT_NOT_FOUND",
      message: "The requested Skill working copy was not found.",
      kind: "not_found",
    })
  }
  if (row.status !== "OPEN") {
    throw new DomainError({
      code: "DRAFT_NOT_EDITABLE",
      message: "The Skill working copy is temporarily unavailable.",
      kind: "conflict",
    })
  }

  return {
    id: row.id,
    contentRevision: row.contentRevision,
    status: "OPEN",
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    ignoreRules: [...row.ignoreRules],
    ignoredPaths: [...row.ignoredPaths],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workingCopy: {
      fileCount: row.fileCount,
      totalBytes: row.totalBytes,
    },
  }
}

type FileMetadataRow = Pick<
  SkillSnapshotFileRow,
  "relativePath" | "sha256" | "byteSize" | "mediaTypeHint" | "contentKind"
>

function mapFile(
  file: FileMetadataRow,
  classifyPreview: (file: FileMetadataRow) => {
    previewKind: SnapshotFile["previewKind"]
    previewable: boolean
  },
): SnapshotFile {
  return {
    relativePath: file.relativePath,
    sha256: file.sha256,
    byteSize: file.byteSize,
    mediaTypeHint: file.mediaTypeHint,
    contentKind: file.contentKind as "text" | "binary",
    ...classifyPreview(file),
  }
}

export interface SnapshotFileRecord {
  readonly storageKind: "snapshot"
  readonly snapshotId: string
  readonly snapshotState: SkillSnapshotRow["state"]
  readonly file: SkillSnapshotFileRow
}

export interface DraftFileRecord {
  readonly storageKind: "draft"
  readonly draftId: string
  readonly file: SkillDraftFileRow
}

export type StoredFileRecord = SnapshotFileRecord | DraftFileRecord

export async function listVersionFileRows(
  database: Database,
  workspaceId: string,
  versionId: string,
): Promise<SkillSnapshotFileRow[]> {
  const version = await getSkillVersion(database, workspaceId, versionId)
  return database
    .select()
    .from(skillSnapshotFiles)
    .where(eq(skillSnapshotFiles.snapshotId, version.snapshot.id))
    .orderBy(asc(skillSnapshotFiles.relativePath))
}

export async function listVersionFiles(
  database: Database,
  workspaceId: string,
  versionId: string,
  classifyPreview: (file: FileMetadataRow) => {
    previewKind: SnapshotFile["previewKind"]
    previewable: boolean
  },
): Promise<{ targetId: string; files: SnapshotFile[] }> {
  const rows = await listVersionFileRows(database, workspaceId, versionId)
  return { targetId: versionId, files: rows.map((row) => mapFile(row, classifyPreview)) }
}

async function getSnapshotFileRecord(
  database: Database,
  snapshot: { readonly id: string; readonly state: SkillSnapshotRow["state"] },
  relativePath: string,
): Promise<SnapshotFileRecord> {
  const [file] = await database
    .select()
    .from(skillSnapshotFiles)
    .where(
      and(
        eq(skillSnapshotFiles.snapshotId, snapshot.id),
        eq(skillSnapshotFiles.relativePath, relativePath),
      ),
    )
    .limit(1)
  if (!file) {
    throw new DomainError({
      code: "SNAPSHOT_FILE_NOT_FOUND",
      message: "The requested file does not exist in this version.",
      kind: "not_found",
      details: { path: relativePath },
    })
  }
  return {
    storageKind: "snapshot",
    snapshotId: snapshot.id,
    snapshotState: snapshot.state,
    file,
  }
}

export async function getVersionFileRecord(
  database: Database,
  workspaceId: string,
  versionId: string,
  relativePath: string,
): Promise<SnapshotFileRecord> {
  const version = await getSkillVersion(database, workspaceId, versionId)
  return getSnapshotFileRecord(database, version.snapshot, relativePath)
}

export async function listDraftFiles(
  database: Database,
  workspaceId: string,
  classifyPreview: (file: FileMetadataRow) => {
    previewKind: SnapshotFile["previewKind"]
    previewable: boolean
  },
): Promise<{ targetId: string; files: SnapshotFile[] }> {
  const draft = await getActiveSkillDraft(database, workspaceId)
  const rows = await database
    .select()
    .from(skillDraftFiles)
    .where(eq(skillDraftFiles.draftId, draft.id))
    .orderBy(asc(skillDraftFiles.relativePath))
  return { targetId: draft.id, files: rows.map((row) => mapFile(row, classifyPreview)) }
}
