import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { AlertTriangle, ArrowLeft, ArrowRight, FileText, LoaderCircle } from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import {
  getSkillScoreReport,
  listSkillScoreReportEvents,
  listSkillScoreReports,
  type SkillScoreReportStatus,
} from "@/features/test-reports/api/skill-score-reports-api"
import { Button } from "@/shared/components/ui/button"

const SkillScoreMetricsComparison = lazy(() =>
  import("@/features/test-reports/components/skill-score-metrics").then(
    (module) => ({ default: module.SkillScoreMetricsComparison }),
  ),
)

function formatTime(value: string | null, locale: string): string {
  return value
    ? new Intl.DateTimeFormat(locale, {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(new Date(value))
    : "—"
}

const eventTranslationKeys: Record<
  string,
  | "skillScore.eventsByType.created"
  | "skillScore.eventsByType.started"
  | "skillScore.eventsByType.completed"
  | "skillScore.eventsByType.failed"
> = {
  "skill-score-report.created": "skillScore.eventsByType.created",
  "skill-score-report.analysis.started": "skillScore.eventsByType.started",
  "skill-score-report.analysis.completed": "skillScore.eventsByType.completed",
  "skill-score-report.analysis.failed": "skillScore.eventsByType.failed",
}

export function SkillScoreReportsPanel({
  workspaceId,
  locale,
  initialReportId,
}: {
  workspaceId: string
  locale: string
  initialReportId: string | null
}) {
  const { t } = useTranslation("testReports")
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<SkillScoreReportStatus | "">("")
  const selectedId = initialReportId
  const list = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "skill-score-reports", page, status],
    queryFn: () => listSkillScoreReports(workspaceId, page, status),
    refetchInterval: (current) => current.state.data?.items.some((item) => item.status === "PENDING" || item.status === "RUNNING") ? 2_000 : false,
  })
  const selectedFromList = list.data?.items.find((item) => item.id === selectedId)
  const detail = useQuery({
    queryKey: ["skill-score-reports", selectedId],
    queryFn: () => getSkillScoreReport(selectedId!),
    enabled: selectedId !== null,
    refetchInterval: (current) => current.state.data?.status === "PENDING" || current.state.data?.status === "RUNNING" ? 1_500 : false,
  })
  const events = useInfiniteQuery({
    queryKey: ["skill-score-reports", selectedId, "events"],
    queryFn: ({ pageParam }) => listSkillScoreReportEvents(selectedId!, pageParam),
    enabled:
      selectedId !== null &&
      (detail.data?.status ?? selectedFromList?.status) !== "AVAILABLE",
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.pagination.hasMore ? last.pagination.nextBeforeSequence ?? undefined : undefined,
    refetchInterval: () => {
      const currentStatus = detail.data?.status ?? selectedFromList?.status
      return currentStatus === "PENDING" || currentStatus === "RUNNING"
        ? 1_500
        : false
    },
  })
  const eventRows = useMemo(
    () => (events.data?.pages ?? []).flatMap((item) => item.items).sort((a, b) => a.sequence - b.sequence),
    [events.data?.pages],
  )
  const report = detail.data ?? selectedFromList ?? null
  const openDetail = (reportId: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete("tab")
    next.set("reportId", reportId)
    setSearchParams(next)
  }
  const returnToList = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("tab")
    next.delete("reportId")
    setSearchParams(next)
  }

  if (!selectedId) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-paper-muted/35 px-5 py-3">
          <select aria-label={t("skillScore.filters.status")} className="h-9 rounded-[10px] border border-border-default bg-background px-3 font-mono text-xs outline-none focus:border-focus-ring focus:ring-2 focus:ring-ring/15" onChange={(event) => { setStatus(event.target.value as SkillScoreReportStatus | ""); setPage(1) }} value={status}>
            <option value="">{t("skillScore.filters.all")}</option>
            {(["PENDING", "RUNNING", "AVAILABLE", "FAILED"] as const).map((item) => <option key={item} value={item}>{t(`skillScore.status.${item}`)}</option>)}
          </select>
        </div>
        {list.isPending ? <div className="p-5 text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{t("skillScore.states.loading")}</div> : null}
        {list.isError ? <div className="p-5 text-sm text-destructive">{t("skillScore.loadError")}</div> : null}
        {!list.isPending && !list.isError ? <div className="min-h-0 flex-1 overflow-auto">
          {(list.data?.items ?? []).map((item) => <button aria-label={`${t("skillScore.viewDetail")}: ${item.runId}`} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-6 border-b border-border-subtle bg-paper-raised px-5 py-4 text-left transition-colors hover:bg-paper-muted focus-visible:bg-paper-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/20" key={item.id} onClick={() => openDetail(item.id)} type="button">
            <span className="min-w-0">
              <strong className={`inline-flex rounded-lg px-2 py-1 font-mono text-xs ${item.status === "AVAILABLE" ? "bg-status-passed/10 text-status-passed" : item.status === "FAILED" ? "bg-destructive/10 text-destructive" : item.status === "RUNNING" ? "bg-technical/10 text-technical-foreground" : "bg-status-warning/10 text-status-warning"}`}>{t(`skillScore.status.${item.status}`)}</strong>
              <span className="ui-meta mt-1 block truncate">RUN {item.runId}</span>
              <span className="ui-meta mt-1 block">{formatTime(item.completedAt ?? item.createdAt, locale)}</span>
              {item.error ? <span className="mt-2 block text-xs text-destructive">{item.error.message}</span> : null}
            </span>
            <span className="flex items-center gap-2 self-center font-mono text-xs font-bold text-primary">
              {t("skillScore.viewDetail")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </span>
          </button>)}
          {(list.data?.items ?? []).length === 0 ? <div className="flex h-full items-center justify-center px-6 text-center"><div><FileText className="mx-auto size-7 text-technical" aria-hidden="true" /><h2 className="mt-3 text-base font-bold">{t("skillScore.empty.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("skillScore.empty.description")}</p></div></div> : null}
        </div> : null}
        <footer className="flex shrink-0 items-center justify-between border-t border-border bg-surface-muted px-5 py-3">
          <Button className="rounded-xl" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} size="sm" type="button" variant="outline">{t("skillScore.pagination.previous")}</Button>
          <Button className="rounded-xl" disabled={page >= (list.data?.pagination.pageCount ?? 0)} onClick={() => setPage((value) => value + 1)} size="sm" type="button" variant="outline">{t("skillScore.pagination.next")}</Button>
        </footer>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-paper-raised px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button className="rounded-xl" onClick={returnToList} size="sm" type="button" variant="outline"><ArrowLeft data-icon="inline-start" />{t("skillScore.backToList")}</Button>
          {report ? <div className="min-w-0"><span className="ui-meta block truncate">RUN {report.runId}</span><h2 className="mt-1 text-lg font-bold">{t(`skillScore.status.${report.status}`)}</h2></div> : null}
        </div>
        <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-paper-muted/20 p-5">
        {detail.isPending ? <div className="text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{t("skillScore.states.loadingDetail")}</div> : null}
        {detail.isError ? <div className="text-sm text-destructive">{t("skillScore.loadError")}</div> : null}
        {detail.data ? <div className="mx-auto max-w-[96rem]">
          <Suspense fallback={<div className="rounded-2xl border border-border bg-paper-raised p-5 text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{t("skillScore.states.loadingDetail")}</div>}>
            <SkillScoreMetricsComparison locale={locale} metrics={detail.data.metrics} />
          </Suspense>
          {detail.data.error ? <p className="mt-5 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="size-4 shrink-0" />{detail.data.error.code}: {detail.data.error.message}</p> : null}
          <section aria-labelledby="skill-score-analysis-title" className="mt-5">
            <div className="rounded-t-2xl border border-border bg-paper-raised px-5 py-4">
              <h3 className="text-base font-bold" id="skill-score-analysis-title">{t("skillScore.analysis")}</h3>
              {detail.data.status !== "AVAILABLE" ? <p className="mt-1 text-sm text-muted-foreground">{t("skillScore.analysisPending")}</p> : null}
            </div>
            {detail.data.status === "AVAILABLE" && detail.data.documentUrl ? <iframe className="h-[48rem] w-full rounded-b-2xl border-x border-b border-border bg-white" sandbox="" src={detail.data.documentUrl} title={t("skillScore.iframeTitle")} /> : <section aria-live={detail.data.status === "PENDING" || detail.data.status === "RUNNING" ? "polite" : undefined} className="rounded-b-2xl border-x border-b border-rule-soft bg-paper-raised p-4"><h4 className="font-mono text-xs font-bold uppercase">{t("skillScore.progress")}</h4>{eventRows.map((event) => {
              const eventKey = eventTranslationKeys[event.type]
              return <article className="border-b border-border-subtle py-3 text-xs" key={event.sequence}><span className="font-mono text-muted-foreground">#{event.sequence} · {formatTime(event.occurredAt, locale)}</span><strong className="ml-3">{eventKey ? t(eventKey) : event.type}</strong>{Object.keys(event.payload).length ? <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">{JSON.stringify(event.payload, null, 2)}</pre> : null}</article>
            })}{events.hasNextPage ? <Button className="mt-3 rounded-xl" onClick={() => events.fetchNextPage()} size="sm" type="button" variant="outline">{t("skillScore.loadEarlier")}</Button> : null}</section>}
          </section>
        </div> : null}
      </div>
    </section>
  )
}
