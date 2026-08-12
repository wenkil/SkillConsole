import { execFile } from "node:child_process"
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

import { DomainError } from "../../core/errors/domain-error.js"
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
import type { TestRunRuntimeCapabilitySnapshot } from "./test-run.domain.js"
import {
  containsPublicRuntimeLeakContent,
  sanitizeTestRunPublicValue,
} from "./test-run-public-safety.js"

const internalIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface RuntimeCapabilityRequirement {
  readonly capability: string
  readonly commands: readonly string[]
}

const runtimeCapabilityPatterns: readonly {
  readonly requirement: RuntimeCapabilityRequirement
  readonly pattern: RegExp
}[] = [
  {
    requirement: {
      capability: "Python",
      commands: ["python", "python3"],
    },
    pattern: /(?:\bpython(?:3)?\b|\.py(?:\b|["'`]))/i,
  },
  {
    requirement: {
      capability: "Pandoc",
      commands: ["pandoc"],
    },
    pattern: /\bpandoc\b/i,
  },
]

const sandboxRequirement: RuntimeCapabilityRequirement = {
  capability: "Command Sandbox",
  commands:
    process.platform === "win32"
      ? ["sdk-native-windows"]
      : process.platform === "darwin"
        ? ["sandbox-exec"]
        : ["bwrap"],
}

export function detectRuntimeCapabilityRequirements(
  textFiles: readonly string[],
): readonly RuntimeCapabilityRequirement[] {
  return runtimeCapabilityPatterns
    .filter(({ pattern }) => textFiles.some((content) => pattern.test(content)))
    .map(({ requirement }) => requirement)
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("where.exe", [command], { timeout: 5_000 }, (error) => {
        resolve(!error)
      })
      return
    }
    execFile(
      "sh",
      ["-lc", `command -v ${command}`],
      { timeout: 5_000 },
      (error) => resolve(!error),
    )
  })
}

function commandVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["--version"],
      { timeout: 5_000, windowsHide: true, maxBuffer: 16 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve(null)
          return
        }
        const firstLine = `${stdout}\n${stderr}`
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find(Boolean)
        resolve(
          firstLine
            ? String(
                sanitizeTestRunPublicValue(firstLine.slice(0, 160)),
              )
            : null,
        )
      },
    )
  })
}

function commandSucceeds(
  command: string,
  args: readonly string[],
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: 5_000, windowsHide: true, maxBuffer: 16 * 1024 },
      (error) => resolve(!error),
    )
  })
}

async function captureSandboxCapability(): Promise<
  TestRunRuntimeCapabilitySnapshot
> {
  if (process.platform === "win32") {
    return {
      capability: sandboxRequirement.capability,
      commands: [
        {
          name: "sdk-native-windows",
          available: true,
          version: "claude-agent-sdk-native-windows",
        },
      ],
    }
  }
  const command = process.platform === "darwin" ? "sandbox-exec" : "bwrap"
  const discovered = await commandExists(command)
  const functional = discovered
    ? await commandSucceeds(
        command,
        process.platform === "darwin"
          ? ["-p", "(version 1)(allow default)", "true"]
          : [
              "--ro-bind",
              "/",
              "/",
              "--dev-bind",
              "/dev",
              "/dev",
              "--proc",
              "/proc",
              "--",
              "true",
            ],
      )
    : false
  const version =
    discovered && process.platform !== "darwin"
      ? await commandVersion(command)
      : discovered
        ? "sandbox-exec"
        : null
  return {
    capability: sandboxRequirement.capability,
    commands: [
      resolveRuntimeCommandSnapshot(
        command,
        discovered && functional,
        version,
      ),
    ],
  }
}

export function resolveRuntimeCommandSnapshot(
  name: string,
  discovered: boolean,
  version: string | null,
): TestRunRuntimeCapabilitySnapshot["commands"][number] {
  const available = discovered && version !== null
  return {
    name,
    available,
    version: available ? version : null,
  }
}

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

