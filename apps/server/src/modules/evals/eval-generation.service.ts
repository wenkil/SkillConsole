import { createHash, randomUUID } from "node:crypto"

import { DomainError } from "../../core/errors/domain-error.js"
import type { Database } from "../../infrastructure/database/index.js"
import type { AgentSessionEvent } from "../agent-sessions/agent-session.domain.js"
import type { AgentSessionService } from "../agent-sessions/agent-session.service.js"
import type {
  EvalTargetInput,
  FrozenEvalTarget,
} from "../skill-workspaces/eval-target.domain.js"
import { EvalTargetService } from "../skill-workspaces/eval-target.service.js"
import type {
  EvalGenerationDraftView,
  EvalGenerationEvent,
  EvalGenerationTaskPage,
  EvalGenerationTaskView,
  PublishEvalRevisionResult,
  EvalRevisionView,
} from "./eval-generation.domain.js"
import { EvalGenerationRepository } from "./eval-generation.repository.js"
import { EvalOutputValidator } from "./eval-output-validator.js"
import { EvalPublisher } from "./eval-publisher.js"
import {
  buildEvalGenerationPrompt,
} from "./eval-prompt.js"
import { EvalStorage } from "./eval-storage.js"
import { EvalWorkspacePreparer } from "./eval-workspace.js"

type EvalEventListener = (event: EvalGenerationEvent) => void

const evalGenerationRuntimePolicy = {
  permissionMode: "dontAsk" as const,
  tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"] as const,
  allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"] as const,
  disallowedTools: [
    "Agent",
    "WebSearch",
    "WebFetch",
    "TaskCreate",
    "TaskUpdate",
    "SendMessage",
  ] as const,
}

const agentEventTypes: Partial<
  Record<AgentSessionEvent["type"], string>
> = {
  "assistant.message": "agent.assistant",
  "tool.completed": "agent.tool",
  "usage.updated": "agent.usage",
  "turn.completed": "agent.turn.completed",
  "turn.canceled": "agent.turn.canceled",
  "turn.interrupted": "agent.turn.interrupted",
  "turn.failed": "agent.turn.failed",
  "session.failed": "agent.session.failed",
}

interface EvalGenerationLogger {
  readonly error: (
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ) => void
}

export interface StartEvalGenerationInput {
  readonly workspaceId: string
  readonly target: EvalTargetInput
  readonly maxEvalCount: number
  readonly generationBrief?: string | null
  readonly idempotencyKey: string
}

export class EvalGenerationService {
  private readonly repository: EvalGenerationRepository
  private readonly validator: EvalOutputValidator
  private readonly publisher: EvalPublisher
  private readonly listeners = new Map<string, Set<EvalEventListener>>()
  private readonly subscriptions = new Map<string, () => void>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly startLocks = new Map<string, Promise<void>>()

  constructor(
    database: Database,
    repository: EvalGenerationRepository,
    private readonly targetService: EvalTargetService,
    private readonly workspacePreparer: EvalWorkspacePreparer,
    private readonly storage: EvalStorage,
    private readonly agentSessions: AgentSessionService,
    private readonly logger: EvalGenerationLogger,
  ) {
    this.repository = repository
    this.validator = new EvalOutputValidator(storage)
    this.publisher = new EvalPublisher(database, storage)
  }

  async initialize(): Promise<void> {
    await this.repository.reconcileInterruptedTasks()
    const taskIds = await this.repository.listAllTaskIds()
    await Promise.all(
      taskIds.map(async (taskId) => {
        const attempts = await this.repository.getAttempts(taskId)
        await Promise.all(
          attempts.map((attempt) =>
            this.workspacePreparer.scrubSettings(taskId, attempt.id),
          ),
        )
      }),
    )
  }

  async start(
    rawInput: StartEvalGenerationInput,
  ): Promise<EvalGenerationTaskView> {
    const input = this.validateStartInput(rawInput)
    return this.withStartLock(input.workspaceId, input.idempotencyKey, () =>
      this.startValidated(input),
    )
  }

