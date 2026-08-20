import { readApiError } from "@/shared/api/http"

export type SkillScoreReportStatus =
  | "PENDING"
  | "RUNNING"
  | "AVAILABLE"
  | "FAILED"

export interface SkillScoreReportSummary {
  id: string
  runId: string
  workspaceId: string
  status: SkillScoreReportStatus
  documentUrl: string | null
  error: { code: string; message: string } | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type SkillScoreMetricSubjectKind =
  | "without_skill"
  | "with_skill"
  | "skill_version"

export interface SkillScoreMetricUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalCostUsd: number
  durationMs: number
  durationApiMs: number
  numTurns: number
}

export interface SkillScoreMetricSubject {
  id: "first" | "second"
  kind: SkillScoreMetricSubjectKind
  displayName: string
  versionName: string | null
  versionNumber: number | null
  usage: SkillScoreMetricUsage | null
}

export interface SkillScoreMetrics {
  schemaVersion: "skill-score-metrics.v1"
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"
  subjects: [SkillScoreMetricSubject, SkillScoreMetricSubject]
  difference: {
    modelTokens: number | null
    totalCostUsd: number | null
    durationMs: number | null
    numTurns: number | null
  }
}

export interface SkillScoreReport extends SkillScoreReportSummary {
  metrics: SkillScoreMetrics
}

export interface SkillScoreReportEvent {
  sequence: number
  type: string
  reportId: string
  occurredAt: string
  payload: Record<string, unknown>
}

interface Page<T> {
  items: T[]
  pagination: {
    page?: number
    pageSize?: number
    total?: number
    pageCount?: number
    limit?: number
    hasMore?: boolean
    nextBeforeSequence?: number | null
  }
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as T
}

export function listSkillScoreReports(
  workspaceId: string,
  page: number,
  status: SkillScoreReportStatus | "",
): Promise<Page<SkillScoreReportSummary>> {
  const query = new URLSearchParams({ page: String(page), pageSize: "20" })
  if (status) query.set("status", status)
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/skill-score-reports?${query}`,
  )
}

export function getSkillScoreReport(reportId: string): Promise<SkillScoreReport> {
  return readJson(`/api/skill-score-reports/${encodeURIComponent(reportId)}`)
}

export function listSkillScoreReportEvents(
  reportId: string,
  beforeSequence?: number,
): Promise<Page<SkillScoreReportEvent>> {
  const query = new URLSearchParams({ limit: "100" })
  if (beforeSequence !== undefined) query.set("beforeSequence", String(beforeSequence))
  return readJson(`/api/skill-score-reports/${encodeURIComponent(reportId)}/events?${query}`)
}
