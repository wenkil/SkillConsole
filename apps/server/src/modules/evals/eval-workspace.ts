import { createHash } from "node:crypto"
import { constants } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { eq } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillSnapshotFiles,
  type Database,
} from "../../infrastructure/database/index.js"
import type { FrozenEvalTarget } from "../skill-workspaces/eval-target.domain.js"
import { LocalSnapshotStorage } from "../skill-workspaces/snapshot-storage.js"
import { EvalStorage } from "./eval-storage.js"

interface SkillCreatorManifestFile {
  readonly path: string
  readonly byteSize: number
  readonly sha256: string
}

interface SkillCreatorManifest {
  readonly sourceCommit: string
  readonly treeHash: string
  readonly fileCount: number
  readonly files: readonly SkillCreatorManifestFile[]
}

export interface EvalGenerationWorkspace {
  readonly locator: string
  readonly absolutePath: string
  readonly targetSkillPath: string
  readonly outputEvalsPath: string
  readonly outputFilesPath: string
  readonly taskPath: string
  readonly skillCreatorCommit: string
  readonly skillCreatorTreeHash: string
  readonly configurationFingerprint: string
}

export interface EvalGenerationProvenance {
  readonly skillCreatorCommit: string
  readonly skillCreatorTreeHash: string
  readonly configurationFingerprint: string
}

const resourcesRoot = fileURLToPath(
  new URL("../../../resources", import.meta.url),
)
const skillCreatorRoot = path.join(
  resourcesRoot,
  "skills",
  "skill-creator",
)
const skillCreatorManifestPath = path.join(
  resourcesRoot,
  "skills",
  "skill-creator.manifest.json",
)
export const pinnedSkillCreatorCommit =
  "b29e7cf65e5cb78a5ac33d582270551bc74a14eb"
export const pinnedSkillCreatorTreeHash =
  "82538987d2e399537643460f98c2fc7e4d6632ccd08d83f7c0c5a6c99759f0b5"

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

function evalGenerationTaskDocument(
  target: Pick<FrozenEvalTarget, "skillName">,
  taskInput: {
    readonly maxEvalCount: number
    readonly generationBrief: string | null
  },
): string {
  return `${JSON.stringify(
    {
      schemaVersion: "eval-generation-task.v1",
      skillName: target.skillName,
      maxEvalCount: taskInput.maxEvalCount,
      generationBrief:
        taskInput.generationBrief?.trim() ||
        "无补充要求。根据 Skill 的主要能力与关键边界设计用例。",
      targetSkillPath: path.posix.join("target-skill", target.skillName),
      skillCreatorPath: ".claude/skills/skill-creator",
      outputEvalsPath: "output/evals.json",
      outputFilesPath: "output/files",
    },
    null,
    2,
  )}\n`
}

async function listRegularFiles(
  root: string,
  current = root,
): Promise<string[]> {
  const relativePaths: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error("The bundled skill-creator contains a symbolic link.")
    }
    if (entry.isDirectory()) {
      relativePaths.push(...(await listRegularFiles(root, absolutePath)))
      continue
    }
    if (!entry.isFile()) {
      throw new Error("The bundled skill-creator contains a non-file entry.")
    }
    relativePaths.push(
      path.relative(root, absolutePath).split(path.sep).join("/"),
    )
  }
  return relativePaths.sort()
}

async function readVerifiedSkillCreatorManifest(): Promise<SkillCreatorManifest> {
  const manifest = JSON.parse(
    await readFile(skillCreatorManifestPath, "utf8"),
  ) as SkillCreatorManifest
  const calculatedTreeHash = sha256(
    [...manifest.files]
      .sort((left, right) => {
        const leftKey = left.path.toLocaleLowerCase("en-US")
        const rightKey = right.path.toLocaleLowerCase("en-US")
        if (leftKey < rightKey) return -1
        if (leftKey > rightKey) return 1
        return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      })
      .map(
        (file) =>
          `${file.path}\t${file.byteSize}\t${file.sha256}\n`,
      )
      .join(""),
  )
  if (
    manifest.sourceCommit !== pinnedSkillCreatorCommit ||
    manifest.treeHash !== pinnedSkillCreatorTreeHash ||
    calculatedTreeHash !== pinnedSkillCreatorTreeHash ||
    manifest.files.length !== manifest.fileCount
  ) {
    throw new Error("The bundled skill-creator manifest is invalid.")
  }

  const actualPaths = await listRegularFiles(skillCreatorRoot)
  const expectedPaths = manifest.files.map((file) => file.path).sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("The bundled skill-creator file set does not match.")
  }

  for (const file of manifest.files) {
    const content = await readFile(
      path.join(skillCreatorRoot, ...file.path.split("/")),
    )
    if (
      content.byteLength !== file.byteSize ||
      sha256(content) !== file.sha256
    ) {
      throw new Error(
        `The bundled skill-creator file is not authentic: ${file.path}`,
      )
    }
  }
  return manifest
}

