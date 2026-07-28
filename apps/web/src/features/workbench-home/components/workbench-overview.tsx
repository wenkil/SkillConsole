import {
  ArrowRight,
  Baseline,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  FileStack,
  Fingerprint,
  FlaskConical,
  GitBranch,
  PackageCheck,
  PencilLine,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"

interface WorkbenchOverviewProps {
  workspace: SkillWorkspace
  copy: WorkbenchHomeCopy
  locale: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function StatusCell({
  label,
  value,
  muted = false,
}: {
  label: string
  value: React.ReactNode
  muted?: boolean
}) {
  return (
    <article className="min-w-0 border-r border-b border-rule-soft px-5 py-5 [container-type:inline-size] [&:nth-child(3n)]:border-r-0 [&:nth-child(n+4)]:border-b-0">
      <span className="block font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <strong
        className={
          muted
            ? "mt-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground"
            : "mt-2 block min-w-0 truncate text-lg font-semibold"
        }
      >
        {value}
      </strong>
    </article>
  )
}

function CycleStep({
  number,
  title,
  value,
  todo = false,
}: {
  number: string
  title: string
  value: string
  todo?: boolean
}) {
  return (
    <article className="relative min-w-0 flex-1 px-4 py-4">
      <span className="block font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
        STEP {number} · {title}
      </span>
      <strong
        className={
          todo
            ? "mt-1.5 flex items-center gap-2 text-sm text-muted-foreground"
            : "mt-1.5 block truncate text-sm"
        }
      >
        {todo ? <CircleDashed aria-hidden="true" className="size-3.5" /> : null}
        {value}
      </strong>
    </article>
  )
}

export function WorkbenchOverview({
  workspace,
  copy,
  locale,
}: WorkbenchOverviewProps) {
  const { t } = useTranslation("workbenchHome")
  const version = workspace.currentVersion
  const candidate = workspace.activeDraft
  const content = candidate ?? version
  if (!content) {
    return (
      <main className="h-full min-h-0 min-w-0 overflow-y-auto px-10 py-9">
        <p className="text-sm text-muted-foreground">
          {copy.noFormalVersion}
        </p>
      </main>
    )
  }

  const snapshot = content.snapshot
  const currentVersionLabel = version
    ? `V${version.versionNumber} · ${t("overview.dashboard.published")}`
    : copy.noFormalVersion
  const candidateLabel = candidate
    ? t("overview.dashboard.draftRevision", {
        revision: candidate.contentRevision,
      })
    : t("overview.dashboard.noActiveDraft")
  const recordedAtSource =
    candidate?.updatedAt ?? version?.publishedAt ?? workspace.createdAt
  const recordedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(recordedAtSource))

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto px-8 py-7">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.1em] text-signal-dark uppercase">
            <PackageCheck aria-hidden="true" className="size-3.5" />
            {copy.overviewEyebrow}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[clamp(2rem,3vw,3rem)] leading-none font-[780] tracking-[-0.04em]">
              {workspace.name}
            </h1>
            <span className="inline-flex h-7 items-center gap-2 border border-technical/50 bg-technical/8 px-3 font-mono text-[10px] font-bold text-technical-foreground uppercase">
              <CircleDashed aria-hidden="true" className="size-3" />
              {t("overview.dashboard.releaseGateTodo")}
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {copy.overviewDescription}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground uppercase">
          {candidate
            ? t("overview.dashboard.viewingDraft")
            : t("overview.dashboard.viewingFormal")}
        </span>
      </header>

      <section className="mt-7 border border-foreground bg-paper-raised">
        <h2 className="border-b border-rule px-5 py-3 font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {t("overview.dashboard.statusTitle")}
        </h2>
        <div className="grid grid-cols-3">
          <StatusCell
            label={t("overview.dashboard.currentFormal")}
            value={currentVersionLabel}
          />
          <StatusCell
            label={t("overview.dashboard.defaultBaseline")}
            value={
              version?.isDefaultBaseline
                ? `V${version.versionNumber} · ${t("overview.dashboard.baselineReady")}`
                : t("overview.dashboard.notEstablished")
            }
          />
          <StatusCell
            label={t("overview.dashboard.activeDraft")}
            value={candidateLabel}
          />
          <StatusCell
            label={t("overview.dashboard.releaseGate")}
            muted
            value={
              <>
                <CircleDashed aria-hidden="true" className="size-3.5" />
                {t("overview.dashboard.todo")}
              </>
            }
          />
          <StatusCell
            label={t("overview.dashboard.latestRun")}
            muted
            value={
              <>
                <FlaskConical aria-hidden="true" className="size-3.5" />
                {t("overview.dashboard.noRuns")}
              </>
            }
          />
          <StatusCell
            label={t("overview.dashboard.currentContext")}
            value={
              candidate
                ? t("overview.dashboard.draftContext")
                : t("overview.dashboard.formalContext")
            }
          />
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button asChild className="h-10 rounded-none">
          <Link to={`/workbenches/${workspace.id}/versions`}>
            <PencilLine aria-hidden="true" data-icon="inline-start" />
            {candidate
              ? t("overview.dashboard.continueDraft")
              : t("overview.dashboard.openVersions")}
          </Link>
        </Button>
        <Button className="h-10 rounded-none" disabled type="button" variant="outline">
          <FlaskConical aria-hidden="true" data-icon="inline-start" />
          {t("overview.dashboard.draftTestTodo")}
        </Button>
        <Button className="h-10 rounded-none" disabled type="button" variant="outline">
          <CheckCircle2 aria-hidden="true" data-icon="inline-start" />
          {t("overview.dashboard.publishTodo")}
        </Button>
        <span className="ml-1 font-mono text-[10px] text-muted-foreground uppercase">
          TODO · {t("overview.dashboard.todoHint")}
        </span>
      </div>

      <section className="mt-5 border border-foreground bg-paper-raised">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3">
          <h2 className="font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {t("overview.dashboard.cycleTitle")}
          </h2>
          <span className="border border-rule bg-paper-muted px-2 py-1 font-mono text-[9px] font-bold text-muted-foreground uppercase">
            {candidate
              ? t("overview.dashboard.drafting")
              : t("overview.dashboard.noDraft")}
          </span>
        </div>
        <div className="flex divide-x divide-rule-soft">
          <CycleStep
            number="01"
            title={t("overview.dashboard.stepDraft")}
            value={candidateLabel}
          />
          <ArrowRight
            aria-hidden="true"
            className="my-auto size-4 shrink-0 -translate-x-1/2 bg-paper-raised text-muted-foreground"
          />
          <CycleStep
            number="02"
            title={t("overview.dashboard.stepTest")}
            todo
            value={t("overview.dashboard.todo")}
          />
          <ArrowRight
            aria-hidden="true"
            className="my-auto size-4 shrink-0 -translate-x-1/2 bg-paper-raised text-muted-foreground"
          />
          <CycleStep
            number="03"
            title={t("overview.dashboard.stepRegression")}
            todo
            value={t("overview.dashboard.todo")}
          />
          <ArrowRight
            aria-hidden="true"
            className="my-auto size-4 shrink-0 -translate-x-1/2 bg-paper-raised text-muted-foreground"
          />
          <CycleStep
            number="04"
            title={t("overview.dashboard.stepGate")}
            todo
            value={t("overview.dashboard.todo")}
          />
          <ArrowRight
            aria-hidden="true"
            className="my-auto size-4 shrink-0 -translate-x-1/2 bg-paper-raised text-muted-foreground"
          />
          <CycleStep
            number="05"
            title={t("overview.dashboard.stepPublish")}
            todo
            value={t("overview.dashboard.todo")}
          />
        </div>
      </section>

      <section className="mt-5 border border-foreground bg-paper-raised">
        <h2 className="border-b border-rule px-5 py-3 font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {t("overview.dashboard.recentRuns")}
        </h2>
        <div className="flex min-h-28 items-center justify-center px-6 py-7 text-center">
          <div>
            <CircleDashed
              aria-hidden="true"
              className="mx-auto size-6 text-muted-foreground"
            />
            <strong className="mt-3 block text-sm">
              TODO · {t("overview.dashboard.recentRunsEmpty")}
            </strong>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("overview.dashboard.recentRunsHint")}
            </p>
          </div>
        </div>
      </section>

      <details className="group mt-5 border border-rule bg-paper-muted">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-mono text-[11px] font-bold tracking-[0.04em] uppercase">
          <span className="flex items-center gap-2">
            <Fingerprint aria-hidden="true" className="size-4 text-technical" />
            {t("overview.dashboard.technicalInfo")}
          </span>
          <span className="text-muted-foreground group-open:hidden">
            {t("overview.dashboard.expand")}
          </span>
          <span className="hidden text-muted-foreground group-open:inline">
            {t("overview.dashboard.collapse")}
          </span>
        </summary>
        <div className="grid grid-cols-4 border-t border-rule bg-paper-raised">
          <article className="border-r border-rule-soft p-4">
            <FileStack aria-hidden="true" className="size-4 text-technical" />
            <span className="mt-3 block font-mono text-[9px] text-muted-foreground uppercase">
              {copy.fileCount}
            </span>
            <strong className="mt-1 block text-sm">{snapshot.fileCount}</strong>
          </article>
          <article className="border-r border-rule-soft p-4">
            <GitBranch aria-hidden="true" className="size-4 text-technical" />
            <span className="mt-3 block font-mono text-[9px] text-muted-foreground uppercase">
              {copy.totalSize}
            </span>
            <strong className="mt-1 block text-sm">
              {formatBytes(snapshot.totalBytes)}
            </strong>
          </article>
          <article className="border-r border-rule-soft p-4">
            <Baseline aria-hidden="true" className="size-4 text-technical" />
            <span className="mt-3 block font-mono text-[9px] text-muted-foreground uppercase">
              {copy.sourceName}
            </span>
            <strong className="mt-1 block truncate text-sm">
              {content.sourceName}
            </strong>
          </article>
          <article className="p-4">
            <CalendarClock aria-hidden="true" className="size-4 text-technical" />
            <span className="mt-3 block font-mono text-[9px] text-muted-foreground uppercase">
              {copy.publishedAt}
            </span>
            <strong className="mt-1 block text-sm">{recordedAt}</strong>
          </article>
          <article className="col-span-4 border-t border-rule-soft px-4 py-3">
            <span className="font-mono text-[9px] text-muted-foreground uppercase">
              {copy.manifestHash}
            </span>
            <code
              className="ml-3 text-[10px] [overflow-wrap:anywhere]"
              title={snapshot.manifestHash}
            >
              sha256:{snapshot.manifestHash}
            </code>
          </article>
        </div>
      </details>
    </main>
  )
}
