import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDrafts,
  skillImprovementCycles,
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
  type Database,
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
  readonly versionNumber: number
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly createdAt: Date
  readonly publishedAt: Date
  readonly currentVersionId: string | null
  readonly defaultBaselineVersionId: string | null
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
    versionNumber: skillVersions.versionNumber,
    sourceType: skillVersions.sourceType,
    sourceName: skillVersions.sourceName,
    createdAt: skillVersions.createdAt,
    publishedAt: skillVersions.publishedAt,
    currentVersionId: skillWorkspaces.currentVersionId,
    defaultBaselineVersionId: skillWorkspaces.defaultBaselineVersionId,
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
    versionNumber: row.versionNumber,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt.toISOString(),
    isCurrent: row.currentVersionId === row.id,
    isDefaultBaseline: row.defaultBaselineVersionId === row.id,
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
    .orderBy(desc(skillVersions.versionNumber))
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
      message: "The requested formal Skill version was not found.",
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
      improvementCycleId: skillImprovementCycles.id,
      baseVersionId: skillDrafts.baseVersionId,
      baseSnapshotId: skillDrafts.baseSnapshotId,
      contentRevision: skillDrafts.contentRevision,
      status: skillDrafts.status,
      sourceType: skillDrafts.sourceType,
      sourceName: skillDrafts.sourceName,
      createdAt: skillDrafts.createdAt,
      updatedAt: skillDrafts.updatedAt,
      snapshotId: skillSnapshots.id,
      snapshotState: skillSnapshots.state,
      manifestHash: skillSnapshots.manifestHash,
      fileCount: skillSnapshots.fileCount,
      totalBytes: skillSnapshots.totalBytes,
      snapshotCreatedAt: skillSnapshots.createdAt,
    })
    .from(skillDrafts)
    .innerJoin(
      skillImprovementCycles,
      eq(skillImprovementCycles.draftId, skillDrafts.id),
    )
    .innerJoin(
      skillSnapshots,
      eq(skillSnapshots.id, skillDrafts.currentSnapshotId),
    )
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
      message: "The requested active Skill candidate was not found.",
      kind: "not_found",
    })
  }

  if (row.status !== "OPEN" && row.status !== "FINALIZING") {
    throw new Error(`Active draft ${row.id} has an invalid status.`)
  }

  return {
    id: row.id,
    improvementCycleId: row.improvementCycleId,
    baseVersionId: row.baseVersionId,
    baseSnapshotId: row.baseSnapshotId,
    contentRevision: row.contentRevision,
    status: row.status,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

export interface SnapshotFileRecord {
  readonly snapshotId: string
  readonly snapshotState: SkillSnapshotRow["state"]
  readonly file: SkillSnapshotFileRow
}

function mapFile(
  file: SkillSnapshotFileRow,
  classifyPreview: (file: SkillSnapshotFileRow) => {
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

async function listSnapshotFiles(
  database: Database,
  snapshotId: string,
  classifyPreview: (file: SkillSnapshotFileRow) => {
    previewKind: SnapshotFile["previewKind"]
    previewable: boolean
  },
): Promise<{ snapshotId: string; files: SnapshotFile[] }> {
  const rows = await database
    .select()
    .from(skillSnapshotFiles)
    .where(eq(skillSnapshotFiles.snapshotId, snapshotId))
    .orderBy(asc(skillSnapshotFiles.relativePath))

  return {
    snapshotId,
    files: rows.map((row) => mapFile(row, classifyPreview)),
  }
}

export async function listVersionFiles(
  database: Database,
  workspaceId: string,
  versionId: string,
  classifyPreview: (file: SkillSnapshotFileRow) => {
    previewKind: SnapshotFile["previewKind"]
    previewable: boolean
  },
): Promise<{ snapshotId: string; files: SnapshotFile[] }> {
  const version = await getSkillVersion(database, workspaceId, versionId)
  return listSnapshotFiles(database, version.snapshot.id, classifyPreview)
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
      message: "The requested file does not exist in this Snapshot.",
      kind: "not_found",
      details: { path: relativePath },
    })
  }

  return {
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
  classifyPreview: (file: SkillSnapshotFileRow) => {
    previewKind: SnapshotFile["previewKind"]
    previewable: boolean
  },
): Promise<{ snapshotId: string; files: SnapshotFile[] }> {
  const draft = await getActiveSkillDraft(database, workspaceId)
  return listSnapshotFiles(database, draft.snapshot.id, classifyPreview)
}

export async function getDraftFileRecord(
  database: Database,
  workspaceId: string,
  relativePath: string,
): Promise<SnapshotFileRecord> {
  const draft = await getActiveSkillDraft(database, workspaceId)
  return getSnapshotFileRecord(database, draft.snapshot, relativePath)
}