async function copyFiles(
  sourceRoot: string,
  destinationRoot: string,
  files: readonly {
    readonly relativePath: string
    readonly byteSize: number
    readonly sha256: string
  }[],
): Promise<void> {
  for (const file of files) {
    const relativePath = file.relativePath
    const segments = relativePath.split("/")
    if (
      !relativePath ||
      relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      throw new Error("A controlled workspace source path is invalid.")
    }
    const source = path.join(sourceRoot, ...relativePath.split("/"))
    const sourceStat = await lstat(source)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error("A controlled workspace source is not a regular file.")
    }
    const destination = path.join(
      destinationRoot,
      ...relativePath.split("/"),
    )
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    const copied = await readFile(destination)
    if (
      copied.byteLength !== file.byteSize ||
      sha256(copied) !== file.sha256
    ) {
      throw new Error(
        `A controlled workspace copy failed verification: ${relativePath}`,
      )
    }
  }
}

async function verifyFiles(
  root: string,
  files: readonly {
    readonly relativePath: string
    readonly byteSize: number
    readonly sha256: string
  }[],
): Promise<void> {
  const actualPaths = await listRegularFiles(root)
  const expectedPaths = files
    .map((file) => file.relativePath)
    .sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("A controlled workspace input file set changed.")
  }
  for (const file of files) {
    const content = await readFile(
      path.join(root, ...file.relativePath.split("/")),
    )
    if (
      content.byteLength !== file.byteSize ||
      sha256(content) !== file.sha256
    ) {
      throw new Error(
        `A controlled workspace input changed: ${file.relativePath}`,
      )
    }
  }
}

export class EvalWorkspacePreparer {
  private readonly snapshotStorage: LocalSnapshotStorage

  constructor(
    private readonly database: Database,
    private readonly storage: EvalStorage,
    dataRoot: string,
    private readonly claudeSettingsPath: string,
  ) {
    this.snapshotStorage = new LocalSnapshotStorage(dataRoot)
  }

  async prepare(
    generationId: string,
    target: FrozenEvalTarget,
    expectedProvenance: EvalGenerationProvenance,
    taskInput: {
      readonly maxEvalCount: number
      readonly generationBrief: string | null
    },
  ): Promise<EvalGenerationWorkspace> {
    const manifest = await this.getVerifiedSkillCreatorManifest()
    const configurationFingerprint = sha256(
      await readFile(this.claudeSettingsPath),
    )
    if (
      manifest.sourceCommit !== expectedProvenance.skillCreatorCommit ||
      manifest.treeHash !== expectedProvenance.skillCreatorTreeHash ||
      configurationFingerprint !==
        expectedProvenance.configurationFingerprint
    ) {
      throw new DomainError({
        code: "EVAL_PROVENANCE_CHANGED",
        message:
          "The Evals generation dependencies changed during task preparation.",
        kind: "conflict",
      })
    }
    const generationRoot = this.storage.getGenerationRoot(generationId)
    const workspacePath =
      this.storage.getGenerationWorkspacePath(generationId)
    const targetSkillPath = path.join(
      workspacePath,
      "target-skill",
      target.skillName,
    )
    const skillCreatorDestination = path.join(
      workspacePath,
      ".claude",
      "skills",
      "skill-creator",
    )
    const outputFilesPath =
      this.storage.getGenerationFilesPath(generationId)
    try {
      await mkdir(generationRoot)
      await Promise.all([
        mkdir(targetSkillPath, { recursive: true }),
        mkdir(skillCreatorDestination, { recursive: true }),
        mkdir(outputFilesPath, { recursive: true }),
      ])

      const snapshotFiles = await this.database
        .select({
          relativePath: skillSnapshotFiles.relativePath,
          byteSize: skillSnapshotFiles.byteSize,
          sha256: skillSnapshotFiles.sha256,
        })
        .from(skillSnapshotFiles)
        .where(eq(skillSnapshotFiles.snapshotId, target.snapshotId))
        .orderBy(skillSnapshotFiles.relativePath)
      if (snapshotFiles.length !== target.fileCount) {
        throw new Error("The frozen Skill Snapshot file set is incomplete.")
      }
      await copyFiles(
        path.join(
          this.snapshotStorage.snapshotsRoot,
          target.snapshotId,
          "files",
        ),
        targetSkillPath,
        snapshotFiles,
      )
      await copyFiles(
        skillCreatorRoot,
        skillCreatorDestination,
        manifest.files.map((file) => ({
          relativePath: file.path,
          byteSize: file.byteSize,
          sha256: file.sha256,
        })),
      )
      const taskPath = path.join(workspacePath, "inputs", "task.json")
      await mkdir(path.dirname(taskPath), { recursive: true })
      await writeFile(
        taskPath,
        evalGenerationTaskDocument(target, taskInput),
        { encoding: "utf8", flag: "wx" },
      )

      return {
        locator:
          this.storage.getGenerationWorkspaceLocator(generationId),
        absolutePath: workspacePath,
        targetSkillPath,
        outputEvalsPath:
          this.storage.getGenerationEvalsJsonPath(generationId),
        outputFilesPath,
        taskPath,
        skillCreatorCommit: manifest.sourceCommit,
        skillCreatorTreeHash: manifest.treeHash,
        configurationFingerprint,
      }
    } catch (error) {
      await rm(generationRoot, { recursive: true, force: true }).catch(
        () => undefined,
      )
      throw new DomainError({
        code: "EVAL_WORKSPACE_PREPARATION_FAILED",
        message: "The controlled Evals generation workspace could not be prepared.",
        kind: "internal",
        cause: error,
      })
    }
  }

