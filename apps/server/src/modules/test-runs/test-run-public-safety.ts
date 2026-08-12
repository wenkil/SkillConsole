const quotedAbsolutePathPattern =
  /(["'])(?:(?:[A-Za-z]:[\\/])|(?:\\\\[^\\/\r\n]+[\\/][^\\/\r\n]+(?:[\\/])?)|\/)[^"'\r\n]*\1/giu
const quotedFileUrlPattern =
  /(["'])file:(?:\/{2,3}|\\\\)[^"'\r\n]*\1/giu
const unquotedFileUrlPattern =
  /\bfile:(?:\/{2,3}|\\\\)[^\s"'<>|,;})\]]*/giu
const unquotedAbsolutePathPattern =
  /(^|[\s("'=])(?:(?:[A-Za-z]:[\\/][^\s"'<>|,;})\]]*)|(?:\\\\[^\\/\s"'<>|]+[\\/][^\\/\s"'<>|]+(?:[\\/][^\s"'<>|,;})\]]*)?)|(?:\/[^\s"'<>|,;})\]]*))(?=$|[\s"'<>|,;})\]])/giu
const publicInternalReferencePattern = /\bnode:internal\/[^\s)"']+/giu
const publicStackReferencePattern =
  /\bat\s+(?:async\s+)?(?:[\w.$<>]+\s*\(\[REDACTED_PATH\]\)|\[REDACTED_PATH\])/giu

function decodeContentVariants(value: Buffer | Uint8Array): readonly string[] {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  const variants = [
    new TextDecoder("utf-8", { fatal: false }).decode(bytes),
  ]
  for (const encoding of ["utf-16le", "utf-16be"] as const) {
    variants.push(new TextDecoder(encoding, { fatal: false }).decode(bytes))
    if (bytes.byteLength > 1) {
      variants.push(
        new TextDecoder(encoding, { fatal: false }).decode(bytes.subarray(1)),
      )
    }
  }
  return [...new Set(variants)]
}

function containsSensitiveValue(
  decodedValues: readonly string[],
  sensitiveValues: readonly string[],
): boolean {
  return sensitiveValues.some((value) => {
    if (value.length < 4) return false
    const variants = new Set([
      value,
      value.replaceAll("\\", "/"),
      value.replaceAll("/", "\\"),
    ])
    return [...variants].some((variant) =>
      /^[a-zA-Z]:[\\/]/u.test(value)
        ? decodedValues.some((decoded) =>
            decoded.toLowerCase().includes(variant.toLowerCase()),
          )
        : decodedValues.some((decoded) => decoded.includes(variant)),
    )
  })
}

function redactAbsolutePaths(value: string): string {
  return value
    .replace(
      quotedFileUrlPattern,
      (_match, quote: string) => `${quote}[REDACTED_PATH]${quote}`,
    )
    .replace(unquotedFileUrlPattern, "[REDACTED_PATH]")
    .replace(
      quotedAbsolutePathPattern,
      (_match, quote: string) => `${quote}[REDACTED_PATH]${quote}`,
    )
    .replace(
      unquotedAbsolutePathPattern,
      (_match, boundary: string) => `${boundary}[REDACTED_PATH]`,
    )
}

export function containsPublicRuntimeLeakText(value: string): boolean {
  return (
    redactAbsolutePaths(value) !== value ||
    /\bnode:internal\//iu.test(value) ||
    /\bat\s+(?:async\s+)?(?:[\w.$<>]+\s*\((?:(?:[A-Za-z]:[\\/])|(?:\\\\)|\/)|(?:(?:[A-Za-z]:[\\/])|(?:\\\\)|\/))/iu.test(
      value,
    )
  )
}

export function containsPublicRuntimeLeakContent(
  value: Buffer | Uint8Array,
  sensitiveValues: readonly string[] = [],
): boolean {
  const decodedValues = decodeContentVariants(value)
  return (
    decodedValues.some(containsPublicRuntimeLeakText) ||
    containsSensitiveValue(decodedValues, sensitiveValues)
  )
}

export function sanitizeTestRunPublicValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactAbsolutePaths(value)
      .replace(publicInternalReferencePattern, "[REDACTED_INTERNAL]")
      .replace(publicStackReferencePattern, "[REDACTED_STACK]")
  }
  if (Array.isArray(value)) return value.map(sanitizeTestRunPublicValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        /^(?:stack|stackTrace)$/iu.test(key)
          ? "[REDACTED_STACK]"
          : sanitizeTestRunPublicValue(nestedValue),
      ]),
    )
  }
  return value
}
