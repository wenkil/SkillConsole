import { createHash } from "node:crypto"
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  rm,
} from "node:fs/promises"
import path from "node:path"

import type { UploadLimits } from "../../config/index.js"
import { EvalStorage, assertEvalRelativePath } from "../evals/eval-storage.js"
import { LocalSnapshotStorage } from "../skill-workspaces/snapshot-storage.js"
import {
  buildSnapshotManifest,
  type CandidateFile,
  type SnapshotManifestFile,
} from "../skill-workspaces/snapshot-manifest.js"
import { readSkillName } from "../skill-workspaces/skill-metadata.js"
import type { FrozenTestRunSelection } from "./test-run.repository.js"

const internalIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertInternalId(id: string): void {
  if (!internalIdPattern.test(id)) {
    throw new Error("An internal test run identifier is invalid.")
  }
}

function assertWithinRoot(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return
  }
  throw new Error("A test run path escaped its controlled root.")
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

function containsSensitiveValue(
  content: Buffer,
  sensitiveValues: readonly string[],
): boolean {
  const contentText = content.toString("utf8")
  return sensitiveValues.some((value) => {
    if (value.length < 4) return false
    const variants = new Set([
      value,
      value.replaceAll("\\", "/"),
      value.replaceAll("/", "\\"),
    ])
    if (
      [...variants].some((variant) =>
        content.includes(Buffer.from(variant, "utf8")),
      )
    ) {
      return true
    }
    return /^[a-zA-Z]:[\\/]/.test(value)
      ? [...variants].some((variant) =>
          contentText.toLowerCase().includes(variant.toLowerCase()),
        )
      : false
  })
}

async function assertFileHash(
  filePath: string,
  expectedHash: string,
): Promise<void> {
  const actual = sha256(await readFile(filePath))
  if (actual !== expectedHash) {
    throw new Error("An immutable test run input failed its Hash check.")
  }
}

async function listRegularFiles(
  root: string,
  current = root,
): Promise<CandidateFile[]> {
  const files: CandidateFile[] = []
  const directory = await opendir(current)
  for await (const entry of directory) {
    const absolutePath = path.join(current, entry.name)
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) {
      throw new Error("A test run output cannot contain symbolic links.")
    }
    if (metadata.isDirectory()) {
      files.push(...(await listRegularFiles(root, absolutePath)))
      continue
    }
    if (!metadata.isFile()) {
      throw new Error("A test run output contains an unsupported entry.")
    }
    const relativePath = path
      .relative(root, absolutePath)
      .split(path.sep)
      .join("/")
    assertEvalRelativePath(relativePath)
    files.push({ incomingPath: absolutePath, relativePath })
  }
  return files
}

async function assertImmutableFileSet(
  root: string,
  expectedFiles: readonly {
    readonly relativePath: string
    readonly sha256: string
  }[],
): Promise<void> {
  const actualFiles = await listRegularFiles(root)
  const actualPaths = actualFiles
    .map((file) => file.relativePath)
    .sort((left, right) => left.localeCompare(right))
  const expectedPaths = expectedFiles
    .map((file) => file.relativePath)
    .sort((left, right) => left.localeCompare(right))
  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((value, index) => value !== expectedPaths[index])
  ) {
    throw new Error("An immutable test run input set changed during execution.")
  }
  for (const file of expectedFiles) {
    await assertFileHash(
      path.join(root, ...file.relativePath.split("/")),
      file.sha256,
    )
  }
}

export interface PreparedTestRunCaseWorkspace {
  readonly locator: string
  readonly absolutePath: string
  readonly gradingLocator: string
  readonly inputPaths: readonly string[]
}

export class TestRunStorage {
  readonly root: string
  private readonly snapshots: LocalSnapshotStorage
  private readonly evals: EvalStorage

