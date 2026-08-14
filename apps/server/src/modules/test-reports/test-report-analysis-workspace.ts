import path from "node:path"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class TestReportAnalysisWorkspace {
  private readonly root: string

  constructor(dataRoot: string) {
    this.root = path.resolve(dataRoot, "test-report-analyses")
  }

  async prepare(
    analysisId: string,
    inputFingerprint: string,
  ): Promise<{
    readonly locator: string
    readonly absolutePath: string
  }> {
    const locator = path.posix.join(
      "test-report-analyses",
      analysisId,
      "workspace",
    )
    const absolutePath = this.resolve(analysisId)
    await rm(path.dirname(absolutePath), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
    await mkdir(path.join(absolutePath, "outputs", ".tmp"), {
      recursive: true,
    })
    await writeFile(
      path.join(absolutePath, "analysis-input.sha256"),
      `${inputFingerprint}\n`,
      { encoding: "utf8", flag: "wx" },
    )
    return { locator, absolutePath }
  }

  async remove(analysisId: string): Promise<void> {
    await rm(path.dirname(this.resolve(analysisId)), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
  }

  async cleanupStale(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !uuidPattern.test(entry.name)) continue
      await rm(path.join(this.root, entry.name), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    }
  }

  private resolve(analysisId: string): string {
    if (!uuidPattern.test(analysisId)) {
      throw new Error("Analysis workspace identity is invalid.")
    }
    const absolutePath = path.resolve(
      this.root,
      analysisId,
      "workspace",
    )
    const relative = path.relative(this.root, absolutePath)
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Analysis workspace escaped the controlled root.")
    }
    return absolutePath
  }
}
