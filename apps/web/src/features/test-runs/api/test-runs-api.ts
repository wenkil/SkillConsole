import type {
  StartTestRunInput,
  TestRunDetail,
  TestRunEvent,
  TestRunPage,
  TestRunView,
} from "@/features/test-runs/model/test-run"
import { readApiError } from "@/shared/api/http"

async function readJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Accept")) headers.set("Accept", "application/json")
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as T
}

function runBaseUrl(runId: string): string {
  return `/api/test-runs/${encodeURIComponent(runId)}`
}

export function listTestRuns(
  workspaceId: string,
  page: number,
  pageSize: number,
): Promise<TestRunPage> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/test-runs?page=${page}&pageSize=${pageSize}`,
  )
}

export function getTestRun(runId: string): Promise<TestRunDetail> {
  return readJson(runBaseUrl(runId))
}

export function startTestRun(
  workspaceId: string,
  input: StartTestRunInput,
  idempotencyKey: string,
): Promise<TestRunDetail> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/test-runs`,
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

export function cancelTestRun(runId: string): Promise<TestRunView> {
  return readJson(`${runBaseUrl(runId)}/cancel`, { method: "POST" })
}

const streamedEventTypes = [
  "run.created",
  "run.started",
  "run.canceling",
  "run.completed",
  "run.canceled",
  "run.interrupted",
  "run.failed",
  "case.preparing",
  "case.execution.started",
  "case.execution.completed",
  "case.execution.failed",
  "case.execution.canceled",
  "case.execution.interrupted",
  "case.assessment.started",
  "case.assessment.completed",
  "case.assessment.failed",
  "execution.session.started",
  "execution.turn.started",
  "execution.assistant.message",
  "execution.tool.completed",
  "execution.usage.updated",
  "execution.turn.completed",
  "execution.turn.canceled",
  "execution.turn.interrupted",
  "execution.turn.failed",
  "execution.session.failed",
  "grading.session.started",
  "grading.turn.started",
  "grading.assistant.message",
  "grading.tool.completed",
  "grading.usage.updated",
  "grading.turn.completed",
  "grading.turn.canceled",
  "grading.turn.interrupted",
  "grading.turn.failed",
  "grading.session.failed",
] as const

export function subscribeToTestRun(
  runId: string,
  onEvent: (event: TestRunEvent) => void,
  onConnectionError: () => void,
): () => void {
  const source = new EventSource(`${runBaseUrl(runId)}/events`)
  const handleEvent = (rawEvent: Event) => {
    if (!(rawEvent instanceof MessageEvent)) return
    try {
      onEvent(JSON.parse(rawEvent.data) as TestRunEvent)
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
