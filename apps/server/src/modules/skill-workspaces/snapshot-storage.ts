import { createWriteStream } from "node:fs"
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform, type Readable } from "node:stream"

import type { SnapshotManifest } from "./snapshot-manifest.js"

function assertInternalId(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new Error("An internal storage identifier is invalid.")
  }
}

function assertWithinRoot(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return
  }

  throw new Error("A storage path escaped its controlled root.")
}

export interface StreamWriteResult {
  readonly byteSize: number
}

export class LocalSnapshotStorage {
  readonly dataRoot: string
  readonly snapshotsRoot: string
  readonly stagingRoot: string

  constructor(dataRoot: string) {
    this.dataRoot = path.resolve(dataRoot)
    this.snapshotsRoot = path.join(this.dataRoot, "snapshots")
    this.stagingRoot = path.join(this.dataRoot, "staging")
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.snapshotsRoot, { recursive: true }),
      mkdir(this.stagingRoot, { recursive: true }),
    ])
  }

  getOperationRoot(operationId: string): string {
    assertInternalId(operationId)
    const operationRoot = path.join(this.stagingRoot, operationId)
    assertWithinRoot(this.stagingRoot, operationRoot)
    return operationRoot
  }

  getIncomingPath(operationId: string, index: number): string {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error("An incoming file index is invalid.")
    }

    const incomingRoot = path.join(
      this.getOperationRoot(operationId),
      "incoming",
    )
    const incomingPath = path.join(incomingRoot, String(index))
    assertWithinRoot(incomingRoot, incomingPath)
    return incomingPath
  }

  getArchivePath(operationId: string): string {
    const operationRoot = this.getOperationRoot(operationId)
    const archivePath = path.join(operationRoot, "source.zip")
    assertWithinRoot(operationRoot, archivePath)
    return archivePath
  }

  async resetOperation(operationId: string): Promise<void> {
    const operationRoot = this.getOperationRoot(operationId)
    await rm(operationRoot, { recursive: true, force: true })
    await mkdir(path.join(operationRoot, "incoming"), { recursive: true })
  }

  async cleanupOperation(operationId: string): Promise<void> {
    await rm(this.getOperationRoot(operationId), {
      recursive: true,
      force: true,
    })
  }

  async writeIncomingStream(
    operationId: string,
    index: number,
    stream: Readable,
    maxBytes: number,
  ): Promise<StreamWriteResult> {
    const incomingPath = this.getIncomingPath(operationId, index)
    await mkdir(path.dirname(incomingPath), { recursive: true })
    let byteSize = 0

    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length
        if (byteSize > maxBytes) {
          callback(new Error("UPLOAD_STREAM_SIZE_LIMIT"))
          return
        }

        callback(null, chunk)
      },
    })

    try {
      await pipeline(
        stream,
        limiter,
        createWriteStream(incomingPath, { flags: "wx" }),
      )
    } catch (error) {
      await rm(incomingPath, { force: true })
      throw error
    }

    return { byteSize }
  }

  async writeArchiveStream(
    operationId: string,
    stream: Readable,
    maxBytes: number,
  ): Promise<StreamWriteResult> {
    const archivePath = this.getArchivePath(operationId)
    let byteSize = 0

    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length
        if (byteSize > maxBytes) {
          callback(new Error("UPLOAD_STREAM_SIZE_LIMIT"))
          return
        }

        callback(null, chunk)
      },
    })

    try {
      await pipeline(
        stream,
        limiter,
        createWriteStream(archivePath, { flags: "wx" }),
      )
    } catch (error) {
      await rm(archivePath, { force: true })
      throw error
    }

    return { byteSize }
  }

  async materializeFiles(
    operationId: string,
    files: readonly {
      readonly incomingPath: string
      readonly relativePath: string
    }[],
  ): Promise<string> {
    const operationRoot = this.getOperationRoot(operationId)
    const contentRoot = path.join(operationRoot, "content")
    await rm(contentRoot, { recursive: true, force: true })
    await mkdir(contentRoot, { recursive: true })

    for (const file of files) {
      const destination = path.join(
        contentRoot,
        ...file.relativePath.split("/"),
      )
      assertWithinRoot(contentRoot, destination)
      await mkdir(path.dirname(destination), { recursive: true })
      await rename(file.incomingPath, destination)
    }

    return contentRoot
  }

  async promoteSnapshot(
    operationId: string,
    snapshotId: string,
    manifest: SnapshotManifest,
  ): Promise<string> {
    assertInternalId(snapshotId)
    const operationRoot = this.getOperationRoot(operationId)
    const contentRoot = path.join(operationRoot, "content")
    const snapshotRoot = path.join(this.snapshotsRoot, snapshotId)
    assertWithinRoot(this.snapshotsRoot, snapshotRoot)

    await mkdir(snapshotRoot)
    try {
      await rename(contentRoot, path.join(snapshotRoot, "files"))
      await writeFile(
        path.join(snapshotRoot, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        },
      )
    } catch (error) {
      await rm(snapshotRoot, { recursive: true, force: true })
      throw error
    }

    return path.posix.join("snapshots", snapshotId)
  }

  async removeSnapshot(snapshotId: string): Promise<void> {
    assertInternalId(snapshotId)
    const snapshotRoot = path.join(this.snapshotsRoot, snapshotId)
    assertWithinRoot(this.snapshotsRoot, snapshotRoot)
    await rm(snapshotRoot, { recursive: true, force: true })
  }
}
