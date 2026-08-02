import {
  Activity,
  CircleDashed,
  FileChartColumn,
  Files,
  FlaskConical,
  GitCompareArrows,
  PencilLine,
  Tags,
} from "lucide-react"
import { Link } from "react-router-dom"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"

interface WorkbenchOverviewProps {
  workspace: SkillWorkspace
  copy: WorkbenchHomeCopy
  locale: string
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <article className="min-w-0 border-r border-rule-soft px-5 py-5 last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      <strong className="mt-2 block truncate text-lg">{value}</strong>
      {hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </article>
  )
}

function TodoPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Activity
  title: string
  description: string
}) {
  return (
    <article className="border border-rule bg-paper-raised p-5">
      <div className="flex items-center justify-between gap-4">
        <Icon className="size-5 text-technical" />
        <span className="border border-rule bg-paper-muted px-2 py-1 font-mono text-[9px] text-muted-foreground uppercase">
          TODO
        </span>
      </div>
      <strong className="mt-4 block text-sm">{title}</strong>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </article>
  )
}

export function WorkbenchOverview({
  copy,
  workspace,
  locale,
}: WorkbenchOverviewProps) {
  const draft = workspace.activeDraft
  const online = workspace.onlineVersion
  const dashboard = copy.overviewDashboard
  const updatedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(workspace.updatedAt))
  const onlineLabels = online?.labels.length
    ? new Intl.ListFormat(locale, {
        style: "short",
        type: "conjunction",
      }).format(online.labels)
    : null

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto px-8 py-7">
      <header>
        <div className="font-mono text-[11px] font-bold tracking-[0.1em] text-signal-dark uppercase">
          {dashboard.eyebrow}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[clamp(2rem,3vw,3rem)] leading-none font-[780] tracking-[-0.04em]">
            {workspace.name}
          </h1>
          {online ? (
            <span className="border border-technical/50 bg-technical/8 px-3 py-1.5 font-mono text-[10px] font-bold text-technical-foreground">
              {dashboard.publishedVersion(online.name)}
            </span>
          ) : (
            <span className="border border-rule bg-paper-muted px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
              {dashboard.noPublishedVersion}
            </span>
          )}
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {dashboard.description}
        </p>
      </header>

      <section className="mt-7 border border-foreground bg-paper-raised">
        <h2 className="border-b border-rule px-5 py-3 font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {dashboard.statusTitle}
        </h2>
        <div className="grid grid-cols-3">
          <Metric
            hint={onlineLabels ?? dashboard.currentPublishedVersionHint}
            label={dashboard.currentPublishedVersion}
            value={online?.name ?? dashboard.noPublishedVersionValue}
          />
          <Metric
            hint={dashboard.savedVersionsHint}
            label={dashboard.savedVersions}
            value={workspace.versionCount}
          />
          <Metric
            hint={
              draft
                ? dashboard.recentUpdated(updatedAt)
                : dashboard.createFromPublished
            }
            label={dashboard.workingCopy}
            value={
              draft
                ? dashboard.revision(draft.contentRevision)
                : dashboard.noActiveDraft
            }
          />
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button asChild className="h-10 rounded-none">
          <Link to={`/workbenches/${workspace.id}/versions`}>
            <PencilLine data-icon="inline-start" />
            {draft ? dashboard.continueEditingDraft : dashboard.viewSkillVersions}
          </Link>
        </Button>
        {workspace.versionCount >= 2 ? (
          <Button asChild className="h-10 rounded-none" variant="outline">
            <Link to={`/workbenches/${workspace.id}/versions/compare`}>
              <GitCompareArrows data-icon="inline-start" />
              {dashboard.compareVersions}
            </Link>
          </Button>
        ) : null}
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-mono text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {dashboard.evidenceWorkspace}
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {dashboard.futureIteration}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <TodoPanel
            description={dashboard.cards.testCases.description}
            icon={FlaskConical}
            title={dashboard.cards.testCases.title}
          />
          <TodoPanel
            description={dashboard.cards.datasets.description}
            icon={Files}
            title={dashboard.cards.datasets.title}
          />
          <TodoPanel
            description={dashboard.cards.testRuns.description}
            icon={Activity}
            title={dashboard.cards.testRuns.title}
          />
          <TodoPanel
            description={dashboard.cards.comparisonReports.description}
            icon={FileChartColumn}
            title={dashboard.cards.comparisonReports.title}
          />
        </div>
      </section>

      <section className="mt-6 border border-rule bg-paper-muted p-5">
        <div className="flex items-start gap-3">
          <Tags className="mt-0.5 size-5 text-technical" />
          <div>
            <strong className="text-sm">{dashboard.versionTagsTitle}</strong>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {dashboard.versionTagsDescription}
            </p>
          </div>
          <CircleDashed className="ml-auto size-5 text-muted-foreground" />
        </div>
      </section>
    </main>
  )
}
