import { DomainError } from "../../core/errors/domain-error.js"

import type { UploadLimits } from "../../config/index.js"
import type { SkillSourceType } from "../../infrastructure/database/index.js"
import {
  createUploadFolderPathMatcher,
  type UploadFolderIgnorePolicy,
} from "./upload-folder-ignore-policy.js"

const windowsReservedNamePattern =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const invalidWindowsCharacterPattern = /[<>:"|?*]/
const controlCharacterPattern = /[\u0000-\u001f\u007f]/
const windowsDrivePattern = /^[a-zA-Z]:/

export interface PreparedRelativePath {
  readonly inputIndex: number
  readonly originalPath: string
  readonly relativePath: string
}

export interface PreparedRelativePaths {
  readonly files: readonly PreparedRelativePath[]
  readonly ignoredCount: number
  readonly strippedRoot: string | null
}

export function uploadValidationError(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError {
  return new DomainError({
    code,
    message,
    kind: "validation",
    ...(details ? { details } : {}),
  })
}

function validateSegment(segment: string, originalPath: string): void {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    controlCharacterPattern.test(segment) ||
    invalidWindowsCharacterPattern.test(segment) ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    windowsReservedNamePattern.test(segment)
  ) {
    throw uploadValidationError(
      "UPLOAD_PATH_INVALID",
      "A selected file has a path that cannot be stored safely.",
      { path: originalPath },
    )
  }
}

export function normalizeRelativePath(
  input: string,
  limits: UploadLimits,
): string {
  const normalized = input.normalize("NFC")

  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    normalized.includes("\\") ||
    windowsDrivePattern.test(normalized)
  ) {
    throw uploadValidationError(
      "UPLOAD_PATH_INVALID",
      "A selected file has an absolute or unsupported path.",
      { path: input },
    )
  }

  const segments = normalized.split("/")
  for (const segment of segments) {
    validateSegment(segment, input)
  }

  if (segments.length > limits.maxDirectoryDepth) {
    throw uploadValidationError(
      "UPLOAD_DIRECTORY_TOO_DEEP",
      "A selected file exceeds the maximum directory depth.",
      {
        path: input,
        limit: limits.maxDirectoryDepth,
      },
    )
  }

  const result = segments.join("/")
  if (result.length > limits.maxPathLength) {
    throw uploadValidationError(
      "UPLOAD_PATH_TOO_LONG",
      "A selected file path is too long.",
      {
        path: input,
        limit: limits.maxPathLength,
      },
    )
  }

  return result
}

function isGitMetadataPath(path: string): boolean {
  return path.split("/").some((segment) => segment.toLowerCase() === ".git")
}

function findStrippableRoot(
  paths: readonly string[],
  sourceType: SkillSourceType,
): string | null {
  if (sourceType === "single_file" || paths.length === 0) return null

  const firstSegments = paths.map((path) => path.split("/")[0])
  const root = firstSegments[0]
  const allShareRoot = firstSegments.every((segment) => segment === root)
  const allHaveNestedPath = paths.every((path) => path.includes("/"))

  if (!root || !allShareRoot || !allHaveNestedPath) {
    if (sourceType === "folder") {
      throw uploadValidationError(
        "UPLOAD_FOLDER_ROOT_INVALID",
        "The selected folder does not contain one consistent root directory.",
      )
    }

    return null
  }

  return root
}

export function prepareRelativePaths(
  originalPaths: readonly string[],
  sourceType: SkillSourceType,
  limits: UploadLimits,
  folderIgnorePolicy?: UploadFolderIgnorePolicy,
): PreparedRelativePaths {
  if (originalPaths.length === 0) {
    throw uploadValidationError(
      "UPLOAD_SOURCE_EMPTY",
      "The selected Skill source does not contain any files.",
    )
  }

  if (originalPaths.length > limits.maxFiles) {
    throw uploadValidationError(
      "UPLOAD_FILE_COUNT_EXCEEDED",
      "The selected Skill source contains too many files.",
      { limit: limits.maxFiles },
    )
  }

  const normalizedPaths = originalPaths.map((path) =>
    normalizeRelativePath(path, limits),
  )
  const strippedRoot = findStrippableRoot(normalizedPaths, sourceType)
  const seenCaseFoldedPaths = new Map<string, string>()
  const files: PreparedRelativePath[] = []
  const shouldIgnoreConfiguredPath =
    sourceType === "folder" && folderIgnorePolicy
      ? createUploadFolderPathMatcher(folderIgnorePolicy)
      : null
  let ignoredCount = 0

  normalizedPaths.forEach((normalizedPath, inputIndex) => {
    const relativePath = strippedRoot
      ? normalizedPath.slice(strippedRoot.length + 1)
      : normalizedPath
    const validatedPath = normalizeRelativePath(relativePath, limits)

    if (
      isGitMetadataPath(validatedPath) ||
      shouldIgnoreConfiguredPath?.(validatedPath)
    ) {
      ignoredCount += 1
      return
    }

    const caseFoldedPath = validatedPath.toLowerCase()
    const conflictingPath = seenCaseFoldedPaths.get(caseFoldedPath)
    if (conflictingPath) {
      throw uploadValidationError(
        "UPLOAD_PATH_CASE_CONFLICT",
        "Two selected files differ only by letter case.",
        {
          firstPath: conflictingPath,
          secondPath: validatedPath,
        },
      )
    }

    seenCaseFoldedPaths.set(caseFoldedPath, validatedPath)
    files.push({
      inputIndex,
      originalPath: originalPaths[inputIndex] ?? normalizedPath,
      relativePath: validatedPath,
    })
  })

  if (files.length === 0) {
    throw uploadValidationError(
      "UPLOAD_SOURCE_EMPTY",
      "The selected Skill source contains no files after protected metadata is excluded.",
    )
  }

  return {
    files,
    ignoredCount,
    strippedRoot,
  }
}

export function validateOperationId(operationId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      operationId,
    )
  ) {
    throw uploadValidationError(
      "UPLOAD_OPERATION_ID_INVALID",
      "The upload operation identifier is invalid.",
    )
  }

  return operationId.toLowerCase()
}

export function validateWorkspaceName(name: string): string {
  const normalizedName = name.trim()
  if (normalizedName.length < 1 || normalizedName.length > 120) {
    throw uploadValidationError(
      "WORKSPACE_NAME_INVALID",
      "The workbench name must contain between 1 and 120 characters.",
    )
  }

  return normalizedName
}

export function validateSourceType(value: string): SkillSourceType {
  if (value === "single_file" || value === "folder" || value === "zip") {
    return value
  }

  throw uploadValidationError(
    "UPLOAD_SOURCE_TYPE_INVALID",
    "The selected Skill source type is invalid.",
  )
}
