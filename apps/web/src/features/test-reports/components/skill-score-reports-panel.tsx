import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { AlertTriangle, FileText, LoaderCircle } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  getSkillScoreReport,
  listSkillScoreReportEvents,
  listSkillScoreReports,
  type SkillScoreReportStatus,
} from "@/features/test-reports/api/skill-score-reports-api"
import { Button } from "@/shared/components/ui/button"

function formatTime(value: string | null, locale: string): string {
  return value
    ? new Intl.DateTimeFormat(locale, {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(new Date(value))
    : "—"
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
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<SkillScoreReportStatus | "">("")
  const [selectedId, setSelectedId] = useState<string | null>(initialReportId)
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
    enabled: selectedId !== null,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.pagination.hasMore ? last.pagination.nextBeforeSequence ?? undefined : undefined,
    refetchInterval: () => {
      const currentStatus = detail.data?.status ?? selectedFromList?.status
      return currentStatus === "PENDING" || currentStatus === "RUNNING"
        ? 1_500
        : false
    },
  })
  useEffect(() => {
    if (initialReportId) setSelectedId(initialReportId)
  }, [initialReportId])
  const eventRows = useMemo(
    () => (events.data?.pages ?? []).flatMap((item) => item.items).sort((a, b) => a.sequence - b.sequence),
    [events.data?.pages],
  )
  const report = detail.data ?? selectedFromList ?? null

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.5fr)] overflow-hidden">
      <aside className="min-h-0 overflow-auto border-r border-border-strong">
        <div className="flex items-center gap-2 border-b border-border-strong p-4">
          <select aria-label={t("skillScore.filters.status")} className="h-9 border border-border-default bg-background px-2 font-mono text-xs" onChange={(event) => { setStatus(event.target.value as SkillScoreReportStatus | ""); setPage(1) }} value={status}>
            <option value="">{t("skillScore.filters.all")}</option>
            {(["PENDING", "RUNNING", "AVAILABLE", "FAILED"] as const).map((item) => <option key={item} value={item}>{t(`skillScore.status.${item}`)}</option>)}
          </select>
        </div>
        {list.isPending ? <div className="p-5 text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{t("states.loading")}</div> : null}
        {list.isError ? <div className="p-5 text-sm text-destructive">{t("skillScore.loadError")}</div> : null}
        {(list.data?.items ?? []).map((item) => <button className={`block w-full border-b border-border-subtle p-4 text-left hover:bg-paper-muted ${selectedId === item.id ? "bg-paper-muted" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)} type="button">
          <strong className="font-mono text-xs">{t(`skillScore.status.${item.status}`)}</strong>
          <span className="ui-meta mt-1 block">RUN {item.runId.slice(0, 8)}</span>
          <span className="ui-meta mt-1 block">{formatTime(item.completedAt ?? item.createdAt, locale)}</span>
          {item.error ? <span className="mt-2 block text-xs text-destructive">{item.error.message}</span> : null}
        </button>)}
        <div className="flex justify-between p-3">
          <Button className="rounded-none" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} size="sm" type="button" variant="outline">{t("list.previous")}</Button>
          <Button className="rounded-none" disabled={page >= (list.data?.pagination.pageCount ?? 0)} onClick={() => setPage((value) => value + 1)} size="sm" type="button" variant="outline">{t("list.next")}</Button>
        </div>
      </aside>
      <div className="min-h-0 overflow-auto bg-paper-muted/20 p-5">
        {!selectedId ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("skillScore.emptySelection")}</div> : detail.isPending ? <div className="text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />{t("states.loadingDetail")}</div> : report ? <>
          <header className="border border-rule-soft bg-paper-raised p-4">
            <div className="flex items-center justify-between gap-4"><div><span className="ui-meta">RUN {report.runId}</span><h2 className="mt-1 text-lg font-bold">{t(`skillScore.status.${report.status}`)}</h2></div><FileText className="size-6 text-muted-foreground" /></div>
            {report.error ? <p className="mt-3 flex gap-2 text-sm text-destructive"><AlertTriangle className="size-4 shrink-0" />{report.error.code}: {report.error.message}</p> : null}
          </header>
          {report.status === "AVAILABLE" && report.documentUrl ? <iframe className="mt-4 h-[34rem] w-full border border-foreground bg-white" sandbox="" src={report.documentUrl} title={t("skillScore.iframeTitle")} /> : null}
          <section className="mt-4 border border-rule-soft bg-paper-raised p-4"><h3 className="font-mono text-xs font-bold uppercase">{t("skillScore.events")}</h3>{eventRows.map((event) => <article className="border-b border-border-subtle py-3 font-mono text-xs" key={event.sequence}><span className="text-muted-foreground">#{event.sequence} · {formatTime(event.occurredAt, locale)}</span><strong className="ml-3">{event.type}</strong>{Object.keys(event.payload).length ? <pre className="mt-2 whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{JSON.stringify(event.payload, null, 2)}</pre> : null}</article>)}{events.hasNextPage ? <Button className="mt-3 rounded-none" onClick={() => events.fetchNextPage()} size="sm" type="button" variant="outline">{t("skillScore.loadEarlier")}</Button> : null}</section>
        </> : <div className="text-sm text-destructive">{t("skillScore.loadError")}</div>}
      </div>
    </section>
  )
}
