export type DomainErrorKind =
  | "conflict"
  | "internal"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type"
  | "validation"

export interface DomainErrorOptions {
  readonly code: string
  readonly message: string
  readonly kind: DomainErrorKind
  readonly details?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

export class DomainError extends Error {
  readonly code: string
  readonly kind: DomainErrorKind
  readonly details?: Readonly<Record<string, unknown>>

  constructor({ code, message, kind, details, cause }: DomainErrorOptions) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "DomainError"
    this.code = code
    this.kind = kind

    if (details !== undefined) {
      this.details = details
    }
  }
}
