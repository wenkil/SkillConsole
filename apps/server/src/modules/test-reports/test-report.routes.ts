import { createHash } from "node:crypto"

import { Type } from "typebox"
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"

import { ErrorResponseSchema } from "../../core/http/error.contract.js"
import {
  CreateTestReportAnalysisBodySchema,
  TestReportAnalysisParamsSchema,
  TestReportAnalysisRevisionListSchema,
  TestReportAnalysisRevisionSchema,
  TestReportCasePageSchema,
  TestReportCaseDetailSchema,
  TestReportCaseParamsSchema,
  TestReportCaseQuerySchema,
  TestReportCaseSchema,
  TestReportDetailSchema,
  TestReportDocumentParamsSchema,
  TestReportDocumentQuerySchema,
  TestReportListQuerySchema,
  TestReportPageSchema,
  TestReportParamsSchema,
  TestReportRegenerateHeadersSchema,
  TestRunReportParamsSchema,
  WorkspaceTestReportParamsSchema,
} from "./test-report.contract.js"
import type { TestReportAnalysisRevisionView } from "./test-report.domain.js"

function serializePublicResponse(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function serializePublicAnalysis(
  value: TestReportAnalysisRevisionView,
) {
  const {
    agentSessionId: _internalAgentSessionId,
    configurationFingerprint: _internalConfigurationFingerprint,
    ...publicValue
  } = value
  return serializePublicResponse(publicValue)
}

function documentEtag(content: string): string {
  return `"${createHash("sha256").update(content, "utf8").digest("hex")}"`
}

function contentDisposition(filename: string, attachment: boolean): string {
  return `${attachment ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

const documentSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const

export const testReportRoutes: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const service = application.testReportService
  const analysisService = application.testReportAnalysisService

  application.post(
    "/api/test-reports/:reportId/analyses",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Create an isolated AI Analysis Revision for selected report Cases",
        params: TestReportParamsSchema,
        headers: TestReportRegenerateHeadersSchema,
        body: CreateTestReportAnalysisBodySchema,
        response: {
          200: TestReportAnalysisRevisionSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializePublicAnalysis(
            await analysisService.create(
              request.params.reportId,
              request.body.evalRevisionCaseIds,
              request.headers["idempotency-key"],
            ),
          ),
        ),
  )

  application.get(
    "/api/test-reports/:reportId/analyses",
    {
      schema: {
        tags: ["test-reports"],
        summary: "List immutable AI Analysis Revisions for a report",
        params: TestReportParamsSchema,
        response: {
          200: TestReportAnalysisRevisionListSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send({
          items: (
            await analysisService.list(request.params.reportId)
          ).map(serializePublicAnalysis),
        }),
  )

  application.get(
    "/api/test-report-analyses/:analysisId",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Read one immutable AI Analysis Revision",
        params: TestReportAnalysisParamsSchema,
        response: {
          200: TestReportAnalysisRevisionSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializePublicAnalysis(
            await analysisService.get(request.params.analysisId),
          ),
        ),
  )

  application.get(
    "/api/test-report-analyses/:analysisId/document.html",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Read an immutable static HTML AI Analysis document",
        params: TestReportAnalysisParamsSchema,
        querystring: TestReportDocumentQuerySchema,
        response: {
          200: Type.String(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const document = await analysisService.getDocument(
        request.params.analysisId,
        request.query.locale ?? "en",
        "html",
      )
      const etag = documentEtag(document.content)
      for (const [name, value] of Object.entries(documentSecurityHeaders)) {
        reply.header(name, value)
      }
      return reply
        .header("Cache-Control", "private, no-cache")
        .header("ETag", etag)
        .header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        )
        .header(
          "Content-Disposition",
          contentDisposition(
            document.filename,
            request.query.download ?? false,
          ),
        )
        .type("text/html; charset=utf-8")
        .send(document.content)
    },
  )

  application.get(
    "/api/test-report-analyses/:analysisId/document.md",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Download an immutable Markdown AI Analysis document",
        params: TestReportAnalysisParamsSchema,
        querystring: TestReportDocumentQuerySchema,
        response: {
          200: Type.String(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const document = await analysisService.getDocument(
        request.params.analysisId,
        request.query.locale ?? "en",
        "markdown",
      )
      const etag = documentEtag(document.content)
      for (const [name, value] of Object.entries(documentSecurityHeaders)) {
        reply.header(name, value)
      }
      return reply
        .header("Cache-Control", "private, no-cache")
        .header("ETag", etag)
        .header(
          "Content-Disposition",
          contentDisposition(document.filename, true),
        )
        .type("text/markdown; charset=utf-8")
        .send(document.content)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/test-reports",
    {
      schema: {
        tags: ["test-reports"],
        summary: "List deterministic reports for terminal test Runs",
        params: WorkspaceTestReportParamsSchema,
        querystring: TestReportListQuerySchema,
        response: { 200: TestReportPageSchema, 400: ErrorResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializePublicResponse(await service.list(request.params.workspaceId, {
            ...request.query,
            page: request.query.page ?? 1,
            pageSize: request.query.pageSize ?? 20,
            sort: request.query.sort ?? "completedAt",
            order: request.query.order ?? "desc",
          })),
        ),
  )

  application.get(
    "/api/test-reports/:reportId/revisions/:revisionId/document.html",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Read a deterministic static HTML report document",
        params: TestReportDocumentParamsSchema,
        querystring: TestReportDocumentQuerySchema,
        response: {
          200: Type.String(),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const document = await service.getDocument(
        request.params.reportId,
        request.params.revisionId,
        request.query.locale ?? "en",
        "html",
      )
      const etag = documentEtag(document.content)
      for (const [name, value] of Object.entries(documentSecurityHeaders)) {
        reply.header(name, value)
      }
      return reply
        .header("Cache-Control", "private, no-cache")
        .header("ETag", etag)
        .header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        )
        .header(
          "Content-Disposition",
          contentDisposition(
            document.filename,
            request.query.download ?? false,
          ),
        )
        .type("text/html; charset=utf-8")
        .send(document.content)
    },
  )

  application.get(
    "/api/test-reports/:reportId/revisions/:revisionId/document.md",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Download a deterministic Markdown report document",
        params: TestReportDocumentParamsSchema,
        querystring: TestReportDocumentQuerySchema,
        response: {
          200: Type.String(),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const document = await service.getDocument(
        request.params.reportId,
        request.params.revisionId,
        request.query.locale ?? "en",
        "markdown",
      )
      const etag = documentEtag(document.content)
      for (const [name, value] of Object.entries(documentSecurityHeaders)) {
        reply.header(name, value)
      }
      return reply
        .header("Cache-Control", "private, no-cache")
        .header("ETag", etag)
        .header(
          "Content-Disposition",
          contentDisposition(
            document.filename,
            true,
          ),
        )
        .type("text/markdown; charset=utf-8")
        .send(document.content)
    },
  )

  application.get(
    "/api/test-reports/:reportId",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Read the current deterministic test report Revision",
        params: TestReportParamsSchema,
        response: {
          200: TestReportDetailSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(serializePublicResponse(await service.get(request.params.reportId))),
  )

  application.get(
    "/api/test-runs/:runId/report",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Find or generate the primary report for a terminal Run",
        params: TestRunReportParamsSchema,
        response: {
          200: TestReportDetailSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(serializePublicResponse(await service.getByRun(request.params.runId))),
  )

  application.get(
    "/api/test-reports/:reportId/cases",
    {
      schema: {
        tags: ["test-reports"],
        summary: "List normalized Case comparisons in a test report",
        params: TestReportParamsSchema,
        querystring: TestReportCaseQuerySchema,
        response: {
          200: TestReportCasePageSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializePublicResponse(await service.listCases(request.params.reportId, {
            ...request.query,
            page: request.query.page ?? 1,
            pageSize: request.query.pageSize ?? 50,
          })),
        ),
  )

  application.get(
    "/api/test-reports/:reportId/cases/:evalRevisionCaseId",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Read one normalized report Case comparison",
        params: TestReportCaseParamsSchema,
        response: {
          200: TestReportCaseDetailSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializePublicResponse(await service.getCase(
            request.params.reportId,
            request.params.evalRevisionCaseId,
          )),
        ),
  )

  application.post(
    "/api/test-reports/:reportId/regenerate",
    {
      schema: {
        tags: ["test-reports"],
        summary: "Idempotently regenerate a deterministic test report",
        params: TestReportParamsSchema,
        headers: TestReportRegenerateHeadersSchema,
        response: {
          200: TestReportDetailSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(serializePublicResponse(await service.regenerate(request.params.reportId))),
  )
}
