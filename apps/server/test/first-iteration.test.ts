import assert from "node:assert/strict"
import { File } from "node:buffer"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { deflateRawSync } from "node:zlib"

import { migrate } from "drizzle-orm/node-postgres/migrator"
import { eq } from "drizzle-orm"

import { buildApplication } from "../src/app.js"
import { DomainError } from "../src/core/errors/domain-error.js"
import {
  closeDatabaseClient,
  createDatabaseClient,
} from "../src/infrastructure/database/client.js"
import {
  skillDrafts,
  skillDraftMutations,
  skillDraftRevisions,
  skillImprovementCycles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
  uploadOperations,
} from "../src/infrastructure/database/schema/index.js"
import { buildSnapshotManifest } from "../src/modules/skill-workspaces/snapshot-manifest.js"
import { LocalSnapshotStorage } from "../src/modules/skill-workspaces/snapshot-storage.js"
import {
  prepareRelativePaths,
  normalizeRelativePath,
} from "../src/modules/skill-workspaces/upload-validation.js"
import {
  loadUploadFolderIgnorePolicy,
  shouldIgnoreFolderPath,
} from "../src/modules/skill-workspaces/upload-folder-ignore-policy.js"
import {
  classifySnapshotFile,
  readTextPreview,
} from "../src/modules/skill-workspaces/version-browser.service.js"
import type { SnapshotFileRecord } from "../src/modules/skill-workspaces/version-browser.repository.js"

const limits = {
  maxFiles: 2_000,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxDirectoryDepth: 32,
  maxPathLength: 512,
  maxZipBytes: 100 * 1024 * 1024,
  maxZipCompressionRatio: 100,
} as const
const folderIgnorePolicyPath = fileURLToPath(
  new URL("../config/upload-folder-ignore.json", import.meta.url),
)
const folderIgnorePolicy = await loadUploadFolderIgnorePolicy(
  folderIgnorePolicyPath,
)

test("normalizes portable paths and rejects traversal", () => {
  assert.equal(normalizeRelativePath("docs/SKILL.md", limits), "docs/SKILL.md")
  assert.throws(
    () => normalizeRelativePath("../outside.md", limits),
    /stored safely/,
  )
  assert.throws(
    () => normalizeRelativePath("C:/outside.md", limits),
    /absolute or unsupported/,
  )
  assert.throws(
    () => normalizeRelativePath("assets/CON.txt", limits),
    /stored safely/,
  )
})

test("strips one selected folder root and detects case conflicts", () => {
  const prepared = prepareRelativePaths(
    ["invoice-skill/SKILL.md", "invoice-skill/scripts/check.py"],
    "folder",
    limits,
  )

  assert.equal(prepared.strippedRoot, "invoice-skill")
  assert.deepEqual(
    prepared.files.map((file) => file.relativePath),
    ["SKILL.md", "scripts/check.py"],
  )
  assert.throws(
    () =>
      prepareRelativePaths(
        ["skill/README.md", "skill/readme.md"],
        "folder",
        limits,
      ),
    /differ only by letter case/,
  )
})

test("excludes .git metadata from the formal manifest path set", () => {
  const prepared = prepareRelativePaths(
    ["skill/SKILL.md", "skill/.git/config"],
    "folder",
    limits,
  )

  assert.equal(prepared.ignoredCount, 1)
  assert.deepEqual(
    prepared.files.map((file) => file.relativePath),
    ["SKILL.md"],
  )
})

test("loads and applies the configured folder-only ignore policy", () => {
  assert.equal(
    shouldIgnoreFolderPath(
      "scripts/node_modules/package/index.js",
      folderIgnorePolicy,
    ),
    true,
  )
  assert.equal(
    shouldIgnoreFolderPath(
      "scripts/Node_Modules/package/index.js",
      folderIgnorePolicy,
    ),
    true,
  )
  assert.equal(
    shouldIgnoreFolderPath("scripts/cache.pyc", folderIgnorePolicy),
    true,
  )
  assert.equal(
    shouldIgnoreFolderPath("package.json", folderIgnorePolicy),
    false,
  )

  const folder = prepareRelativePaths(
    [
      "skill/SKILL.md",
      "skill/package.json",
      "skill/node_modules/package/index.js",
      "skill/.venv/lib/tool.py",
      "skill/scripts/cache.pyc",
    ],
    "folder",
    limits,
    folderIgnorePolicy,
  )
  assert.equal(folder.ignoredCount, 3)
  assert.deepEqual(
    folder.files.map((file) => file.relativePath),
    ["SKILL.md", "package.json"],
  )

  const zip = prepareRelativePaths(
    ["skill/SKILL.md", "skill/node_modules/package/index.js"],
    "zip",
    limits,
    folderIgnorePolicy,
  )
  assert.equal(zip.ignoredCount, 0)
  assert.deepEqual(
    zip.files.map((file) => file.relativePath),
    ["SKILL.md", "node_modules/package/index.js"],
  )

  assert.throws(
    () =>
      prepareRelativePaths(
        ["skill/node_modules/package/index.js"],
        "folder",
        limits,
        folderIgnorePolicy,
      ),
    /contains no files/,
  )
})