export interface TestRunPreflightResult {
  readonly runtimeCapabilities: readonly TestRunRuntimeCapabilitySnapshot[]
  readonly missing: readonly RuntimeCapabilityRequirement[]
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
    installSkill: boolean,
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
      mkdir(path.join(workspace, "outputs", ".tmp"), {
        recursive: true,
      }),
      mkdir(path.join(grading, ".claude"), { recursive: true }),
      mkdir(path.join(grading, "outputs", ".tmp"), {
        recursive: true,
      }),
    ])

    try {
      if (installSkill) {
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

  async captureRuntimeCapabilities(): Promise<
    readonly TestRunRuntimeCapabilitySnapshot[]
  > {
    const supportedRequirements = runtimeCapabilityPatterns.map(
      ({ requirement }) => requirement,
    )
    const capabilities = await Promise.all(
      supportedRequirements.map(async (requirement) => {
        const commands = await Promise.all(
          requirement.commands.map(async (command) => {
            const discovered = await commandExists(command)
            const version = discovered
              ? await commandVersion(command)
              : null
            return resolveRuntimeCommandSnapshot(
              command,
              discovered,
              version,
            )
          }),
        )
        return {
          capability: requirement.capability,
          commands,
        }
      }),
    )
    return [...capabilities, await captureSandboxCapability()]
  }

  async assertRuntimeCapabilities(
    selection: FrozenTestRunSelection,
    runtimeCapabilities: readonly TestRunRuntimeCapabilitySnapshot[],
  ): Promise<TestRunPreflightResult> {
    const scanFacts = selection.skill.files.map((file) => file.relativePath)
    for (const file of selection.skill.files) {
      const filePath = this.snapshots.getSnapshotFilePath(
        selection.skill.snapshotId,
        file.relativePath,
      )
      await assertFileHash(filePath, file.sha256)
      if (file.contentKind === "text") {
        scanFacts.push(await readFile(filePath, "utf8"))
      }
    }

    const requirements = [
      ...detectRuntimeCapabilityRequirements(scanFacts),
      sandboxRequirement,
    ]
    return {
      runtimeCapabilities,
      missing: requirements.filter((requirement) => {
        const capability = runtimeCapabilities.find(
          (item) => item.capability === requirement.capability,
        )
        return !capability?.commands.some((command) => command.available)
      }),
    }
  }

  async preflightSelection(
    selection: FrozenTestRunSelection,
    runtimeCapabilities: readonly TestRunRuntimeCapabilitySnapshot[],
  ): Promise<TestRunPreflightResult> {
    const skillName = await readSkillName(
      this.snapshots.getSnapshotFilePath(
        selection.skill.snapshotId,
        "SKILL.md",
      ),
    )
    if (skillName !== selection.revision.skillName) {
      throw new DomainError({
        code: "TEST_RUN_SKILL_NAME_MISMATCH",
        message:
          "The selected Skill version name does not match the Evals revision target.",
        kind: "precondition_failed",
      })
    }
    for (const file of selection.files) {
      await assertFileHash(
        this.evals.getRevisionFilePath(
          selection.revision.suiteId,
          selection.revision.id,
          file.relativePath,
        ),
        file.sha256,
      )
    }
    return this.assertRuntimeCapabilities(selection, runtimeCapabilities)
  }

  async verifyImmutableInputs(
    runId: string,
    caseId: string,
    installSkill: boolean,
    selection: FrozenTestRunSelection,
    evalFiles: readonly string[],
  ): Promise<void> {
    const workspace = this.getWorkspacePath(runId, caseId)
    if (installSkill) {
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
    await rm(path.join(outputRoot, ".tmp"), {
      recursive: true,
      force: true,
    })
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
      if (containsPublicRuntimeLeakContent(content, sensitiveValues)) {
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
      rm(
        path.join(
          this.getWorkspacePath(runId, caseId),
          "outputs",
          ".tmp",
        ),
        { recursive: true, force: true },
      ),
      rm(
        path.join(
          this.getGradingPath(runId, caseId),
          "outputs",
          ".tmp",
        ),
        { recursive: true, force: true },
      ),
    ])
  }
}
