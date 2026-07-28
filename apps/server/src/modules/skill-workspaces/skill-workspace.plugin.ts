import fastifyMultipart from "@fastify/multipart"

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"
import type { FastifyReply } from "fastify"
import { Type } from "typebox"

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
import {
  SkillDraftBrowserSchema,
  SkillVersionBrowserListSchema,
  SkillVersionBrowserSchema,
  SnapshotFileListSchema,
  TextFilePreviewSchema,
  VersionFilePathQuerySchema,
  WorkspaceVersionParamsSchema,
} from "./version-browser.contract.js"
import {
  getActiveSkillDraft,
  getDraftFileRecord,
  getSkillVersion,
  getVersionFileRecord,
  listDraftFiles,
  listSkillVersions,
  listVersionFiles,
} from "./version-browser.repository.js"
import {
  classifySnapshotFile,
  readFileDownload,
  readImagePreview,
  readTextPreview,
} from "./version-browser.service.js"
import {
  loadUploadFolderIgnorePolicy,
  UploadFolderIgnorePolicySchema,
} from "./upload-folder-ignore-policy.js"
import {
  DraftConditionalHeadersSchema,
  DraftDiffSchema,
  DraftFolderMergeCommitSchema,
  DraftFolderMergePreviewSchema,
  DraftMoveFileSchema,
  DraftMutationResponseSchema,
  DraftOperationParamsSchema,
  DraftTextSaveSchema,
  DraftWriteHeadersSchema,
} from "./draft.contract.js"
import { DraftService } from "./draft.service.js"
import { createDraftEtag, getDraftBaseFileRecord } from "./draft.repository.js"

