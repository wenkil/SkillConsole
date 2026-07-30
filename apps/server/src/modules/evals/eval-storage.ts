import { mkdir } from "node:fs/promises"
import path from "node:path"

const internalIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertInternalId(id: string): void {
  if (!internalIdPattern.test(id)) {
    throw new Error("An internal Evals storage identifier is invalid.")
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
  throw new Error("An Evals storage path escaped its controlled root.")
}

export function assertEvalRelativePath(relativePath: string): void {
  const segments = relativePath.split("/")
  if (
    !relativePath ||
    relativePath.length > 512 ||
    relativePath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(relativePath) ||
    /^[a-zA-Z]:/.test(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error("An Evals relative path is invalid.")
  }
}

export class EvalStorage {
  readonly dataRoot: string
  readonly generationsRoot: string
  readonly suitesRoot: string

  constructor(dataRoot: string) {
    this.dataRoot = path.resolve(dataRoot)
    this.generationsRoot = path.join(this.dataRoot, "eval-generations")
    this.suitesRoot = path.join(this.dataRoot, "eval-suites")
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.generationsRoot, { recursive: true }),
      mkdir(this.suitesRoot, { recursive: true }),
    ])
  }

  getGenerationRoot(generationId: string): string {
    assertInternalId(generationId)
    const generationRoot = path.join(this.generationsRoot, generationId)
    assertWithinRoot(this.generationsRoot, generationRoot)
    return generationRoot
  }

  getGenerationWorkspaceLocator(generationId: string): string {
    assertInternalId(generationId)
    return path.posix.join(
      "eval-generations",
      generationId,
      "workspace",
    )
  }

  getGenerationWorkspacePath(generationId: string): string {
    const workspace = path.join(
      this.getGenerationRoot(generationId),
      "workspace",
    )
    assertWithinRoot(this.generationsRoot, workspace)
    return workspace
  }

  resolveGenerationWorkspaceLocator(locator: string): string {
    const segments = locator.split("/")
    if (
      segments.length !== 3 ||
      segments[0] !== "eval-generations" ||
      segments[2] !== "workspace"
    ) {
      throw new Error("An Evals workspace locator is invalid.")
    }
    const generationId = segments[1]
    if (!generationId) {
      throw new Error("An Evals workspace locator is invalid.")
    }
    const expectedLocator = this.getGenerationWorkspaceLocator(generationId)
    if (locator !== expectedLocator) {
      throw new Error("An Evals workspace locator is invalid.")
    }
    return this.getGenerationWorkspacePath(generationId)
  }

  getGenerationOutputPath(generationId: string): string {
    const output = path.join(
      this.getGenerationWorkspacePath(generationId),
      "output",
    )
    assertWithinRoot(this.generationsRoot, output)
    return output
  }

  getGenerationOutputLocator(generationId: string): string {
    assertInternalId(generationId)
    return path.posix.join(
      this.getGenerationWorkspaceLocator(generationId),
      "output",
    )
  }

  getGenerationEvalsJsonPath(generationId: string): string {
    return path.join(this.getGenerationOutputPath(generationId), "evals.json")
  }

  getGenerationFilesPath(generationId: string): string {
    return path.join(this.getGenerationOutputPath(generationId), "files")
  }

  getGenerationFilePath(
    generationId: string,
    relativePath: string,
  ): string {
    assertEvalRelativePath(relativePath)
    if (!relativePath.startsWith("files/")) {
      throw new Error("An Evals generated file must be under files/.")
    }
    const outputRoot = this.getGenerationOutputPath(generationId)
    const target = path.join(outputRoot, ...relativePath.split("/"))
    assertWithinRoot(outputRoot, target)
    return target
  }

  getRevisionRoot(suiteId: string, revisionId: string): string {
    assertInternalId(suiteId)
    assertInternalId(revisionId)
    const revisionRoot = path.join(
      this.suitesRoot,
      suiteId,
      "revisions",
      revisionId,
    )
    assertWithinRoot(this.suitesRoot, revisionRoot)
    return revisionRoot
  }

  getRevisionTemporaryRoot(
    suiteId: string,
    revisionId: string,
  ): string {
    assertInternalId(suiteId)
    assertInternalId(revisionId)
    const temporaryRoot = path.join(
      this.suitesRoot,
      suiteId,
      "revisions",
      `${revisionId}.publishing`,
    )
    assertWithinRoot(this.suitesRoot, temporaryRoot)
    return temporaryRoot
  }

  getRevisionLocator(suiteId: string, revisionId: string): string {
    assertInternalId(suiteId)
    assertInternalId(revisionId)
    return path.posix.join(
      "eval-suites",
      suiteId,
      "revisions",
      revisionId,
    )
  }

  getRevisionFilePath(
    suiteId: string,
    revisionId: string,
    relativePath: string,
  ): string {
    assertEvalRelativePath(relativePath)
    const revisionRoot = this.getRevisionRoot(suiteId, revisionId)
    const target = path.join(revisionRoot, ...relativePath.split("/"))
    assertWithinRoot(revisionRoot, target)
    return target
  }
}
