import type {
  EvalGenerationDraft,
  EvalGenerationEvent,
  EvalGenerationFailureSummary,
  EvalGenerationTask,
  EvalGenerationTaskPage,
  EvalRevision,
  SaveEvalRevisionResult,
  StartEvalGenerationInput,
} from "@/features/evals/model/evals"
import { readApiError } from "@/shared/api/http"

async function readJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Accept")) headers.set("Accept", "application/json")
  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as T
}

function taskBaseUrl(taskId: string): string {
  return `/api/eval-generations/${encodeURIComponent(taskId)}`
}

export function listEvalGenerations(
  workspaceId: string,
  page: number,
  pageSize: number,
): Promise<EvalGenerationTaskPage> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/eval-generations?page=${page}&pageSize=${pageSize}`,
  )
}

export function listEvalRevisions(
  workspaceId: string,
): Promise<EvalRevision[]> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/eval-revisions`,
  )
}

export function getEvalGeneration(
  taskId: string,
): Promise<EvalGenerationTask> {
  return readJson(taskBaseUrl(taskId))
}

export function getEvalGenerationDraft(
  taskId: string,
): Promise<EvalGenerationDraft> {
  return readJson(`${taskBaseUrl(taskId)}/draft`)
}

export function getEvalGenerationFailureSummary(
  taskId: string,
): Promise<EvalGenerationFailureSummary> {
  return readJson(`${taskBaseUrl(taskId)}/failure-summary`)
}

export function startEvalGeneration(
  workspaceId: string,
  input: StartEvalGenerationInput,
  idempotencyKey: string,
): Promise<EvalGenerationTask> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/eval-generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  )
}

export function cancelEvalGeneration(
  taskId: string,
): Promise<EvalGenerationTask> {
  return readJson(`${taskBaseUrl(taskId)}/cancel`, { method: "POST" })
}

export function discardEvalGenerationDraft(
  taskId: string,
): Promise<EvalGenerationDraft> {
  return readJson(`${taskBaseUrl(taskId)}/draft/discard`, {
    method: "POST",
  })
}

export function saveEvalGeneration(
  taskId: string,
): Promise<SaveEvalRevisionResult> {
  return readJson(`${taskBaseUrl(taskId)}/publish`, {
    method: "POST",
  })
}

const streamedEventTypes = [
  "task.created",
  "task.running",
  "task.validating",
  "task.succeeded",
  "task.canceling",
  "task.canceled",
  "task.interrupted",
  "task.failed",
  "agent.assistant",
  "agent.tool",
  "agent.usage",
  "agent.turn.completed",
  "agent.turn.canceled",
  "agent.turn.interrupted",
  "agent.turn.failed",
  "agent.session.failed",
  "validation.succeeded",
  "draft.discarded",
] as const

export function subscribeToEvalGeneration(
  taskId: string,
  onEvent: (event: EvalGenerationEvent) => void,
  onConnectionError: () => void,
): () => void {
  const source = new EventSource(`${taskBaseUrl(taskId)}/events`)
  const handleEvent = (rawEvent: Event) => {
    if (!(rawEvent instanceof MessageEvent)) return
    try {
      onEvent(JSON.parse(rawEvent.data) as EvalGenerationEvent)
    } catch {
      onConnectionError()
    }
  }
  for (const type of streamedEventTypes) {
    source.addEventListener(type, handleEvent)
  }
  source.onerror = onConnectionError

  return () => {
    for (const type of streamedEventTypes) {
      source.removeEventListener(type, handleEvent)
    }
    source.close()
  }
}
