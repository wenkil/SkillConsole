interface ApiErrorResponse {
  error?: {
    code?: string
    message?: string
    requestId?: string
    details?: Record<string, unknown>
  }
}

export class SkillConsoleApiError extends Error {
  readonly code: string
  readonly requestId: string | undefined
  readonly details: Record<string, unknown> | undefined
  readonly status: number

  constructor(
    status: number,
    response: ApiErrorResponse,
  ) {
    super(response.error?.message || "The request could not be completed.")
    this.name = "SkillConsoleApiError"
    this.status = status
    this.code = response.error?.code || "REQUEST_FAILED"
    this.requestId = response.error?.requestId
    this.details = response.error?.details
  }
}

export async function readApiError(
  response: Response,
): Promise<SkillConsoleApiError> {
  let body: ApiErrorResponse = {}
  try {
    body = (await response.json()) as ApiErrorResponse
  } catch {
    // Proxy and network failures still receive a stable client error.
  }

  return new SkillConsoleApiError(response.status, body)
}
