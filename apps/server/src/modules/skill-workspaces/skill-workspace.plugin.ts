import fastifyMultipart from "@fastify/multipart"

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"

import { ErrorResponseSchema } from "../../core/http/error.contract.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import {
  CreateSkillWorkspaceResponseSchema,
  SkillWorkspaceListSchema,
  SkillWorkspaceSchema,
  UploadOperationIdParamsSchema,
  UploadOperationSchema,
  WorkspaceIdParamsSchema,
} from "./skill-workspace.contract.js"
import { CreateSkillWorkspaceService } from "./create-skill-workspace.service.js"
import {
  getSkillWorkspace,
  getUploadOperation,
  listSkillWorkspaces,
} from "./skill-workspace.repository.js"
import { validateOperationId } from "./upload-validation.js"

export const skillWorkspacePlugin: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const limits = application.appConfig.uploadLimits

  await application.register(fastifyMultipart, {
    preservePath: true,
    throwFileSizeLimit: true,
    limits: {
      fields: 3,
      files: limits.maxFiles,
      fileSize: limits.maxZipBytes,
      parts: limits.maxFiles + 3,
      fieldNameSize: 64,
      fieldSize: 1_024,
      headerPairs: 64,
    },
  })

  const storage = new LocalSnapshotStorage(application.appConfig.dataRoot)
  await storage.initialize()
  const createService = new CreateSkillWorkspaceService({
    database: application.databaseClient.database,
    storage,
    limits,
  })

  application.get(
    "/api/skill-workspaces",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "List Skill testing workbenches",
        response: {
          200: SkillWorkspaceListSchema,
        },
      },
    },
    async () =>
      listSkillWorkspaces(application.databaseClient.database),
  )

  application.post(
    "/api/skill-workspaces",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Create a Skill testing workbench and immutable V1",
        description:
          "Accepts multipart/form-data with operationId, name, sourceType, and one or more files fields. Metadata fields must precede file parts.",
        consumes: ["multipart/form-data"],
        response: {
          200: CreateSkillWorkspaceResponseSchema,
          201: CreateSkillWorkspaceResponseSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
          413: ErrorResponseSchema,
          422: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const response = await createService.create(request.parts())
      return reply.code(response.replayed ? 200 : 201).send(response)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read a Skill testing workbench",
        params: WorkspaceIdParamsSchema,
        response: {
          200: SkillWorkspaceSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getSkillWorkspace(
        application.databaseClient.database,
        request.params.workspaceId,
      ),
  )

  application.get(
    "/api/skill-workspace-uploads/:operationId",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read an initial Skill upload operation",
        params: UploadOperationIdParamsSchema,
        response: {
          200: UploadOperationSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getUploadOperation(
        application.databaseClient.database,
        validateOperationId(request.params.operationId),
      ),
  )
}
