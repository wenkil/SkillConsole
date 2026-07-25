import { DomainError, type DomainErrorKind } from "../errors/domain-error.js"
import { createErrorResponse } from "./error.contract.js"

import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify"

const domainStatusCodes: Record<DomainErrorKind, number> = {
  conflict: 409,
  internal: 500,
  not_found: 404,
  payload_too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
}

function sendError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return reply
    .code(statusCode)
    .send(createErrorResponse(requestId, code, message, details))
}

function hasValidationIssues(
  error: FastifyError,
): error is FastifyError & { validation: unknown[] } {
  return Array.isArray(error.validation)
}

export function registerErrorHandling(application: FastifyInstance): void {
  application.setErrorHandler(
    async (
      error: FastifyError,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      if (hasValidationIssues(error)) {
        return sendError(
          reply,
          request.id,
          400,
          "REQUEST_VALIDATION_FAILED",
          "The request does not match the expected schema.",
        )
      }

      if (error instanceof DomainError) {
        if (error.kind === "internal") {
          request.log.error({ err: error }, "Internal domain operation error")
        }

        return sendError(
          reply,
          request.id,
          domainStatusCodes[error.kind],
          error.code,
          error.message,
          error.details ? { ...error.details } : undefined,
        )
      }

      if (
        error.statusCode !== undefined &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        return sendError(
          reply,
          request.id,
          error.statusCode,
          "REQUEST_REJECTED",
          error.message,
        )
      }

      request.log.error({ err: error }, "Unhandled request error")

      return sendError(
        reply,
        request.id,
        500,
        "INTERNAL_SERVER_ERROR",
        "An unexpected server error occurred.",
      )
    },
  )
}
