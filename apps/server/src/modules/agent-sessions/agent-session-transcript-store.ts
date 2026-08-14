import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  type FileHandle,
} from "node:fs/promises"
import path from "node:path"

import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk"

function parseJsonl(content: string): SessionStoreEntry[] {
  return content
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionStoreEntry)
}

export class AgentSessionTranscriptStore implements SessionStore {
  private readonly handles = new Map<string, FileHandle>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly seenUuids = new Map<string, Set<string>>()

  constructor(
    private readonly root: string,
    private readonly bindSdkSessionId: (sdkSessionId: string) => Promise<void>,
    private readonly onFailure: (error: unknown) => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(path.join(this.root, "subagents"), {
      recursive: true,
      mode: 0o700,
    })
    const handle = await open(this.mainPath(), "a", 0o600)
    await handle.close()
    await chmod(this.mainPath(), 0o600).catch(() => undefined)
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    try {
      await this.bindSdkSessionId(key.sessionId)
      const target = this.resolvePath(key.subpath)
      const previous = this.writes.get(target) ?? Promise.resolve()
      const next = previous.then(async () => {
        const seen = await this.getSeenUuids(target)
        const pendingUuids = new Set<string>()
        const accepted = entries.filter((entry) => {
          if (!entry.uuid) return true
          if (seen.has(entry.uuid) || pendingUuids.has(entry.uuid)) return false
          pendingUuids.add(entry.uuid)
          return true
        })
        if (accepted.length === 0) return
        const handle = await this.getHandle(target)
        await handle.write(
          accepted.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
          undefined,
          "utf8",
        )
        for (const uuid of pendingUuids) seen.add(uuid)
      })
      this.writes.set(target, next.catch(() => undefined))
      await next
    } catch (error) {
      await this.onFailure(error).catch(() => undefined)
      throw error
    }
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    await this.bindSdkSessionId(key.sessionId)
    const target = this.resolvePath(key.subpath)
    await this.flushPath(target)
    try {
      return parseJsonl(await readFile(target, "utf8"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  async listSubkeys(_key: {
    readonly projectKey: string
    readonly sessionId: string
  }): Promise<string[]> {
    const root = path.join(this.root, "subagents")
    try {
      const entries = await readdir(root, { recursive: true, withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => {
          const parentPath = "parentPath" in entry
            ? String(entry.parentPath)
            : root
          const relative = path.relative(root, path.join(parentPath, entry.name))
          return `subagents/${relative.split(path.sep).join("/")}`
        })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.writes.values())
    await Promise.all([...this.handles.values()].map((handle) => handle.sync()))
  }

  async close(): Promise<void> {
    await this.flush()
    const handles = [...this.handles.values()]
    this.handles.clear()
    await Promise.all(handles.map((handle) => handle.close()))
  }

  private mainPath(): string {
    return path.join(this.root, "main.jsonl")
  }

  private resolvePath(subpath: string | undefined): string {
    if (!subpath) return this.mainPath()
    const normalized = subpath.replaceAll("\\", "/")
    const relative = normalized.startsWith("subagents/")
      ? normalized.slice("subagents/".length)
      : normalized
    if (
      !relative ||
      path.posix.isAbsolute(relative) ||
      relative.split("/").some((segment) => segment === ".." || segment === "")
    ) {
      throw new Error("Claude SessionStore provided an unsafe subagent path.")
    }
    const target = path.resolve(this.root, "subagents", ...relative.split("/"))
    const allowedRoot = path.resolve(this.root, "subagents")
    if (!target.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("Claude SessionStore subagent path escaped its log root.")
    }
    return target
  }

  private async getHandle(target: string): Promise<FileHandle> {
    const existing = this.handles.get(target)
    if (existing) return existing
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    const handle = await open(target, "a", 0o600)
    this.handles.set(target, handle)
    await chmod(target, 0o600).catch(() => undefined)
    return handle
  }

  private async getSeenUuids(target: string): Promise<Set<string>> {
    const existing = this.seenUuids.get(target)
    if (existing) return existing
    let entries: SessionStoreEntry[] = []
    try {
      entries = parseJsonl(await readFile(target, "utf8"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const seen = new Set(entries.flatMap((entry) => entry.uuid ? [entry.uuid] : []))
    this.seenUuids.set(target, seen)
    return seen
  }

  private async flushPath(target: string): Promise<void> {
    await this.writes.get(target)
    await this.handles.get(target)?.sync()
  }
}
