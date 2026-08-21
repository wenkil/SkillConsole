import {
  Activity,
  ArrowRight,
  CircleDashed,
  FileChartColumn,
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

function ModuleEntry({
  icon: Icon,
  title,
  description,
  to,
}: {
  icon: LucideIcon
  title: string
  description: string
  to: string
}) {
  return (
    <Link
      aria-label={title}
      className="group grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/55 focus-visible:bg-accent/55"
      to={to}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-technical/10 text-technical">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.7} />
      </span>
      <span className="min-w-0">
        <strong className="block text-[15px] leading-5">{title}</strong>
        <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="size-4 text-muted-foreground group-hover:text-primary"
      />
    </Link>
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
            {online ? (
              <span className="rounded-full bg-technical/10 px-3 py-1.5 text-xs font-bold leading-5 text-technical-foreground">
                {dashboard.publishedVersion(online.name)}
              </span>
            ) : (
              <span className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-medium leading-5 text-muted-foreground">
                {dashboard.noPublishedVersion}
              </span>
            )}
            <Button asChild className="h-10">
              <Link to={`/workbenches/${workspace.id}/versions`}>
                <PencilLine data-icon="inline-start" />
                {draft
                  ? dashboard.continueEditingDraft
                  : dashboard.viewSkillVersions}
              </Link>
            </Button>
            {workspace.versionCount >= 2 ? (
              <Button asChild className="h-10" variant="outline">
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
        title={workspace.name}
      />

      <section className="mt-6 overflow-hidden rounded-[var(--surface-radius)] border border-border bg-card shadow-[var(--surface-shadow-soft)]">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">
            {dashboard.evidenceWorkspace}
          </h2>
        </div>
        <div className="divide-y divide-border-subtle">
          <ModuleEntry
            description={dashboard.cards.testCases.description}
            icon={FlaskConical}
            title={dashboard.cards.testCases.title}
            to={`/workbenches/${workspace.id}/test-cases`}
          />
          <ModuleEntry
            description={dashboard.cards.testRuns.description}
            icon={Activity}
            title={dashboard.cards.testRuns.title}
            to={`/workbenches/${workspace.id}/runs`}
          />
          <ModuleEntry
            description={dashboard.cards.comparisonReports.description}
            icon={FileChartColumn}
            title={dashboard.cards.comparisonReports.title}
            to={`/workbenches/${workspace.id}/reports`}
          />
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-surface-muted p-5">
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