  async inspectProvenance(): Promise<EvalGenerationProvenance> {
    const manifest = await this.getVerifiedSkillCreatorManifest()
    return {
      skillCreatorCommit: manifest.sourceCommit,
      skillCreatorTreeHash: manifest.treeHash,
      configurationFingerprint: sha256(
        await readFile(this.claudeSettingsPath),
      ),
    }
  }

  async verifyImmutableInputs(
    generationId: string,
    target: {
      readonly snapshotId: string
      readonly skillName: string
      readonly maxEvalCount: number
      readonly generationBrief: string | null
    },
    expectedProvenance: EvalGenerationProvenance,
  ): Promise<void> {
    try {
      const manifest = await this.getVerifiedSkillCreatorManifest()
      if (
        manifest.sourceCommit !== expectedProvenance.skillCreatorCommit ||
        manifest.treeHash !== expectedProvenance.skillCreatorTreeHash
      ) {
        throw new Error("The bundled skill-creator provenance changed.")
      }
      const snapshotFiles = await this.database
        .select({
          relativePath: skillSnapshotFiles.relativePath,
          byteSize: skillSnapshotFiles.byteSize,
          sha256: skillSnapshotFiles.sha256,
        })
        .from(skillSnapshotFiles)
        .where(eq(skillSnapshotFiles.snapshotId, target.snapshotId))
        .orderBy(skillSnapshotFiles.relativePath)
      const workspace = this.storage.getGenerationWorkspacePath(generationId)
      await Promise.all([
        verifyFiles(
          path.join(workspace, "target-skill", target.skillName),
          snapshotFiles,
        ),
        verifyFiles(
          path.join(
            workspace,
            ".claude",
            "skills",
            "skill-creator",
          ),
          manifest.files.map((file) => ({
            relativePath: file.path,
            byteSize: file.byteSize,
            sha256: file.sha256,
          })),
        ),
      ])
      const expectedTask = evalGenerationTaskDocument(target, target)
      const actualTask = await readFile(
        path.join(workspace, "inputs", "task.json"),
      )
      if (sha256(actualTask) !== sha256(expectedTask)) {
        throw new Error("The Evals generation task manifest changed.")
      }
    } catch (error) {
      throw new DomainError({
        code: "EVAL_WORKSPACE_INPUT_CHANGED",
        message:
          "A controlled Evals generation input changed during execution.",
        kind: "validation",
        cause: error,
      })
    }
  }

  async scrubSettings(generationId: string): Promise<void> {
    await unlink(
      path.join(
        this.storage.getGenerationWorkspacePath(generationId),
        ".claude",
        "settings.json",
      ),
    ).catch(() => undefined)
  }

  private getVerifiedSkillCreatorManifest(): Promise<SkillCreatorManifest> {
    return readVerifiedSkillCreatorManifest()
  }
}