function contentDispositionFilename(relativePath: string): string {
  const filename = relativePath.split("/").at(-1) ?? "download"
  const asciiFilename =
    filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replaceAll('"', "_")
      .replaceAll("\\", "_") || "download"
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function setControlledContentHeaders(reply: FastifyReply): void {
  reply
    .header("Cache-Control", "private, no-store")
    .header("Content-Security-Policy", "default-src 'none'; sandbox")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .header("X-Content-Type-Options", "nosniff")
}

export const skillWorkspacePlugin: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const limits = application.appConfig.uploadLimits
  const folderIgnorePolicy = await loadUploadFolderIgnorePolicy(
    application.appConfig.uploadFolderIgnoreConfigPath,
  )

  await application.register(fastifyMultipart, {
    preservePath: true,
    throwFileSizeLimit: true,
    limits: {
      fields: 3,
      files: limits.maxFiles,
      fileSize: limits.maxZipBytes,
      parts: limits.maxFiles + 3,
      fieldNameSize: 64,
      fieldSize: 128 * 1_024,
      headerPairs: 64,
    },
  })

  const storage = new LocalSnapshotStorage(application.appConfig.dataRoot)
  await storage.initialize()
  const createService = new CreateSkillWorkspaceService({
    database: application.databaseClient.database,
    storage,
    limits,
    folderIgnorePolicy,
  })
  const draftService = new DraftService({
    database: application.databaseClient.database,
    storage,
    limits,
    folderIgnorePolicy,
  })

  application.get(
    "/api/skill-workspace-upload-policy",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read the server-owned folder upload ignore policy",
        response: {
          200: UploadFolderIgnorePolicySchema,
        },
      },
    },
    async () => folderIgnorePolicy,
  )

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
        summary: "Create a Skill testing workbench and initial candidate",
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
    "/api/skill-workspaces/:workspaceId/draft",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read the active Skill candidate metadata",
        params: WorkspaceIdParamsSchema,
        response: {
          200: SkillDraftBrowserSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const draft = await getActiveSkillDraft(
        application.databaseClient.database,
        request.params.workspaceId,
      )
      return reply
        .header(
          "ETag",
          createDraftEtag(draft.id, draft.contentRevision),
        )
        .send(draft)
    },
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/draft",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Create a unique Draft from the latest formal version",
        params: WorkspaceIdParamsSchema,
        response: {
          201: SkillDraftBrowserSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const draft = await draftService.createDraft(
        request.params.workspaceId,
      )
      return reply
        .code(201)
        .header("ETag", draftService.getEtag(draft))
        .send(draft)
    },
  )

  application.delete(
    "/api/skill-workspaces/:workspaceId/draft",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Abandon the active Draft without creating a version",
        params: WorkspaceIdParamsSchema,
        headers: DraftConditionalHeadersSchema,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await draftService.abandon(
        request.params.workspaceId,
        request.headers["if-match"],
      )
      return reply.code(204).send(null)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/draft/files",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "List the active candidate Snapshot Manifest",
        params: WorkspaceIdParamsSchema,
        response: {
          200: SnapshotFileListSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      listDraftFiles(
        application.databaseClient.database,
        request.params.workspaceId,
        classifySnapshotFile,
      ),
  )

  application.put(
    "/api/skill-workspaces/:workspaceId/draft/files/text",
    {
      bodyLimit: limits.maxFileBytes + 64 * 1024,
      schema: {
        tags: ["skill-workspaces"],
        summary: "Save one editable UTF-8 Draft file",
        params: WorkspaceIdParamsSchema,
        headers: DraftWriteHeadersSchema,
        body: DraftTextSaveSchema,
        response: {
          200: DraftMutationResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          413: ErrorResponseSchema,
          415: ErrorResponseSchema,
          422: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await draftService.saveText(
        request.params.workspaceId,
        request.body,
        {
          ifMatch: request.headers["if-match"],
          idempotencyKey: request.headers["idempotency-key"],
        },
      )
      return reply
        .header("ETag", draftService.getEtag(result.draft))
        .send(result)
    },
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/draft/files",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Add or replace one Draft file without deleting siblings",
        description:
          "Accepts multipart/form-data with a path field before one file field.",
        params: WorkspaceIdParamsSchema,
        headers: DraftWriteHeadersSchema,
        consumes: ["multipart/form-data"],
        response: {
          200: DraftMutationResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          413: ErrorResponseSchema,
          422: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await draftService.uploadSingleFile(
        request.params.workspaceId,
        request.parts(),
        {
          ifMatch: request.headers["if-match"],
          idempotencyKey: request.headers["idempotency-key"],
        },
      )
      return reply
        .header("ETag", draftService.getEtag(result.draft))
        .send(result)
    },
  )

  application.delete(
    "/api/skill-workspaces/:workspaceId/draft/files",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Delete one Draft file",
        params: WorkspaceIdParamsSchema,
        querystring: VersionFilePathQuerySchema,
        headers: DraftWriteHeadersSchema,
        response: {
          200: DraftMutationResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          422: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await draftService.deleteFile(
        request.params.workspaceId,
        request.query.path,
        {
          ifMatch: request.headers["if-match"],
          idempotencyKey: request.headers["idempotency-key"],
        },
      )
      return reply
        .header("ETag", draftService.getEtag(result.draft))
        .send(result)
    },
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/draft/files/move",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Move or rename one Draft file",
        params: WorkspaceIdParamsSchema,
        headers: DraftWriteHeadersSchema,
        body: DraftMoveFileSchema,
        response: {
          200: DraftMutationResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          422: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await draftService.moveFile(
        request.params.workspaceId,
        request.body,
        {
          ifMatch: request.headers["if-match"],
          idempotencyKey: request.headers["idempotency-key"],
        },
      )
      return reply
        .header("ETag", draftService.getEtag(result.draft))
        .send(result)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/draft/diff",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Compare the Draft with its fixed comparison basis",
        params: WorkspaceIdParamsSchema,
        response: {
          200: DraftDiffSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      draftService.getDiff(request.params.workspaceId),
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/draft/diff/base-text",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read one UTF-8 file from the fixed Draft comparison basis",
        params: WorkspaceIdParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: TextFilePreviewSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          415: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const record = await getDraftBaseFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.query.path,
      )
      return readTextPreview(storage, record)
    },
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/draft/folder-merges",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Stage and preview a folder merge into the current Draft",
        params: WorkspaceIdParamsSchema,
        headers: DraftConditionalHeadersSchema,
        consumes: ["multipart/form-data"],
        response: {
          200: DraftFolderMergePreviewSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          413: ErrorResponseSchema,
          422: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      draftService.previewFolderMerge(
        request.params.workspaceId,
        request.parts(),
        request.headers["if-match"],
      ),
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/draft/folder-merges/:operationId/commit",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Commit a staged folder merge into the current Draft",
        params: DraftOperationParamsSchema,
        headers: DraftWriteHeadersSchema,
        body: DraftFolderMergeCommitSchema,
        response: {
          200: DraftMutationResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          428: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await draftService.commitFolderMerge(
        request.params.workspaceId,
        request.params.operationId,
        {
          ifMatch: request.headers["if-match"],
          idempotencyKey: request.headers["idempotency-key"],
        },
      )
      return reply
        .header("ETag", draftService.getEtag(result.draft))
        .send(result)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/draft/files/text-preview",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read a controlled UTF-8 candidate file preview",
        params: WorkspaceIdParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: TextFilePreviewSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          415: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const record = await getDraftFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.query.path,
      )
      return readTextPreview(storage, record)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/draft/files/image-preview",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read a controlled candidate raster image preview",
        params: WorkspaceIdParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: Type.Any(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          415: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const record = await getDraftFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.query.path,
      )
      const preview = await readImagePreview(storage, record)
      setControlledContentHeaders(reply)
      return reply
        .header("Content-Length", preview.content.byteLength)
        .type(preview.mediaType)
        .send(preview.content)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/draft/files/download",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Download one candidate Snapshot file as an attachment",
        params: WorkspaceIdParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: Type.Any(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const record = await getDraftFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.query.path,
      )
      const content = await readFileDownload(storage, record)
      setControlledContentHeaders(reply)
      return reply
        .header(
          "Content-Disposition",
          contentDispositionFilename(record.file.relativePath),
        )
        .header("Content-Length", content.byteLength)
        .type("application/octet-stream")
        .send(content)
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
    "/api/skill-workspaces/:workspaceId/versions",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "List immutable formal versions in a Skill workbench",
        params: WorkspaceIdParamsSchema,
        response: {
          200: SkillVersionBrowserListSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      listSkillVersions(
        application.databaseClient.database,
        request.params.workspaceId,
      ),
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/versions/:versionId",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read immutable formal version metadata",
        params: WorkspaceVersionParamsSchema,
        response: {
          200: SkillVersionBrowserSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      getSkillVersion(
        application.databaseClient.database,
        request.params.workspaceId,
        request.params.versionId,
      ),
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/versions/:versionId/files",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "List the complete immutable Snapshot Manifest",
        params: WorkspaceVersionParamsSchema,
        response: {
          200: SnapshotFileListSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) =>
      listVersionFiles(
        application.databaseClient.database,
        request.params.workspaceId,
        request.params.versionId,
        classifySnapshotFile,
      ),
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/versions/:versionId/files/text-preview",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read a controlled UTF-8 text preview",
        params: WorkspaceVersionParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: TextFilePreviewSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          415: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const record = await getVersionFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.params.versionId,
        request.query.path,
      )
      return readTextPreview(storage, record)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/versions/:versionId/files/image-preview",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Read a controlled raster image preview",
        params: WorkspaceVersionParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: Type.Any(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          415: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const record = await getVersionFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.params.versionId,
        request.query.path,
      )
      const preview = await readImagePreview(storage, record)
      setControlledContentHeaders(reply)
      return reply
        .header("Content-Length", preview.content.byteLength)
        .type(preview.mediaType)
        .send(preview.content)
    },
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/versions/:versionId/files/download",
    {
      schema: {
        tags: ["skill-workspaces"],
        summary: "Download one immutable Snapshot file as an attachment",
        params: WorkspaceVersionParamsSchema,
        querystring: VersionFilePathQuerySchema,
        response: {
          200: Type.Any(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const record = await getVersionFileRecord(
        application.databaseClient.database,
        request.params.workspaceId,
        request.params.versionId,
        request.query.path,
      )
      const content = await readFileDownload(storage, record)
      setControlledContentHeaders(reply)
      return reply
        .header(
          "Content-Disposition",
          contentDispositionFilename(record.file.relativePath),
        )
        .header("Content-Length", content.byteLength)
        .type("application/octet-stream")
        .send(content)
    },
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
