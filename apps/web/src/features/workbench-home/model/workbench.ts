export type SkillSourceKind = "single_file" | "folder" | "zip"

export interface SkillSnapshotSummary {
  id: string
  manifestHash: string
  fileCount: number
  totalBytes: number
}

export interface SkillVersionSummary {
  id: string
  versionNumber: number
  sourceType: SkillSourceKind
  sourceName: string
  publishedAt: string
  isDefaultBaseline: boolean
  snapshot: SkillSnapshotSummary
}

export interface SkillWorkspace {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  currentVersion: SkillVersionSummary
}

export interface SelectedSkillSource {
  name: string
  files: File[]
  fileCount: number
  totalBytes: number
  maxDepth: number
}

export interface CreateWorkbenchDraft {
  name: string
  sourceKind: SkillSourceKind
  source: SelectedSkillSource | null
}

export interface CreateWorkbenchErrors {
  name?: "nameRequired" | undefined
  source?:
    | "sourceRequired"
    | "singleFileRequired"
    | "folderSelectionRequired"
    | "zipRequired"
    | undefined
  upload?: string | undefined
}

export interface RuntimeDefaults {
  endpointUrl: string
  apiKey: string
  modelId: string
}

export interface CreateSkillWorkspaceResponse {
  workspace: SkillWorkspace
  upload: {
    operationId: string
    fileCount: number
    totalBytes: number
    ignoredFileCount: number
    strippedRoot: string | null
    manifestHash: string
  }
  replayed: boolean
}

export class SourceSelectionError extends Error {
  readonly code: NonNullable<CreateWorkbenchErrors["source"]>

  constructor(code: NonNullable<CreateWorkbenchErrors["source"]>) {
    super(code)
    this.name = "SourceSelectionError"
    this.code = code
  }
}

export function createEmptyWorkbenchDraft(): CreateWorkbenchDraft {
  return {
    name: "",
    sourceKind: "single_file",
    source: null,
  }
}

export function createEmptyRuntimeDefaults(): RuntimeDefaults {
  return {
    endpointUrl: "",
    apiKey: "",
    modelId: "",
  }
}

function getFolderRelativePath(file: File): string {
  return file.webkitRelativePath || file.name
}

export function createSelectedSkillSource(
  sourceKind: SkillSourceKind,
  files: readonly File[],
): SelectedSkillSource {
  if (files.length === 0) {
    throw new SourceSelectionError("sourceRequired")
  }

  if (sourceKind === "single_file" && files.length !== 1) {
    throw new SourceSelectionError("singleFileRequired")
  }

  if (
    sourceKind === "zip" &&
    (files.length !== 1 || !files[0]?.name.toLowerCase().endsWith(".zip"))
  ) {
    throw new SourceSelectionError("zipRequired")
  }

  if (
    sourceKind === "folder" &&
    files.some((file) => !file.webkitRelativePath)
  ) {
    throw new SourceSelectionError("folderSelectionRequired")
  }

  const paths = files.map((file) => getFolderRelativePath(file))
  const firstPath = paths[0] ?? files[0]?.name ?? ""
  const name =
    sourceKind === "folder"
      ? (firstPath.split("/")[0] ?? firstPath)
      : (files[0]?.name ?? firstPath)

  return {
    name,
    files: [...files],
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    maxDepth: Math.max(
      ...paths.map((path) => Math.max(path.split("/").length - 1, 0)),
    ),
  }
}

export function validateWorkbenchDraft(
  draft: CreateWorkbenchDraft,
): CreateWorkbenchErrors {
  const errors: CreateWorkbenchErrors = {}

  if (!draft.name.trim()) {
    errors.name = "nameRequired"
  }

  if (!draft.source) {
    errors.source = "sourceRequired"
  }

  return errors
}

export function getUploadPath(
  sourceKind: SkillSourceKind,
  file: File,
): string {
  return sourceKind === "folder"
    ? file.webkitRelativePath || file.name
    : file.name
}