  async retry(taskId: string, idempotencyKey: string): Promise<EvalGenerationTaskView> {
    if (
      await this.repository.findAttemptByRequestIdempotencyKey(
        taskId,
        idempotencyKey,
      )
    ) {
      return this.repository.get(taskId)
    }
    const source = await this.repository.getRetryableGeneration(taskId)
    const input = {
      workspaceId: source.workspaceId,
      maxEvalCount: source.maxEvalCount,
      generationBrief: source.generationBrief,
      idempotencyKey,
    }
    return this.withStartLock(input.workspaceId, input.idempotencyKey, () =>
      this.retryFrozenTask(taskId, input, source.target),
    )
  }

  private async retryFrozenTask(
    taskId: string,
    input: { readonly workspaceId: string; readonly maxEvalCount: number; readonly generationBrief: string | null; readonly idempotencyKey: string },
    target: FrozenEvalTarget,
  ): Promise<EvalGenerationTaskView> {
    const attempt = await this.repository.beginRetry(taskId, input.idempotencyKey)
    await this.publishNewEvents(taskId)
    if (attempt.status !== "PREPARING") return this.repository.get(taskId)
    const provenance = await this.workspacePreparer.inspectProvenance()
    const systemPrompt = await this.agentSessions.getSystemPrompt("eval-generation")
    return this.launchTask(taskId, target, provenance, systemPrompt, input)
  }