  constructor(
    dataRoot: string,
    private readonly limits: UploadLimits,
  ) {
    this.root = path.resolve(dataRoot, "test-runs")
    this.snapshots = new LocalSnapshotStorage(dataRoot)
    this.evals = new EvalStorage(dataRoot)
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.root, { recursive: true }),
      this.snapshots.initialize(),
      this.evals.initialize(),
    ])
  }

  getCaseRoot(runId: string, caseId: string): string {
    assertInternalId(runId)
    assertInternalId(caseId)
    const caseRoot = path.join(this.root, runId, "cases", caseId)
    assertWithinRoot(this.root, caseRoot)
    return caseRoot
  }

  getWorkspaceLocator(runId: string, caseId: string): string {
    assertInternalId(runId)
    assertInternalId(caseId)
    return path.posix.join(
      "test-runs",
      runId,
      "cases",
      caseId,
      "workspace",
    )
  }

  getGradingLocator(runId: string, caseId: string): string {
    assertInternalId(runId)
    assertInternalId(caseId)
    return path.posix.join(
      "test-runs",
      runId,
      "cases",
      caseId,
      "grading",
    )
  }

  getWorkspacePath(runId: string, caseId: string): string {
    const workspace = path.join(this.getCaseRoot(runId, caseId), "workspace")
    assertWithinRoot(this.root, workspace)
    return workspace
  }

  getGradingPath(runId: string, caseId: string): string {
    const grading = path.join(this.getCaseRoot(runId, caseId), "grading")
    assertWithinRoot(this.root, grading)
    return grading
  }

  async prepareCase(
    runId: string,
    caseId: string,
    side: "TARGET" | "BASELINE",
    selection: FrozenTestRunSelection,
    evalFiles: readonly string[],
  ): Promise<PreparedTestRunCaseWorkspace> {
    const caseRoot = this.getCaseRoot(runId, caseId)
    const workspace = this.getWorkspacePath(runId, caseId)
    const grading = this.getGradingPath(runId, caseId)
    await rm(caseRoot, { recursive: true, force: true })
    await Promise.all([
      mkdir(path.join(workspace, ".claude"), { recursive: true }),
      mkdir(path.join(workspace, "inputs"), { recursive: true }),
      mkdir(path.join(workspace, "outputs"), { recursive: true }),
      mkdir(path.join(grading, ".claude"), { recursive: true }),
    ])

    try {
      if (side === "TARGET") {
        const skillRoot = path.join(
          workspace,
          ".claude",
          "skills",
          selection.revision.skillName,
        )
        for (const file of selection.skill.files) {
          const destination = path.join(
            skillRoot,
            ...file.relativePath.split("/"),
          )
          assertWithinRoot(skillRoot, destination)
          const source = this.snapshots.getSnapshotFilePath(
            selection.skill.snapshotId,
            file.relativePath,
          )
          await assertFileHash(source, file.sha256)
          await mkdir(path.dirname(destination), { recursive: true })
          await copyFile(source, destination)
          await assertFileHash(destination, file.sha256)
          await chmod(destination, 0o444)
        }
        const actualSkillName = await readSkillName(
          path.join(skillRoot, "SKILL.md"),
        )
        if (actualSkillName !== selection.revision.skillName) {
          throw new Error(
            "The selected Skill version name does not match the Evals revision target.",
          )
        }
      }

      const indexedFiles = new Map(
        selection.files.map((file) => [file.relativePath, file]),
      )
      const inputPaths: string[] = []
      for (const relativePath of evalFiles) {
        const file = indexedFiles.get(relativePath)
        if (!file) {
          throw new Error("An Evals input is missing from its file index.")
        }
        const source = this.evals.getRevisionFilePath(
          selection.revision.suiteId,
          selection.revision.id,
          relativePath,
        )
        const destination = path.join(
          workspace,
          "inputs",
          ...relativePath.split("/"),
        )
        assertWithinRoot(path.join(workspace, "inputs"), destination)
        await assertFileHash(source, file.sha256)
        await mkdir(path.dirname(destination), { recursive: true })
        await copyFile(source, destination)
        await assertFileHash(destination, file.sha256)
        await chmod(destination, 0o444)
        inputPaths.push(
          path.posix.join("inputs", relativePath),
        )
      }

      return {
        locator: this.getWorkspaceLocator(runId, caseId),
        absolutePath: workspace,
        gradingLocator: this.getGradingLocator(runId, caseId),
        inputPaths,
      }
    } catch (error) {
      await rm(caseRoot, { recursive: true, force: true })
      throw error
    }
  }

  async verifyImmutableInputs(
    runId: string,
    caseId: string,
    side: "TARGET" | "BASELINE",
    selection: FrozenTestRunSelection,
    evalFiles: readonly string[],
  ): Promise<void> {
    const workspace = this.getWorkspacePath(runId, caseId)
    if (side === "TARGET") {
      const skillRoot = path.join(
        workspace,
        ".claude",
        "skills",
        selection.revision.skillName,
      )
      await assertImmutableFileSet(skillRoot, selection.skill.files)
    }
    const indexedFiles = new Map(
      selection.files.map((file) => [file.relativePath, file]),
    )
    const expectedInputs = []
    for (const relativePath of evalFiles) {
      const file = indexedFiles.get(relativePath)
      if (!file) {
        throw new Error("An Evals input is missing from its file index.")
      }
      expectedInputs.push(file)
    }
    await assertImmutableFileSet(
      path.join(workspace, "inputs"),
      expectedInputs,
    )
  }

  async collectArtifacts(
    runId: string,
    caseId: string,
  ): Promise<readonly SnapshotManifestFile[]> {
    const outputRoot = path.join(
      this.getWorkspacePath(runId, caseId),
      "outputs",
    )
    const candidates = await listRegularFiles(outputRoot)
    if (candidates.length > this.limits.maxFiles) {
      throw new Error("The test run produced too many Artifact files.")
    }
    return (await buildSnapshotManifest(candidates, this.limits)).files
  }

  async assertArtifactsSafe(
    runId: string,
    caseId: string,
    artifacts: readonly SnapshotManifestFile[],
    sensitiveValues: readonly string[],
  ): Promise<void> {
    for (const artifact of artifacts) {
      const content = await readFile(
        this.getArtifactPath(runId, caseId, artifact.relativePath),
      )
      if (containsSensitiveValue(content, sensitiveValues)) {
        const outputRoot = path.join(
          this.getWorkspacePath(runId, caseId),
          "outputs",
        )
        await rm(outputRoot, { recursive: true, force: true })
        await mkdir(outputRoot, { recursive: true })
        throw new Error(
          "A test run Artifact contains protected configuration or runtime paths.",
        )
      }
    }
  }

  getArtifactLocator(
    runId: string,
    caseId: string,
    relativePath: string,
  ): string {
    assertInternalId(runId)
    assertInternalId(caseId)
    assertEvalRelativePath(relativePath)
    return path.posix.join(
      this.getWorkspaceLocator(runId, caseId),
      "outputs",
      relativePath,
    )
  }

  getArtifactPath(
    runId: string,
    caseId: string,
    relativePath: string,
  ): string {
    assertEvalRelativePath(relativePath)
    const outputRoot = path.join(
      this.getWorkspacePath(runId, caseId),
      "outputs",
    )
    const target = path.join(outputRoot, ...relativePath.split("/"))
    assertWithinRoot(outputRoot, target)
    return target
  }

  async readTextArtifactEvidence(
    runId: string,
    caseId: string,
    artifacts: readonly SnapshotManifestFile[],
  ): Promise<readonly {
    readonly relativePath: string
    readonly sha256: string
    readonly content: string | null
  }[]> {
    let remaining = 100_000
    const evidence = []
    for (const artifact of artifacts) {
      let content: string | null = null
      if (artifact.contentKind === "text" && remaining > 0) {
        const bytes = await readFile(
          this.getArtifactPath(runId, caseId, artifact.relativePath),
        )
        const excerpt = bytes.subarray(
          0,
          Math.min(bytes.length, 20_000, remaining),
        )
        content = new TextDecoder("utf-8", { fatal: false }).decode(excerpt)
        remaining -= excerpt.length
      }
      evidence.push({
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
        content,
      })
    }
    return evidence
  }

  async scrubSettings(runId: string, caseId: string): Promise<void> {
    await Promise.all([
      rm(
        path.join(
          this.getWorkspacePath(runId, caseId),
          ".claude",
          "settings.json",
        ),
        { force: true },
      ),
      rm(
        path.join(
          this.getGradingPath(runId, caseId),
          ".claude",
          "settings.json",
        ),
        { force: true },
      ),
    ])
  }
}
