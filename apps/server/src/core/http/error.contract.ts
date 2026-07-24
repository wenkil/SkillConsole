import { Type, type Static } from "typebox"

export const ApiErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)

export const ErrorResponseSchema = Type.Object(
  {
    error: ApiErrorSchema,
  },
  { additionalProperties: false },
)

export type ApiError = Static<typeof ApiErrorSchema>
export type ErrorResponse = Static<typeof ErrorResponseSchema>

export function createErrorResponse(
  requestId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  }
}
