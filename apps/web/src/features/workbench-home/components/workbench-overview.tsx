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
import type { LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"
import { MetricStrip } from "@/shared/components/layout/metric-strip"
import { WorkbenchPageHeader } from "@/shared/components/layout/workbench-page-header"

interface WorkbenchOverviewProps {
  workspace: SkillWorkspace
  copy: WorkbenchHomeCopy
  locale: string
}

function TodoPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <article className="border border-border-default bg-paper-raised p-5">
      <div className="flex items-center justify-between gap-4">
        <Icon className="size-5 text-technical" />
        <span className="ui-label border border-border-default bg-surface-muted px-2 py-1">
          TODO
        </span>
      </div>
      <strong className="mt-4 block text-[15px] leading-5">{title}</strong>
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
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
    <main className="h-full min-h-0 min-w-0 overflow-y-auto px-6 py-6 lg:px-8 lg:py-7">
      <WorkbenchPageHeader
        actions={
          <>
            <Button asChild className="h-10 rounded-none">
              <Link to={`/workbenches/${workspace.id}/versions`}>
                <PencilLine data-icon="inline-start" />
                {draft
                  ? dashboard.continueEditingDraft
                  : dashboard.viewSkillVersions}
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
          </>
        }
        description={dashboard.description}
        eyebrow={dashboard.eyebrow}
        icon={Activity}
        metrics={
          <div>
            <div className="ui-label mb-2">{dashboard.statusTitle}</div>
            <MetricStrip
              ariaLabel={dashboard.statusTitle}
              items={[
                {
                  hint: onlineLabels ?? dashboard.currentPublishedVersionHint,
                  label: dashboard.currentPublishedVersion,
                  value: online?.name ?? dashboard.noPublishedVersionValue,
                  tone: online ? "technical" : "default",
                },
                {
                  hint: dashboard.savedVersionsHint,
                  label: dashboard.savedVersions,
                  value: workspace.versionCount,
                },
                {
                  hint: draft
                    ? dashboard.recentUpdated(updatedAt)
                    : dashboard.createFromPublished,
                  label: dashboard.workingCopy,
                  value: draft
                    ? dashboard.revision(draft.contentRevision)
                    : dashboard.noActiveDraft,
                },
              ]}
            />
          </div>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{workspace.name}</span>
            {online ? (
              <span className="border border-technical/50 bg-technical/8 px-3 py-1.5 font-mono text-xs font-bold leading-5 text-technical-foreground">
                {dashboard.publishedVersion(online.name)}
              </span>
            ) : (
              <span className="border border-border-default bg-surface-muted px-3 py-1.5 font-mono text-xs font-normal leading-5 text-muted-foreground">
                {dashboard.noPublishedVersion}
              </span>
            )}
          </span>
        }
      />

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="ui-label">
            {dashboard.evidenceWorkspace}
          </h2>
          <span className="ui-meta">
            {dashboard.futureIteration}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
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

      <section className="mt-6 border border-border-default bg-surface-muted p-5">
        <div className="flex items-start gap-3">
          <Tags className="mt-0.5 size-5 text-technical" />
          <div>
            <strong className="text-[15px] leading-5">
              {dashboard.versionTagsTitle}
            </strong>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              {dashboard.versionTagsDescription}
            </p>
          </div>
          <CircleDashed className="ml-auto size-5 text-muted-foreground" />
        </div>
      </section>
    </main>
  )
}
