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

import { buildApplication } from "../src/app.js"
import { DomainError } from "../src/core/errors/domain-error.js"
import {
  closeDatabaseClient,
  createDatabaseClient,
} from "../src/infrastructure/database/client.js"
import { buildSnapshotManifest } from "../src/modules/skill-workspaces/snapshot-manifest.js"
import { LocalSnapshotStorage } from "../src/modules/skill-workspaces/snapshot-storage.js"
import {
  prepareRelativePaths,
  normalizeRelativePath,
} from "../src/modules/skill-workspaces/upload-validation.js"
import {
  classifySnapshotFile,
  MAX_TEXT_PREVIEW_BYTES,
  readTextPreview,
} from "../src/modules/skill-workspaces/version-browser.service.js"
import type { VersionFileRecord } from "../src/modules/skill-workspaces/version-browser.repository.js"

const limits = {
  maxFiles: 2_000,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxDirectoryDepth: 32,
  maxPathLength: 512,
  maxZipBytes: 100 * 1024 * 1024,
  maxZipCompressionRatio: 100,
} as const

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

test("classifies safe previews without treating binary or large text as inline content", () => {
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
      byteSize: MAX_TEXT_PREVIEW_BYTES + 1,
      mediaTypeHint: "text/plain",
      contentKind: "text",
    }),
    { previewKind: "text", previewable: false },
  )
})

test("returns explicit states for unsafe or corrupted Snapshot text reads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skillconsole-browser-"))
  const storage = new LocalSnapshotStorage(root)
  const snapshotId = randomUUID()
  await storage.initialize()

  function createRecord(
    relativePath: string,
    content: Buffer,
    overrides: Partial<VersionFileRecord["file"]> = {},
  ): VersionFileRecord {
    return {
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
  "creates durable single-file, folder, and ZIP V1 workbenches through the API",
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
      const single = await createWorkspace(
        "Single file Skill",
        "single_file",
        [{ name: "SKILL.md", content: "# Single\n", type: "text/markdown" }],
      )
      assert.equal(single.response.status, 201)
      const singleBody = (await single.response.json()) as {
        workspace: {
          id: string
          currentVersion: {
            isDefaultBaseline: boolean
            snapshot: { id: string }
          }
        }
        upload: { fileCount: number; manifestHash: string }
      }
      assert.equal(singleBody.upload.fileCount, 1)
      assert.equal(singleBody.workspace.currentVersion.isDefaultBaseline, true)

      const replayedSingle = await createWorkspace(
        "Single file Skill",
        "single_file",
        [{ name: "SKILL.md", content: "# Replayed request\n" }],
        single.operationId,
      )
      assert.equal(replayedSingle.response.status, 200)
      assert.equal(
        ((await replayedSingle.response.json()) as { replayed: boolean })
          .replayed,
        true,
      )

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
      ])
      assert.equal(folder.response.status, 201)
      const folderBody = (await folder.response.json()) as {
        workspace: {
          id: string
          currentVersion: {
            id: string
            snapshot: { id: string }
          }
        }
        upload: { fileCount: number; strippedRoot: string | null }
      }
      assert.equal(folderBody.upload.fileCount, 6)
      assert.equal(folderBody.upload.strippedRoot, "folder-skill")

      const versionsResponse = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/versions`,
      )
      assert.equal(versionsResponse.status, 200)
      const versions = (await versionsResponse.json()) as Array<{
        id: string
        versionNumber: number
        isCurrent: boolean
        isDefaultBaseline: boolean
        snapshot: { state: string; fileCount: number }
      }>
      assert.equal(versions.length, 1)
      assert.deepEqual(
        {
          id: versions[0]?.id,
          versionNumber: versions[0]?.versionNumber,
          isCurrent: versions[0]?.isCurrent,
          isDefaultBaseline: versions[0]?.isDefaultBaseline,
          state: versions[0]?.snapshot.state,
          fileCount: versions[0]?.snapshot.fileCount,
        },
        {
          id: folderBody.workspace.currentVersion.id,
          versionNumber: 1,
          isCurrent: true,
          isDefaultBaseline: true,
          state: "READY",
          fileCount: 6,
        },
      )

      const versionResponse = await fetch(
        `${address}/api/skill-workspaces/${folderBody.workspace.id}/versions/${folderBody.workspace.currentVersion.id}`,
      )
      assert.equal(versionResponse.status, 200)

      const filesBase =
        `${address}/api/skill-workspaces/${folderBody.workspace.id}` +
        `/versions/${folderBody.workspace.currentVersion.id}/files`
      const filesResponse = await fetch(filesBase)
      assert.equal(filesResponse.status, 200)
      const fileList = (await filesResponse.json()) as {
        snapshotId: string
        files: Array<{
          relativePath: string
          previewKind: string
          previewable: boolean
        }>
      }
      assert.equal(
        fileList.snapshotId,
        folderBody.workspace.currentVersion.snapshot.id,
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

      const crossWorkspaceVersionResponse = await fetch(
        `${address}/api/skill-workspaces/${singleBody.workspace.id}` +
          `/versions/${folderBody.workspace.currentVersion.id}`,
      )
      assert.equal(crossWorkspaceVersionResponse.status, 404)

      await writeFile(
        path.join(
          dataRoot,
          "snapshots",
          folderBody.workspace.currentVersion.snapshot.id,
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
      }
      assert.equal(operation.state, "FAILED")
      assert.equal(operation.workspaceId, null)

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

      const snapshotManifest = JSON.parse(
        await readFile(
          path.join(
            dataRoot,
            "snapshots",
            singleBody.workspace.currentVersion.snapshot.id,
            "manifest.json",
          ),
          "utf8",
        ),
      ) as { manifestHash: string }
      assert.equal(snapshotManifest.manifestHash, singleBody.upload.manifestHash)

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
      assert.equal(((await persistedResponse.json()) as unknown[]).length, 4)
    } finally {
      await application.close()
      await rm(dataRoot, { recursive: true, force: true })
    }
  },
)