  private async withStartLock<T>(
    workspaceId: string,
    idempotencyKey: string,
    start: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${workspaceId}\u0000${idempotencyKey}`
    const previous = this.startLocks.get(lockKey) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chain = previous.then(() => current)
    this.startLocks.set(lockKey, chain)
    await previous
    try {
      return await start()
    } finally {
      release()
      if (this.startLocks.get(lockKey) === chain) {
        this.startLocks.delete(lockKey)
      }
    }
  }

  private async startValidated(
    input: StartEvalGenerationInput & {
      readonly generationBrief: string | null
    },
  ): Promise<EvalGenerationTaskView> {
    const request = {
      workspaceId: input.workspaceId,
      target: input.target,
      maxEvalCount: input.maxEvalCount,
      generationBrief: input.generationBrief,
    }
    const requestHash = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex")
    const suiteId = await this.repository.ensureSuite(input.workspaceId)
    const existing = await this.repository.findByIdempotencyKey(
      suiteId,
      input.idempotencyKey,
    )
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new DomainError({
          code: "EVAL_IDEMPOTENCY_CONFLICT",
          message:
            "The idempotency key was already used with a different request.",
          kind: "conflict",
        })
      }
      return this.repository.get(existing.id)
    }
    const target = await this.targetService.freeze(
      input.workspaceId,
      input.target,
    )
    return this.startFrozenTarget(input, target, request)
  }

  private async startFrozenTarget(
    input: {
      readonly workspaceId: string
      readonly maxEvalCount: number
      readonly generationBrief: string | null
      readonly idempotencyKey: string
    },
    target: FrozenEvalTarget,
    request: Readonly<Record<string, unknown>>,
  ): Promise<EvalGenerationTaskView> {
    const requestHash = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex")
    const suiteId = await this.repository.ensureSuite(input.workspaceId)
    const existing = await this.repository.findByIdempotencyKey(
      suiteId,
      input.idempotencyKey,
    )
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new DomainError({
          code: "EVAL_IDEMPOTENCY_CONFLICT",
          message:
            "The idempotency key was already used with a different request.",
          kind: "conflict",
        })
      }
      return this.repository.get(existing.id)
    }

    const provenance = await this.workspacePreparer.inspectProvenance()
    const systemPrompt =
      await this.agentSessions.getSystemPrompt("eval-generation")
    const taskId = randomUUID()
    const task = await this.repository.createTask(suiteId, {
      id: taskId,
      workspaceId: input.workspaceId,
      target,
      maxEvalCount: input.maxEvalCount,
      generationBrief: input.generationBrief,
      promptContractVersion: systemPrompt.version,
      configurationFingerprint: provenance.configurationFingerprint,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    })
    await this.publishNewEvents(task.id)
    if (task.id !== taskId) return task

    return this.launchTask(taskId, target, provenance, systemPrompt, input)
  }

  private async launchTask(
    taskId: string,
    target: FrozenEvalTarget,
    provenance: Awaited<ReturnType<EvalWorkspacePreparer["inspectProvenance"]>>,
    systemPrompt: Awaited<ReturnType<AgentSessionService["getSystemPrompt"]>>,
    input: { readonly maxEvalCount: number; readonly generationBrief: string | null },
  ): Promise<EvalGenerationTaskView> {
    let agentSessionId: string | null = null
    let attemptId: string | null = null
    try {
      const attempt = await this.repository.getCurrentAttempt(taskId)
      attemptId = attempt.id
      const workspace = await this.workspacePreparer.prepare(
        taskId,
        attempt.id,
        target,
        provenance,
        {
          maxEvalCount: input.maxEvalCount,
          generationBrief: input.generationBrief,
        },
      )
      const agentSession = await this.agentSessions.createInWorkspace({
        origin: { type: "eval_generation", taskId },
        workspaceLocator: workspace.locator,
        expectedConfigurationFingerprint:
          provenance.configurationFingerprint,
        systemPromptRole: "eval-generation",
        expectedSystemPromptFingerprint: systemPrompt.sha256,
        prompt: buildEvalGenerationPrompt({
          taskPath: workspace.taskPath,
          skillName: target.skillName,
          maxEvalCount: input.maxEvalCount,
          generationBrief: input.generationBrief,
        }),
        ...evalGenerationRuntimePolicy,
        additionalRedactedValues: [
          workspace.targetSkillPath,
          workspace.outputEvalsPath,
          workspace.outputFilesPath,
          workspace.taskPath,
        ],
      })
      agentSessionId = agentSession.id
      const markedRunning = await this.repository.markRunning(
        taskId,
        agentSession.id,
      )
      if (!markedRunning) {
        this.agentSessions.release(agentSession.id)
        throw new DomainError({
          code: "EVAL_GENERATION_STATE_CONFLICT",
          message:
            "The Evals generation task changed state before the Agent Session started.",
          kind: "conflict",
        })
      }
      await this.publishNewEvents(taskId)
      await this.monitorAgentSession(taskId, agentSession.id)
      return this.repository.get(taskId)
    } catch (error) {
      if (agentSessionId) this.agentSessions.release(agentSessionId)
      this.logger.error(
        { taskId, error },
        "Evals generation task could not be started",
      )
      await this.repository.fail(
        taskId,
        "FAILED",
        this.toStoredError(error, "EVAL_GENERATION_START_FAILED"),
      )
      await this.publishNewEvents(taskId)
      if (attemptId) {
        await this.workspacePreparer.scrubSettings(taskId, attemptId)
      }
      return this.repository.get(taskId)
    }
  }

  async get(taskId: string): Promise<EvalGenerationTaskView> {
    return this.repository.get(taskId)
  }

  async list(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<EvalGenerationTaskPage> {
    return this.repository.list(workspaceId, page, pageSize)
  }

  async getDraft(taskId: string): Promise<EvalGenerationDraftView> {
    return this.repository.getDraft(taskId)
  }

  async discardDraft(taskId: string): Promise<EvalGenerationDraftView> {
    const draft = await this.repository.discardDraft(taskId)
    await this.publishNewEvents(taskId)
    return draft
  }

  async listEvents(
    taskId: string,
    afterSequence: number,
  ): Promise<readonly EvalGenerationEvent[]> {
    return this.repository.listEvents(taskId, afterSequence)
  }

  subscribe(taskId: string, listener: EvalEventListener): () => void {
    const taskListeners =
      this.listeners.get(taskId) ?? new Set<EvalEventListener>()
    taskListeners.add(listener)
    this.listeners.set(taskId, taskListeners)
    return () => {
      taskListeners.delete(listener)
      if (taskListeners.size === 0) this.listeners.delete(taskId)
    }
  }

  async cancel(taskId: string): Promise<EvalGenerationTaskView> {
    const task = await this.repository.getRow(taskId)
    if (
      !["PREPARING", "RUNNING", "VALIDATING", "CANCELING"].includes(
        task.status,
      )
    ) {
      return this.repository.get(taskId)
    }
    if (task.status !== "CANCELING") {
      await this.repository.markCanceling(taskId)
      await this.publishNewEvents(taskId)
    }
    if (task.agentSessionId && task.status === "RUNNING") {
      try {
        await this.agentSessions.cancel(task.agentSessionId)
      } catch {
        await this.repository.fail(taskId, "CANCELED", {
          code: "EVAL_GENERATION_CANCELED",
          message: "The Evals generation task was canceled.",
        })
        await this.publishNewEvents(taskId)
        await this.finishMonitoring(taskId, task.agentSessionId)
      }
    } else if (task.status === "PREPARING") {
      await this.repository.fail(taskId, "CANCELED", {
        code: "EVAL_GENERATION_CANCELED",
        message: "The Evals generation task was canceled.",
      })
      await this.publishNewEvents(taskId)
    }
    return this.repository.get(taskId)
  }

  async publish(taskId: string): Promise<PublishEvalRevisionResult> {
    return this.publisher.publish(taskId)
  }

  async listRevisions(
    workspaceId: string,
  ): Promise<readonly EvalRevisionView[]> {
    return this.publisher.list(workspaceId)
  }

  async shutdown(): Promise<void> {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe()
    this.subscriptions.clear()
    await Promise.allSettled(this.queues.values())
  }

  private async monitorAgentSession(
    taskId: string,
    sessionId: string,
  ): Promise<void> {
    let live = false
    const pending: AgentSessionEvent[] = []
    const unsubscribe = this.agentSessions.subscribe(sessionId, (event) => {
      if (!live) {
        pending.push(event)
        return
      }
      this.enqueueAgentEvent(taskId, event)
    })
    this.subscriptions.set(taskId, unsubscribe)
    try {
      const backlog = await this.agentSessions.listEvents(sessionId, 0)
      const unique = new Map<number, AgentSessionEvent>()
      for (const event of [...backlog, ...pending]) {
        unique.set(event.sequence, event)
      }
      for (const event of [...unique.values()].sort(
        (left, right) => left.sequence - right.sequence,
      )) {
        this.enqueueAgentEvent(taskId, event)
      }
      live = true
    } catch (error) {
      unsubscribe()
      this.subscriptions.delete(taskId)
      throw error
    }
  }

  private enqueueAgentEvent(
    taskId: string,
    event: AgentSessionEvent,
  ): void {
    const previous = this.queues.get(taskId) ?? Promise.resolve()
    const next = previous
      .then(() => this.handleAgentEvent(taskId, event))
      .catch(async (error) => {
        this.logger.error(
          { taskId, agentSequence: event.sequence, error },
          "Evals Agent event processing failed",
        )
        await this.repository.fail(
          taskId,
          "FAILED",
          this.toStoredError(error, "EVAL_EVENT_PROCESSING_FAILED"),
        )
        await this.publishNewEvents(taskId)
        await this.finishMonitoring(taskId, event.sessionId)
      })
    this.queues.set(taskId, next)
    void next.then(
      () => {
        if (this.queues.get(taskId) === next) this.queues.delete(taskId)
      },
      () => {
        if (this.queues.get(taskId) === next) this.queues.delete(taskId)
      },
    )
  }

  private async handleAgentEvent(
    taskId: string,
    event: AgentSessionEvent,
  ): Promise<void> {
    const mappedType = agentEventTypes[event.type] ?? null
    if (mappedType) {
      const stored = await this.repository.recordAgentEvent(
        taskId,
        event.sequence,
        mappedType,
        event.payload,
      )
      if (stored) this.publishEvent(stored)
    }

    if (event.type === "turn.completed") {
      if (!(await this.repository.markValidating(taskId))) return
      await this.publishNewEvents(taskId)
      const task = await this.repository.getRow(taskId)
      const attempt = await this.repository.getCurrentAttempt(taskId)
      this.agentSessions.release(event.sessionId)
      try {
        const validated = await this.validator.validate({
          generationId: taskId,
          attemptId: attempt.id,
          skillName: task.skillName,
          provenance: {
            taskId,
            targetSnapshotId: task.targetSnapshotId,
            promptContractVersion: task.promptContractVersion,
            configurationFingerprint:
              task.configurationFingerprint,
          },
        })
        if (validated.cases.length > 0) {
          await this.repository.completeWithDraft(taskId, {
            storageLocator: this.storage.getGenerationOutputLocator(taskId, attempt.id),
            ...validated,
          })
        } else {
          await this.repository.completeWithoutDraft(taskId)
        }
        await this.publishNewEvents(taskId)
      } catch (error) {
        const current = await this.repository.getRow(taskId)
        if (current.status === "CANCELING") {
          await this.repository.fail(taskId, "CANCELED", {
            code: "EVAL_GENERATION_CANCELED",
            message: "The Evals generation task was canceled.",
          })
        } else {
          await this.repository.fail(
            taskId,
            "FAILED",
            this.toStoredError(error, "EVAL_OUTPUT_VALIDATION_FAILED"),
          )
        }
        await this.publishNewEvents(taskId)
      } finally {
        await this.finishMonitoring(taskId, event.sessionId)
      }
      return
    }

    if (
      event.type === "turn.canceled" ||
      event.type === "turn.interrupted" ||
      event.type === "turn.failed" ||
      event.type === "session.failed"
    ) {
      const error =
        event.payload.error &&
        typeof event.payload.error === "object" &&
        !Array.isArray(event.payload.error)
          ? (event.payload.error as {
              readonly code?: unknown
              readonly message?: unknown
            })
          : null
      const status =
        event.type === "turn.canceled"
          ? "CANCELED"
          : event.type === "turn.interrupted"
            ? "INTERRUPTED"
            : "FAILED"
      await this.repository.fail(taskId, status, {
        code:
          typeof error?.code === "string"
            ? error.code
            : `EVAL_GENERATION_${status}`,
        message:
          typeof error?.message === "string"
            ? error.message
            : `The Evals generation task ended with ${status.toLowerCase()}.`,
      })
      await this.publishNewEvents(taskId)
      await this.finishMonitoring(taskId, event.sessionId)
    }
  }

  private async finishMonitoring(
    taskId: string,
    sessionId: string,
  ): Promise<void> {
    this.subscriptions.get(taskId)?.()
    this.subscriptions.delete(taskId)
    this.agentSessions.release(sessionId)
    const attempt = await this.repository.getCurrentAttempt(taskId)
    await this.workspacePreparer.scrubSettings(taskId, attempt.id)
  }

  private publishEvent(event: EvalGenerationEvent): void {
    this.lastPublishedSequences.set(
      event.taskId,
      Math.max(
        this.lastPublishedSequences.get(event.taskId) ?? 0,
        event.sequence,
      ),
    )
    for (const listener of this.listeners.get(event.taskId) ?? []) {
      listener(event)
    }
  }

  private readonly lastPublishedSequences = new Map<string, number>()

  private async publishNewEvents(taskId: string): Promise<void> {
    const events = await this.repository.listEvents(
      taskId,
      this.lastPublishedSequences.get(taskId) ?? 0,
    )
    for (const event of events) this.publishEvent(event)
  }

  private validateStartInput(
    input: StartEvalGenerationInput,
  ): StartEvalGenerationInput & { readonly generationBrief: string | null } {
    const idempotencyKey = input.idempotencyKey.trim()
    const brief = input.generationBrief?.trim() || null
    if (
      !idempotencyKey ||
      idempotencyKey.length > 200 ||
      !Number.isSafeInteger(input.maxEvalCount) ||
      input.maxEvalCount < 1 ||
      input.maxEvalCount > 20 ||
      (brief?.length ?? 0) > 4000
    ) {
      throw new DomainError({
        code: "EVAL_GENERATION_INPUT_INVALID",
        message: "The Evals generation request is invalid.",
        kind: "validation",
      })
    }
    return { ...input, idempotencyKey, generationBrief: brief }
  }

  private toStoredError(
    error: unknown,
    fallbackCode: string,
  ): {
    readonly code: string
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  } {
    if (error instanceof DomainError) {
      return {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      }
    }
    return {
      code: fallbackCode,
      message: "The Evals generation task could not be completed.",
    }
  }
}