test("rejects an invalid folder ignore configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillconsole-policy-"))
  const invalidPolicyPath = path.join(root, "upload-folder-ignore.json")

  try {
    await writeFile(
      invalidPolicyPath,
      JSON.stringify({
        schemaVersion: 1,
        caseSensitive: false,
        ignoredDirectoryNames: ["node_modules"],
      }),
      "utf8",
    )

    await assert.rejects(
      loadUploadFolderIgnorePolicy(invalidPolicyPath),
      /does not match schema version 1/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("builds a stable SHA-256 manifest from actual file bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillconsole-manifest-"))
  try {
    const firstPath = path.join(root, "first")
    const secondPath = path.join(root, "second")
    await Promise.all([
      writeFile(firstPath, "# Skill\n", "utf8"),
      writeFile(secondPath, Buffer.from([0, 1, 2, 3])),
    ])

    const first = await buildSnapshotManifest(
      [
        { incomingPath: secondPath, relativePath: "assets/data.bin" },
        { incomingPath: firstPath, relativePath: "SKILL.md" },
      ],
      limits,
    )
    const second = await buildSnapshotManifest(
      [
        { incomingPath: firstPath, relativePath: "SKILL.md" },
        { incomingPath: secondPath, relativePath: "assets/data.bin" },
      ],
      limits,
    )

    assert.equal(first.manifestHash, second.manifestHash)
    assert.equal(first.fileCount, 2)
    assert.equal(first.totalBytes, 12)
    assert.equal(
      first.files.find((file) => file.relativePath === "SKILL.md")
        ?.contentKind,
      "text",
    )
    assert.equal(
      first.files.find((file) => file.relativePath === "assets/data.bin")
        ?.contentKind,
      "binary",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("classifies all UTF-8 text candidates as previewable regardless of size", () => {
  assert.deepEqual(
    classifySnapshotFile({
      relativePath: "SKILL.md",
      byteSize: 128,
      mediaTypeHint: "text/markdown",
      contentKind: "text",
    }),
    { previewKind: "markdown", previewable: true },
  )
  assert.deepEqual(
    classifySnapshotFile({
      relativePath: "assets/logo.png",
      byteSize: 256,
      mediaTypeHint: "image/png",
      contentKind: "binary",
    }),
    { previewKind: "image", previewable: true },
  )
  assert.deepEqual(
    classifySnapshotFile({
      relativePath: "assets/archive.bin",
      byteSize: 256,
      mediaTypeHint: "application/octet-stream",
      contentKind: "binary",
    }),
    { previewKind: "binary", previewable: false },
  )
  assert.deepEqual(
    classifySnapshotFile({
      relativePath: "logs/large.txt",
      byteSize: 8 * 1024 * 1024,
      mediaTypeHint: "text/plain",
      contentKind: "text",
    }),
    { previewKind: "text", previewable: true },
  )
})

test("reads large text and returns explicit unsafe or corrupted Snapshot states", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillconsole-browser-"))
  const storage = new LocalSnapshotStorage(root)
  const snapshotId = randomUUID()
  await storage.initialize()

  function createRecord(
    relativePath: string,
    content: Buffer,
    overrides: Partial<SnapshotFileRecord["file"]> = {},
  ): SnapshotFileRecord {
    return {
      storageKind: "snapshot",
      snapshotId,
      snapshotState: "READY",
      file: {
        id: randomUUID(),
        snapshotId,
        relativePath,
        sha256: createHash("sha256").update(content).digest("hex"),
        byteSize: content.byteLength,
        mediaTypeHint: "text/plain",
        contentKind: "text",
        ...overrides,
      },
    }
  }

  async function writeSnapshotFile(
    relativePath: string,
    content: Buffer,
  ): Promise<void> {
    const target = storage.getSnapshotFilePath(snapshotId, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  try {
    assert.throws(
      () => storage.getSnapshotFilePath(snapshotId, "../escape.txt"),
      /invalid/,
    )

    const largeText = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)
    await writeSnapshotFile("large.txt", largeText)
    const largePreview = await readTextPreview(
      storage,
      createRecord("large.txt", largeText),
    )
    assert.equal(largePreview.content.length, largeText.length)

    const corruptedContent = Buffer.from("tampered", "utf8")
    await writeSnapshotFile("corrupted.txt", corruptedContent)
    await assert.rejects(
      readTextPreview(
        storage,
        createRecord("corrupted.txt", corruptedContent, {
          sha256: "0".repeat(64),
        }),
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === "SNAPSHOT_FILE_CORRUPTED",
    )

    const invalidUtf8 = Buffer.from([0xc3, 0x28])
    await writeSnapshotFile("invalid.txt", invalidUtf8)
    await assert.rejects(
      readTextPreview(
        storage,
        createRecord("invalid.txt", invalidUtf8),
      ),
      (error) =>
        error instanceof DomainError && error.code === "FILE_UTF8_INVALID",
    )

    await assert.rejects(
      readTextPreview(storage, {
        ...createRecord("invalid.txt", invalidUtf8),
        snapshotState: "CORRUPTED",
      }),
      (error) =>
        error instanceof DomainError && error.code === "SNAPSHOT_NOT_READY",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const crcTable = Array.from({ length: 256 }, (_value, tableIndex) => {
  let current = tableIndex
  for (let bit = 0; bit < 8; bit += 1) {
    current =
      (current & 1) === 1
        ? 0xedb88320 ^ (current >>> 1)
        : current >>> 1
  }
  return current >>> 0
})

function crc32(buffer: Buffer): number {
  let checksum = 0xffffffff
  for (const byte of buffer) {
    checksum = (checksum >>> 8) ^ (crcTable[(checksum ^ byte) & 0xff] ?? 0)
  }
  return (checksum ^ 0xffffffff) >>> 0
}

interface ZipEntryInput {
  readonly name: string
  readonly content: string | Buffer
  readonly unixMode?: number
}

function createZip(entries: readonly ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8")
    const compressed = deflateRawSync(content)
    const checksum = crc32(content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(0x0314, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(
      ((entry.unixMode ?? 0o100644) << 16) >>> 0,
      38,
    )
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)
    offset += localHeader.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralDirectory, end])
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

test(
  "creates durable initial candidates without formal versions through the API",
  { skip: !testDatabaseUrl, timeout: 60_000 },
  async () => {
    assert.ok(testDatabaseUrl)
    const dataRoot = await mkdtemp(path.join(tmpdir(), "skillconsole-api-"))
    const databaseClient = createDatabaseClient(testDatabaseUrl, {
      applicationName: "skillconsole-first-iteration-test",
      maxConnections: 2,
    })
    const migrationsFolder = fileURLToPath(
      new URL("../migrations", import.meta.url),
    )

    try {
      await migrate(databaseClient.database, {
        migrationsFolder,
        migrationsSchema: "drizzle",
        migrationsTable: "migrations",
      })
    } finally {
      await closeDatabaseClient(databaseClient)
    }

    const config = {
      nodeEnvironment: "test",
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: testDatabaseUrl,
      logLevel: "silent",
      openApiEnabled: true,
      dataRoot,
      uploadFolderIgnoreConfigPath: folderIgnorePolicyPath,
      uploadLimits: limits,
    } as const
    let application = await buildApplication({ config, logger: false })
    const address = await application.listen({ host: "127.0.0.1", port: 0 })

    async function createWorkspace(
      name: string,
      sourceType: "single_file" | "folder" | "zip",
      files: readonly { name: string; content: string | Buffer; type?: string }[],
      operationId = randomUUID(),
    ) {
      const formData = new FormData()
      formData.append("operationId", operationId)
      formData.append("name", name)
      formData.append("sourceType", sourceType)
      for (const file of files) {
        formData.append(
          "files",
          new File(
            [
              Buffer.isBuffer(file.content)
                ? new Uint8Array(file.content)
                : file.content,
            ],
            path.basename(file.name),
            {
              type: file.type ?? "application/octet-stream",
            },
          ),
          file.name,
        )
      }

      return {
        operationId,
        response: await fetch(`${address}/api/skill-workspaces`, {
          method: "POST",
          body: formData,
        }),
      }
    }

    try {
      const policyResponse = await fetch(
        `${address}/api/skill-workspace-upload-policy`,
      )
      assert.equal(policyResponse.status, 200)
      assert.deepEqual(await policyResponse.json(), folderIgnorePolicy)

      const single = await createWorkspace(
        "Single file Skill",
        "single_file",
        [{ name: "SKILL.md", content: "# Single\n", type: "text/markdown" }],
      )
      assert.equal(single.response.status, 201)
      const singleBody = (await single.response.json()) as {
        workspace: {
          id: string
          onlineVersion: null
          activeDraft: {
            id: string
            workingCopy: { fileCount: number }
          }
        }
        upload: { fileCount: number; manifestHash: string }
      }
      assert.equal(singleBody.upload.fileCount, 1)
      assert.equal(singleBody.workspace.onlineVersion, null)
      assert.equal(singleBody.workspace.activeDraft.workingCopy.fileCount, 1)

      const replayedSingle = await createWorkspace(
        "Single file Skill",
        "single_file",
        [{ name: "SKILL.md", content: "# Replayed request\n" }],
        single.operationId,
      )
      assert.equal(replayedSingle.response.status, 200)
      const replayedSingleBody = (await replayedSingle.response.json()) as {
        replayed: boolean
        workspace: { id: string }
        upload: { manifestHash: string }
      }
      assert.equal(replayedSingleBody.replayed, true)
      assert.equal(
        replayedSingleBody.workspace.id,
        singleBody.workspace.id,
      )
      assert.equal(
        replayedSingleBody.upload.manifestHash,
        singleBody.upload.manifestHash,
      )

      const singleDraftUrl =
        `${address}/api/skill-workspaces/${singleBody.workspace.id}/draft`
      const initialSingleDraftResponse = await fetch(singleDraftUrl)
      assert.equal(initialSingleDraftResponse.status, 200)
      let singleDraftEtag =
        initialSingleDraftResponse.headers.get("etag")
      assert.ok(singleDraftEtag)

      const missingPrecondition = await fetch(
        `${singleDraftUrl}/files/text`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            path: "SKILL.md",
            content: "# Missing precondition\n",
          }),
        },
      )
      assert.equal(missingPrecondition.status, 428)

      const staleEtag = singleDraftEtag
      let replayKey = ""
      let replayBody = ""
      for (let revision = 2; revision <= 11; revision += 1) {
        const idempotencyKey = randomUUID()
        const content = `# Single\n\nDraft revision ${revision}\n`
        const response = await fetch(`${singleDraftUrl}/files/text`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "If-Match": singleDraftEtag,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ path: "SKILL.md", content }),
        })
        assert.equal(response.status, 200)
        const body = (await response.json()) as {
          draft: { contentRevision: number }
          replayed: boolean
        }
        assert.equal(body.draft.contentRevision, revision)
        assert.equal(body.replayed, false)
        singleDraftEtag = response.headers.get("etag")
        assert.ok(singleDraftEtag)
        if (revision === 2) {
          replayKey = idempotencyKey
          replayBody = content
        }
      }

      const staleSave = await fetch(`${singleDraftUrl}/files/text`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": staleEtag,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          path: "SKILL.md",
          content: "# Must not overwrite\n",
        }),
      })
      assert.equal(staleSave.status, 412)

      const replayedSave = await fetch(`${singleDraftUrl}/files/text`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": staleEtag,
          "Idempotency-Key": replayKey,
        },
        body: JSON.stringify({
          path: "SKILL.md",
          content: replayBody,
        }),
      })
      assert.equal(replayedSave.status, 200)
      const replayedSaveBody = (await replayedSave.json()) as {
        draft: { contentRevision: number }
        replayed: boolean
      }
      assert.equal(replayedSaveBody.draft.contentRevision, 11)
      assert.equal(replayedSaveBody.replayed, true)

      const singleVersionsResponse = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}/versions`,
      )
      assert.equal(singleVersionsResponse.status, 200)
      assert.deepEqual(await singleVersionsResponse.json(), [])
      const singleMutations = await application.databaseClient.database
        .select()
        .from(skillDraftMutations)
        .where(
          eq(
            skillDraftMutations.draftId,
            singleBody.workspace.activeDraft.id,
          ),
        )
      assert.equal(singleMutations.length, 10)
      const singleRevisions = await application.databaseClient.database
        .select()
        .from(skillDraftRevisions)
        .where(
          eq(
            skillDraftRevisions.draftId,
            singleBody.workspace.activeDraft.id,
          ),
        )
      assert.equal(singleRevisions.length, 0)

      const folder = await createWorkspace("Folder Skill", "folder", [
        {
          name: "folder-skill/SKILL.md",
          content: "# 文件夹 Skill\n\n<script>alert('blocked')</script>\n",
          type: "text/markdown",
        },
        {
          name: "folder-skill/scripts/check.py",
          content: "print('ok')\n",
          type: "text/x-python",
        },
        {
          name: "folder-skill/config/settings.json",
          content: '{"名称":"发票审核","enabled":true}\n',
          type: "application/json",
        },
        {
          name: "folder-skill/config/settings.yaml",
          content: "名称: 发票审核\nenabled: true\n",
          type: "application/yaml",
        },
        {
          name: "folder-skill/assets/pixel.png",
          content: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
          type: "image/png",
        },
        {
          name: "folder-skill/assets/data.bin",
          content: Buffer.from([0, 1, 2, 3]),
          type: "application/octet-stream",
        },
        {
          name: "folder-skill/node_modules/package/index.js",
          content: "export const dependency = true\n",
          type: "text/javascript",
        },
        {
          name: "folder-skill/scripts/cache.pyc",
          content: Buffer.from([0, 1, 2, 3]),
          type: "application/octet-stream",
        },
      ])
      assert.equal(folder.response.status, 201)
      const folderBody = (await folder.response.json()) as {
        workspace: {
          id: string
          onlineVersion: null
          activeDraft: {
            id: string
            workingCopy: { fileCount: number }
          }
        }
        upload: {
          fileCount: number
          ignoredFileCount: number
          strippedRoot: string | null
        }
      }
      assert.equal(folderBody.upload.fileCount, 6)
      assert.equal(folderBody.upload.ignoredFileCount, 2)
      assert.equal(folderBody.upload.strippedRoot, "folder-skill")
      assert.equal(folderBody.workspace.onlineVersion, null)

      const versionsResponse = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/versions`,
      )
      assert.equal(versionsResponse.status, 200)
      const versions = (await versionsResponse.json()) as unknown[]
      assert.deepEqual(versions, [])

      const draftResponse = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/draft`,
      )
      assert.equal(draftResponse.status, 200)
      const draft = (await draftResponse.json()) as {
        id: string
        contentRevision: number
        status: string
        workingCopy: { fileCount: number; totalBytes: number }
      }
      assert.equal(draft.id, folderBody.workspace.activeDraft.id)
      assert.equal(draft.contentRevision, 1)
      assert.equal(draft.status, "OPEN")
      assert.equal(draft.workingCopy.fileCount, 6)

      const database = application.databaseClient.database
      const [workspaceRow] = await database
        .select()
        .from(skillWorkspaces)
        .where(eq(skillWorkspaces.id, folderBody.workspace.id))
      assert.ok(workspaceRow)
      assert.equal(workspaceRow.currentOnlineVersionId, null)
      assert.equal(workspaceRow.comparisonBaselineVersionId, null)

      const [draftRow] = await database
        .select()
        .from(skillDrafts)
        .where(eq(skillDrafts.id, folderBody.workspace.activeDraft.id))
      assert.ok(draftRow)
      assert.equal(draftRow.baseVersionId, null)
      assert.equal(draftRow.baseSnapshotId, null)
      assert.equal(draftRow.currentSnapshotId, null)
      assert.equal(draftRow.status, "OPEN")
      assert.equal(draftRow.contentRevision, 1)
      assert.equal(draftRow.fileCount, 6)

      const [cycleRow] = await database
        .select()
        .from(skillImprovementCycles)
        .where(eq(skillImprovementCycles.draftId, draftRow.id))
      assert.ok(cycleRow)
      assert.equal(cycleRow.baseVersionId, null)
      assert.equal(cycleRow.status, "DRAFTING")

      const versionsBeforeFreeze = await database.select().from(skillVersions)
      assert.equal(versionsBeforeFreeze.length, 0)
      const [uploadOperation] = await database
        .select()
        .from(uploadOperations)
        .where(eq(uploadOperations.id, folder.operationId))
      assert.ok(uploadOperation)
      assert.equal(uploadOperation.draftId, draftRow.id)
      assert.equal(uploadOperation.improvementCycleId, cycleRow.id)
      assert.equal(uploadOperation.state, "SUCCEEDED")

      const completedOperationResponse = await fetch(
        `${address}/api/skill-workspace-uploads/${folder.operationId}`,
      )
      assert.equal(completedOperationResponse.status, 200)
      const completedOperation =
        (await completedOperationResponse.json()) as {
          workspaceId: string
          snapshotId: null
          draftId: string
          improvementCycleId: string
        }
      assert.equal(
        completedOperation.workspaceId,
        folderBody.workspace.id,
      )
      assert.equal(completedOperation.snapshotId, null)
      assert.equal(completedOperation.draftId, draft.id)
      assert.equal(
        completedOperation.improvementCycleId,
        cycleRow.id,
      )

      const filesBase =
        `${address}/api/skill-workspaces/${folderBody.workspace.id}` +
        `/draft/files`
      const filesResponse = await fetch(filesBase)
      assert.equal(filesResponse.status, 200)
      const fileList = (await filesResponse.json()) as {
        targetId: string
        files: Array<{
          relativePath: string
          previewKind: string
          previewable: boolean
        }>
      }
      assert.equal(
        fileList.targetId,
        folderBody.workspace.activeDraft.id,
      )
      assert.equal(fileList.files.length, 6)
      assert.deepEqual(
        fileList.files.map((file) => [
          file.relativePath,
          file.previewKind,
          file.previewable,
        ]),
        [
          ["SKILL.md", "markdown", true],
          ["assets/data.bin", "binary", false],
          ["assets/pixel.png", "image", true],
          ["config/settings.json", "json", true],
          ["config/settings.yaml", "yaml", true],
          ["scripts/check.py", "text", true],
        ],
      )

      const markdownResponse = await fetch(
        `${filesBase}/text-preview?path=${encodeURIComponent("SKILL.md")}`,
      )
      assert.equal(markdownResponse.status, 200)
      const markdown = (await markdownResponse.json()) as {
        kind: string
        encoding: string
        content: string
      }
      assert.equal(markdown.kind, "markdown")
      assert.equal(markdown.encoding, "utf-8")
      assert.match(markdown.content, /文件夹 Skill/)
      assert.match(markdown.content, /<script>alert/)

      const jsonResponse = await fetch(
        `${filesBase}/text-preview?path=${encodeURIComponent("config/settings.json")}`,
      )
      assert.equal(jsonResponse.status, 200)
      assert.match(
        ((await jsonResponse.json()) as { content: string }).content,
        /发票审核/,
      )

      const imageResponse = await fetch(
        `${filesBase}/image-preview?path=${encodeURIComponent("assets/pixel.png")}`,
      )
      assert.equal(imageResponse.status, 200)
      assert.equal(imageResponse.headers.get("content-type"), "image/png")
      assert.equal(
        imageResponse.headers.get("x-content-type-options"),
        "nosniff",
      )
      assert.match(
        imageResponse.headers.get("content-security-policy") ?? "",
        /sandbox/,
      )

      const binaryPreviewResponse = await fetch(
        `${filesBase}/text-preview?path=${encodeURIComponent("assets/data.bin")}`,
      )
      assert.equal(binaryPreviewResponse.status, 415)
      assert.equal(
        (
          (await binaryPreviewResponse.json()) as {
            error: { code: string }
          }
        ).error.code,
        "FILE_TEXT_PREVIEW_NOT_SUPPORTED",
      )

      const downloadResponse = await fetch(
        `${filesBase}/download?path=${encodeURIComponent("assets/data.bin")}`,
      )
      assert.equal(downloadResponse.status, 200)
      assert.equal(
        downloadResponse.headers.get("content-type"),
        "application/octet-stream",
      )
      assert.match(
        downloadResponse.headers.get("content-disposition") ?? "",
        /^attachment;/,
      )
      assert.deepEqual(
        Buffer.from(await downloadResponse.arrayBuffer()),
        Buffer.from([0, 1, 2, 3]),
      )

      const missingFileResponse = await fetch(
        `${filesBase}/text-preview?path=${encodeURIComponent("missing.txt")}`,
      )
      assert.equal(missingFileResponse.status, 404)

      const missingFormalVersionResponse = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}` +
          `/versions/${randomUUID()}`,
      )
      assert.equal(missingFormalVersionResponse.status, 404)

      const editableDraftResponse = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/draft`,
      )
      assert.equal(editableDraftResponse.status, 200)
      let editableDraftEtag = editableDraftResponse.headers.get("etag")
      assert.ok(editableDraftEtag)

      const singleFileForm = new FormData()
      singleFileForm.append("path", "references/new.txt")
      singleFileForm.append(
        "file",
        new File(["single-file upload\n"], "new.txt", {
          type: "text/plain",
        }),
      )
      const singleFileMutation = await fetch(filesBase, {
        method: "POST",
        headers: {
          "If-Match": editableDraftEtag,
          "Idempotency-Key": randomUUID(),
        },
        body: singleFileForm,
      })
      assert.equal(singleFileMutation.status, 200)
      const singleFileMutationBody =
        (await singleFileMutation.json()) as {
          draft: {
            contentRevision: number
            workingCopy: { fileCount: number }
          }
        }
      assert.equal(singleFileMutationBody.draft.contentRevision, 2)
      assert.equal(singleFileMutationBody.draft.workingCopy.fileCount, 7)
      editableDraftEtag = singleFileMutation.headers.get("etag")
      assert.ok(editableDraftEtag)

      const afterSingleFileResponse = await fetch(filesBase)
      assert.equal(afterSingleFileResponse.status, 200)
      const afterSingleFile = (await afterSingleFileResponse.json()) as {
        files: Array<{ relativePath: string }>
      }
      assert.deepEqual(
        afterSingleFile.files.map((file) => file.relativePath),
        [
          "SKILL.md",
          "assets/data.bin",
          "assets/pixel.png",
          "config/settings.json",
          "config/settings.yaml",
          "references/new.txt",
          "scripts/check.py",
        ],
      )

      await writeFile(
        path.join(
          dataRoot,
          "drafts",
          folderBody.workspace.activeDraft.id,
          "files",
          "config",
          "settings.json",
        ),
        '{"tampered":true}\n',
        "utf8",
      )
      const corruptedResponse = await fetch(
        `${filesBase}/text-preview?path=${encodeURIComponent("config/settings.json")}`,
      )
      assert.equal(corruptedResponse.status, 409)
      assert.equal(
        (
          (await corruptedResponse.json()) as {
            error: { code: string }
          }
        ).error.code,
        "SNAPSHOT_FILE_CORRUPTED",
      )

      const incrementalSave = await fetch(
        `${filesBase}/text`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "If-Match": editableDraftEtag,
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            path: "SKILL.md",
            content: "# Must not legitimize corrupted siblings\n",
          }),
        },
      )
      assert.equal(incrementalSave.status, 200)
      editableDraftEtag = incrementalSave.headers.get("etag")
      assert.ok(editableDraftEtag)

      await writeFile(
        path.join(
          dataRoot,
          "drafts",
          folderBody.workspace.activeDraft.id,
          "files",
          "config",
          "settings.json",
        ),
        '{"名称":"发票审核","enabled":true}\n',
        "utf8",
      )

      const folderMergeId = randomUUID()
      const mergeForm = new FormData()
      mergeForm.append("operationId", folderMergeId)
      mergeForm.append("sourceName", "supplement")
      mergeForm.append(
        "ignoreRules",
        JSON.stringify(["*.tmp", "!keep.tmp"]),
      )
      for (const addition of [
        {
          name: "supplement/SKILL.md",
          content: "# Merged update\n",
        },
        {
          name: "supplement/keep.tmp",
          content: "kept by negation\n",
        },
        {
          name: "supplement/drop.tmp",
          content: "ignored\n",
        },
        {
          name: "supplement/new.json",
          content: '{"merged":true}\n',
        },
      ]) {
        mergeForm.append(
          "files",
          new File([addition.content], path.basename(addition.name)),
          addition.name,
        )
      }
      const mergePreviewResponse = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/draft/folder-merges`,
        {
          method: "POST",
          headers: { "If-Match": editableDraftEtag },
          body: mergeForm,
        },
      )
      assert.equal(mergePreviewResponse.status, 200)
      const mergePreview =
        (await mergePreviewResponse.json()) as {
          operationId: string
          committable: boolean
          summary: {
            added: number
            modified: number
            deleted: number
            unchanged: number
            ignored: number
            conflicts: number
            unpreviewable: number
            totalFiles: number
          }
        }
      assert.equal(mergePreview.operationId, folderMergeId)
      assert.equal(mergePreview.committable, true)
      assert.equal(mergePreview.summary.added, 2)
      assert.equal(mergePreview.summary.modified, 1)
      assert.equal(mergePreview.summary.deleted, 0)
      assert.equal(mergePreview.summary.unchanged, 6)
      assert.equal(mergePreview.summary.ignored, 1)
      assert.equal(mergePreview.summary.unpreviewable, 1)
      assert.equal(mergePreview.summary.conflicts, 0)
      assert.equal(mergePreview.summary.totalFiles, 9)

      const mergeCommitUrl =
        `${address}/api/skill-workspaces/${folderBody.workspace.id}` +
        `/draft/folder-merges/${folderMergeId}/commit`
      const folderCommitKey = `folder-merge-${folderMergeId}`
      const committedMerge = await fetch(mergeCommitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": editableDraftEtag,
          "Idempotency-Key": folderCommitKey,
        },
        body: JSON.stringify({}),
      })
      assert.equal(committedMerge.status, 200)
      const committedMergeBody = (await committedMerge.json()) as {
        draft: {
          contentRevision: number
          sourceName: string
          workingCopy: { fileCount: number }
        }
      }
      assert.equal(committedMergeBody.draft.contentRevision, 4)
      assert.equal(committedMergeBody.draft.sourceName, "folder-skill")
      assert.equal(committedMergeBody.draft.workingCopy.fileCount, 9)

      const afterFolderMergeResponse = await fetch(filesBase)
      assert.equal(afterFolderMergeResponse.status, 200)
      const afterFolderMerge =
        (await afterFolderMergeResponse.json()) as {
          files: Array<{ relativePath: string }>
        }
      assert.deepEqual(
        afterFolderMerge.files.map((file) => file.relativePath),
        [
          "SKILL.md",
          "assets/data.bin",
          "assets/pixel.png",
          "config/settings.json",
          "config/settings.yaml",
          "keep.tmp",
          "new.json",
          "references/new.txt",
          "scripts/check.py",
        ],
      )

      const versionsAfterDraftChanges = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/versions`,
      )
      assert.equal(versionsAfterDraftChanges.status, 200)
      assert.deepEqual(await versionsAfterDraftChanges.json(), [])

      const archive = createZip([
        { name: "zip-skill/SKILL.md", content: "# ZIP\n" },
        { name: "zip-skill/templates/example.md", content: "Example\n" },
      ])
      const zip = await createWorkspace("ZIP Skill", "zip", [
        {
          name: "zip-skill.zip",
          content: archive,
          type: "application/zip",
        },
      ])
      assert.equal(zip.response.status, 201)
      const zipBody = (await zip.response.json()) as {
        upload: { fileCount: number; strippedRoot: string | null }
      }
      assert.equal(zipBody.upload.fileCount, 2)
      assert.equal(zipBody.upload.strippedRoot, "zip-skill")

      const duplicate = await createWorkspace(
        "Single file Skill",
        "single_file",
        [{ name: "SKILL.md", content: "# Duplicate\n" }],
      )
      assert.equal(duplicate.response.status, 409)

      const unsafeArchive = createZip([
        { name: "../escape.md", content: "unsafe" },
      ])
      const unsafe = await createWorkspace("Unsafe ZIP", "zip", [
        { name: "unsafe.zip", content: unsafeArchive },
      ])
      assert.equal(unsafe.response.status, 422)
      const operationResponse = await fetch(
        `${address}/api/skill-workspace-uploads/${unsafe.operationId}`,
      )
      assert.equal(operationResponse.status, 200)
      const operation = (await operationResponse.json()) as {
        state: string
        workspaceId: string | null
        snapshotId: string | null
        draftId: string | null
        improvementCycleId: string | null
      }
      assert.equal(operation.state, "FAILED")
      assert.equal(operation.workspaceId, null)
      assert.equal(operation.snapshotId, null)
      assert.equal(operation.draftId, null)
      assert.equal(operation.improvementCycleId, null)

      const recovered = await createWorkspace(
        "Unsafe ZIP",
        "zip",
        [
          {
            name: "recovered.zip",
            content: createZip([
              { name: "recovered/SKILL.md", content: "# Recovered\n" },
            ]),
          },
        ],
        unsafe.operationId,
      )
      assert.equal(recovered.response.status, 201)

      const symbolicLinkArchive = createZip([
        {
          name: "skill/link",
          content: "SKILL.md",
          unixMode: 0o120777,
        },
      ])
      const symbolicLink = await createWorkspace("Symlink ZIP", "zip", [
        { name: "symlink.zip", content: symbolicLinkArchive },
      ])
      assert.equal(symbolicLink.response.status, 422)

      const compressionBombArchive = createZip([
        {
          name: "skill/large.txt",
          content: Buffer.alloc(512 * 1024),
        },
      ])
      const compressionBomb = await createWorkspace(
        "Compression Bomb ZIP",
        "zip",
        [{ name: "bomb.zip", content: compressionBombArchive }],
      )
      assert.equal(compressionBomb.response.status, 422)

      const caseConflictArchive = createZip([
        { name: "skill/README.md", content: "first" },
        { name: "skill/readme.md", content: "second" },
      ])
      const caseConflict = await createWorkspace("Case Conflict ZIP", "zip", [
        { name: "case-conflict.zip", content: caseConflictArchive },
      ])
      assert.equal(caseConflict.response.status, 422)

      const oversized = await createWorkspace(
        "Oversized file",
        "single_file",
        [
          {
            name: "large.bin",
            content: Buffer.alloc(limits.maxFileBytes + 1),
          },
        ],
      )
      assert.equal(oversized.response.status, 413)

      const listResponse = await fetch(`${address}/api/skill-workspaces`)
      assert.equal(listResponse.status, 200)
      const workspaces = (await listResponse.json()) as unknown[]
      assert.equal(workspaces.length, 4)

      const latestSingleDraftResponse = await fetch(singleDraftUrl)
      assert.equal(latestSingleDraftResponse.status, 200)
      const latestSingleDraft = (await latestSingleDraftResponse.json()) as {
        id: string
        contentRevision: number
        workingCopy: { fileCount: number }
      }
      const latestSingleEtag =
        latestSingleDraftResponse.headers.get("etag")
      assert.ok(latestSingleEtag)

      const firstVersionResponse = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "V1",
            labels: ["候选"],
            setOnline: true,
          }),
        },
      )
      assert.equal(firstVersionResponse.status, 201)
      const firstVersion = (await firstVersionResponse.json()) as {
        id: string
        name: string
        isOnline: boolean
        snapshot: { id: string; manifestHash: string }
      }
      assert.equal(firstVersion.name, "V1")
      assert.equal(firstVersion.isOnline, true)
      const snapshotManifest = JSON.parse(
        await readFile(
          path.join(
            dataRoot,
            "snapshots",
            firstVersion.snapshot.id,
            "manifest.json",
          ),
          "utf8",
        ),
      ) as { manifestHash: string }
      assert.equal(
        snapshotManifest.manifestHash,
        firstVersion.snapshot.manifestHash,
      )

      const laterDraftSave = await fetch(`${singleDraftUrl}/files/text`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": latestSingleEtag,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          path: "SKILL.md",
          content: "# Later Draft\n",
        }),
      })
      assert.equal(laterDraftSave.status, 200)

      const secondVersionResponse = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Experiment B",
            description: "Alternative implementation",
            labels: ["实验"],
          }),
        },
      )
      assert.equal(secondVersionResponse.status, 201)
      const secondVersion = (await secondVersionResponse.json()) as {
        id: string
        name: string
        isOnline: boolean
      }
      assert.equal(secondVersion.name, "Experiment B")
      assert.equal(secondVersion.isOnline, false)

      const compareResponse = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}` +
          `/versions/compare?leftVersionId=${firstVersion.id}` +
          `&rightVersionId=${secondVersion.id}`,
      )
      assert.equal(compareResponse.status, 200)
      const comparison = (await compareResponse.json()) as {
        summary: { modified: number }
        entries: Array<{ relativePath: string; status: string }>
      }
      assert.equal(comparison.summary.modified, 1)
      assert.equal(comparison.entries.length, 1)
      assert.equal(comparison.entries[0]?.relativePath, "SKILL.md")
      assert.equal(comparison.entries[0]?.status, "MODIFIED")

      const duplicateName = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "v1" }),
        },
      )
      assert.equal(duplicateName.status, 409)

      await application.close()
      application = await buildApplication({ config, logger: false })
      const restartedAddress = await application.listen({
        host: "127.0.0.1",
        port: 0,
      })
      const persistedResponse = await fetch(
        `${restartedAddress}/api/skill-workspaces`,
      )
      assert.equal(persistedResponse.status, 200)
      const persistedWorkspaces = (await persistedResponse.json()) as Array<{
        id: string
        onlineVersion: { id: string } | null
        versionCount: number
        activeDraft: {
          id: string
          status: string
          workingCopy: { fileCount: number }
        }
      }>
      assert.equal(persistedWorkspaces.length, 4)
      const persistedFolder = persistedWorkspaces.find(
        (workspace) => workspace.id === folderBody.workspace.id,
      )
      assert.ok(persistedFolder)
      assert.equal(persistedFolder.onlineVersion, null)
      assert.equal(persistedFolder.versionCount, 0)
      assert.equal(
        persistedFolder.activeDraft.id,
        folderBody.workspace.activeDraft.id,
      )
      assert.equal(persistedFolder.activeDraft.status, "OPEN")
      assert.equal(persistedFolder.activeDraft.workingCopy.fileCount, 9)
    } finally {
      await application.close()
      await rm(dataRoot, { recursive: true, force: true })
    }
  },
)
