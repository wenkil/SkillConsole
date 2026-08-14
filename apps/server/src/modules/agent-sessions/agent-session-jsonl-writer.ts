import { chmod, mkdir, open, type FileHandle } from "node:fs/promises"
import path from "node:path"

export class AgentSessionJsonlWriter {
  private handle: FileHandle | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const handle = await open(this.filePath, "a", 0o600)
    await handle.close()
    await chmod(this.filePath, 0o600).catch(() => undefined)
  }

  append(value: unknown): Promise<void> {
    const serialized = `${JSON.stringify(value)}\n`
    const next = this.pending.then(async () => {
      const handle = await this.getHandle()
      await handle.write(serialized, undefined, "utf8")
    })
    this.pending = next.catch(() => undefined)
    return next
  }

  async flush(): Promise<void> {
    await this.pending
    if (this.handle) await this.handle.sync()
  }

  async close(): Promise<void> {
    await this.flush()
    const handle = this.handle
    this.handle = null
    if (handle) await handle.close()
  }

  private async getHandle(): Promise<FileHandle> {
    if (!this.handle) {
      this.handle = await open(this.filePath, "a", 0o600)
    }
    return this.handle
  }
}
