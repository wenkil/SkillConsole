export type DomainErrorKind = "conflict" | "not_found" | "validation"

export interface DomainErrorOptions {
  readonly code: string
  readonly message: string
  readonly kind: DomainErrorKind
  readonly details?: Readonly<Record<string, unknown>>
}

export class DomainError extends Error {
  readonly code: string
  readonly kind: DomainErrorKind
  readonly details?: Readonly<Record<string, unknown>>

  constructor({ code, message, kind, details }: DomainErrorOptions) {
    super(message)
    this.name = "DomainError"
    this.code = code
    this.kind = kind

    if (details !== undefined) {
      this.details = details
    }
  }
}
