export type SkillSourceKind = "single_file" | "folder" | "zip"
export type CreateSkillSourceKind = Exclude<
  SkillSourceKind,
  "single_file"
>

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
  ignoredFileCount: number
  totalBytes: number
  maxDepth: number
}

export interface UploadFolderIgnorePolicy {
  schemaVersion: 1
  caseSensitive: boolean
  ignoredDirectoryNames: string[]
  ignoredFileNames: string[]
  ignoredFileSuffixes: string[]
}

export interface CreateWorkbenchDraft {
  name: string
  sourceKind: CreateSkillSourceKind
  source: SelectedSkillSource | null
}

export interface CreateWorkbenchErrors {
  name?: "nameRequired" | undefined
  source?:
    | "sourceRequired"
    | "folderSelectionRequired"
    | "folderPolicyUnavailable"
    | "folderFilesIgnored"
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
    sourceKind: "folder",
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

function stripSelectedFolderRoot(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/")
  const rootSeparator = normalizedPath.indexOf("/")
  return rootSeparator >= 0
    ? normalizedPath.slice(rootSeparator + 1)
    : normalizedPath
}

function comparable(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase()
}

function createUploadFolderPathMatcher(
  policy: UploadFolderIgnorePolicy,
): (path: string) => boolean {
  const normalize = (value: string) =>
    comparable(value, policy.caseSensitive)
  const ignoredDirectoryNames = new Set(
    policy.ignoredDirectoryNames.map(normalize),
  )
  const ignoredFileNames = new Set(policy.ignoredFileNames.map(normalize))
  const ignoredFileSuffixes = policy.ignoredFileSuffixes.map(normalize)

  return (path: string): boolean => {
    const segments = path.replaceAll("\\", "/").split("/")
    const fileName = segments.at(-1) ?? ""
    const directoryNames = segments.slice(0, -1)
    const comparableFileName = normalize(fileName)

    return (
      directoryNames.some((name) =>
        ignoredDirectoryNames.has(normalize(name)),
      ) ||
      ignoredFileNames.has(comparableFileName) ||
      ignoredFileSuffixes.some((suffix) =>
        comparableFileName.endsWith(suffix),
      )
    )
  }
}

export function createSelectedSkillSource(
  sourceKind: CreateSkillSourceKind,
  files: readonly File[],
  folderIgnorePolicy?: UploadFolderIgnorePolicy,
): SelectedSkillSource {
  if (files.length === 0) {
    throw new SourceSelectionError("sourceRequired")
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

  if (sourceKind === "folder" && !folderIgnorePolicy) {
    throw new SourceSelectionError("folderPolicyUnavailable")
  }

  const shouldIgnorePath = folderIgnorePolicy
    ? createUploadFolderPathMatcher(folderIgnorePolicy)
    : null
  const selectedFiles =
    sourceKind === "folder" && shouldIgnorePath
      ? files.filter(
          (file) =>
            !shouldIgnorePath(
              stripSelectedFolderRoot(getFolderRelativePath(file)),
            ),
        )
      : [...files]

  if (selectedFiles.length === 0) {
    throw new SourceSelectionError("folderFilesIgnored")
  }

  const originalPaths = files.map((file) => getFolderRelativePath(file))
  const paths = selectedFiles.map((file) => getFolderRelativePath(file))
  const firstPath = originalPaths[0] ?? files[0]?.name ?? ""
  const name =
    sourceKind === "folder"
      ? (firstPath.split("/")[0] ?? firstPath)
      : (files[0]?.name ?? firstPath)

  return {
    name,
    files: selectedFiles,
    fileCount: selectedFiles.length,
    ignoredFileCount: files.length - selectedFiles.length,
    totalBytes: selectedFiles.reduce((total, file) => total + file.size, 0),
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
  sourceKind: CreateSkillSourceKind,
  file: File,
): string {
  return sourceKind === "folder"
    ? file.webkitRelativePath || file.name
    : file.name
}
