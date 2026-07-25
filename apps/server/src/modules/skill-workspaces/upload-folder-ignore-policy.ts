import { readFile } from "node:fs/promises"

import { Type, type Static } from "typebox"
import { Check } from "typebox/value"

import { ConfigurationError } from "../../config/index.js"

const portableNamePattern = "^[^/\\\\]+$"
const portableSuffixPattern = "^\\.[^/\\\\]+$"

export const UploadFolderIgnorePolicySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    caseSensitive: Type.Boolean(),
    ignoredDirectoryNames: Type.Array(
      Type.String({
        minLength: 1,
        maxLength: 120,
        pattern: portableNamePattern,
      }),
      { maxItems: 100, uniqueItems: true },
    ),
    ignoredFileNames: Type.Array(
      Type.String({
        minLength: 1,
        maxLength: 255,
        pattern: portableNamePattern,
      }),
      { maxItems: 100, uniqueItems: true },
    ),
    ignoredFileSuffixes: Type.Array(
      Type.String({
        minLength: 2,
        maxLength: 40,
        pattern: portableSuffixPattern,
      }),
      { maxItems: 100, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
)

export type UploadFolderIgnorePolicy = Static<
  typeof UploadFolderIgnorePolicySchema
>

export async function loadUploadFolderIgnorePolicy(
  configPath: string,
): Promise<UploadFolderIgnorePolicy> {
  let source: string
  try {
    source = await readFile(configPath, "utf8")
  } catch (error) {
    throw new ConfigurationError([
      `Upload folder ignore configuration cannot be read: ${configPath}`,
    ], { cause: error })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new ConfigurationError([
      `Upload folder ignore configuration is not valid JSON: ${configPath}`,
    ], { cause: error })
  }

  if (!Check(UploadFolderIgnorePolicySchema, parsed)) {
    throw new ConfigurationError([
      `Upload folder ignore configuration does not match schema version 1: ${configPath}`,
    ])
  }

  return parsed
}

function comparable(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase()
}

export function createUploadFolderPathMatcher(
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

export function shouldIgnoreFolderPath(
  relativePath: string,
  policy: UploadFolderIgnorePolicy,
): boolean {
  return createUploadFolderPathMatcher(policy)(relativePath)
}
