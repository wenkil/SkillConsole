import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckSquare2,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  LoaderCircle,
  RotateCcw,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, Navigate } from "react-router-dom"

import {
  testReportAnalysisDocumentUrl,
  testReportDocumentUrl,
} from "@/features/test-reports/api/test-reports-api"
import { TestReportStatusBadge } from "@/features/test-reports/components/test-report-status"
import {
  useTestReportByRun,
  useTestReportAnalyzerController,
  useTestReportDetailController,
} from "@/features/test-reports/hooks/use-test-reports-controller"
import {
  isTestReportAnalysisAvailable,
  isTestReportDocumentReady,
} from "@/features/test-reports/model/test-report"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

export function TestReportDetailView({
  workspace,
  locale,
  reportId,
}: {
  workspace: SkillWorkspace
  locale: string
  reportId: string
}) {
  const { t } = useTranslation("testReports")
  const controller = useTestReportDetailController(reportId)
  const analyzer = useTestReportAnalyzerController(reportId, controller.report)
  const [activeTab, setActiveTab] = useState<"facts" | "analysis">("facts")

  if (controller.loading) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-xs">
        <LoaderCircle className="size-4 animate-spin" />
        {t("states.loadingDetail")}
      </main>
    )
  }
  if (controller.error || !controller.report) {
    return (
      <main className="flex h-full items-center justify-center px-8">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <h1 className="mt-3 text-lg font-[760]">{t("states.detailError")}</h1>
          <Button
            className="mt-4 rounded-none"
            onClick={controller.actions.retry}
            type="button"
            variant="outline"
          >
            <RotateCcw data-icon="inline-start" />
            {t("states.retry")}
          </Button>
        </div>
      </main>
    )
  }
  const report = controller.report
  const ready = isTestReportDocumentReady(report)
  const htmlUrl = ready
    ? testReportDocumentUrl(
        report.id,
        report.currentRevisionId!,
        locale,
        "html",
      )
    : null
  const htmlDownloadUrl = ready
    ? testReportDocumentUrl(
        report.id,
        report.currentRevisionId!,
        locale,
        "html",
        true,
      )
    : null
  const markdownUrl = ready
    ? testReportDocumentUrl(
        report.id,
        report.currentRevisionId!,
        locale,
        "markdown",
        true,
      )
    : null

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground bg-background px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground hover:text-foreground"
              to={`/workbenches/${workspace.id}/reports`}
            >
              <ArrowLeft className="size-3" />
              {t("detail.back")}
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-[790] tracking-[-0.03em]">
                {report.report?.title ??
                  `${report.baselineLabel} → ${report.targetLabel}`}
              </h1>
              <TestReportStatusBadge status={report.status} />
              <span className="border border-rule px-2 py-1 font-mono text-[9px] font-bold">
                {t(`type.${report.reportType}`)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[8px] text-muted-foreground">
              REPORT {report.id} · RUN {report.runId}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="rounded-none" size="sm" variant="outline">
              <Link to={`/workbenches/${workspace.id}/runs/${report.runId}`}>
                <ExternalLink data-icon="inline-start" />
                {t("detail.openRun")}
              </Link>
            </Button>
            {activeTab === "facts" && htmlDownloadUrl ? (
              <Button asChild className="rounded-none" size="sm" variant="outline">
                <a href={htmlDownloadUrl}>
                  <FileCode2 data-icon="inline-start" />
                  {t("detail.downloadHtml")}
                </a>
              </Button>
            ) : null}
            {activeTab === "facts" && markdownUrl ? (
              <Button asChild className="rounded-none" size="sm" variant="outline">
                <a href={markdownUrl}>
                  <Download data-icon="inline-start" />
                  {t("detail.downloadMarkdown")}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div
        aria-label={t("detail.tabs.label")}
        className="flex shrink-0 border-b border-foreground bg-paper-muted px-5"
        role="tablist"
      >
        {(["facts", "analysis"] as const).map((tab) => (
          <button
            aria-controls={`test-report-${tab}-panel`}
            aria-selected={activeTab === tab}
            className={`border-x border-t px-4 py-2.5 font-mono text-[10px] font-bold uppercase transition-colors ${
              activeTab === tab
                ? "border-foreground bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            disabled={tab === "analysis" && !ready}
            id={`test-report-${tab}-tab`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            type="button"
          >
            {tab === "analysis" ? <Bot className="mr-1.5 inline size-3" /> : null}
            {t(`detail.tabs.${tab}`)}
            {tab === "analysis" && report.analysisStatus !== "NOT_REQUESTED" ? (
              <span className="ml-2 border border-current px-1 py-0.5 text-[8px]">
                {t(`analysis.status.${report.analysisStatus}`)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === "facts" ? (
        <section
          aria-labelledby="test-report-facts-tab"
          className="flex min-h-0 flex-1"
          id="test-report-facts-panel"
          role="tabpanel"
        >
          {ready && htmlUrl ? (
            <iframe
              className="min-h-0 flex-1 border-0 bg-[#f5f1e8]"
              sandbox="allow-top-navigation-by-user-activation"
              src={htmlUrl}
              title={t("detail.documentTitle")}
            />
          ) : (
            <section className="flex min-h-0 flex-1 items-center justify-center p-8">
              <div className="max-w-lg border border-rule bg-paper-raised p-8 text-center">
                {report.status === "GENERATION_PENDING" ? (
                  <LoaderCircle className="mx-auto size-9 animate-spin text-technical" />
                ) : (
                  <AlertTriangle className="mx-auto size-9 text-status-failed" />
                )}
                <h2 className="mt-4 text-lg font-[760]">
                  {t(`detail.unavailable.${report.status}.title`)}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {report.generationError?.message ??
                    t(`detail.unavailable.${report.status}.description`)}
                </p>
                {controller.mutationError ? (
                  <p className="mt-3 text-xs text-destructive" role="alert">
                    {controller.mutationError}
                  </p>
                ) : null}
                {report.status === "GENERATION_FAILED" ? (
                  <Button
                    className="mt-4 rounded-none"
                    disabled={controller.regenerating}
                    onClick={() =>
                      void controller.actions.regenerate().catch(() => undefined)
                    }
                    type="button"
                    variant="outline"
                  >
                    {controller.regenerating ? (
                      <LoaderCircle
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <RotateCcw data-icon="inline-start" />
                    )}
                    {t("detail.regenerate")}
                  </Button>
                ) : null}
              </div>
            </section>
          )}
        </section>
      ) : (
        <AnalyzerPanel controller={analyzer} locale={locale} />
      )}
      <footer className="flex shrink-0 items-center gap-2 border-t border-foreground bg-paper-muted px-4 py-2 font-mono text-[8px] text-muted-foreground">
        <FileText className="size-3" />
        {t(
          activeTab === "facts"
            ? "detail.staticNotice"
            : "analysis.generatedNotice",
        )}
      </footer>
    </main>
  )
}

function AnalyzerPanel({
  controller,
  locale,
}: {
  controller: ReturnType<typeof useTestReportAnalyzerController>
  locale: string
}) {
  const { t } = useTranslation("testReports")
  const analysis = controller.selectedAnalysis
  const available = isTestReportAnalysisAvailable(analysis)
  const htmlUrl = available && analysis
    ? testReportAnalysisDocumentUrl(analysis.id, locale, "html")
    : null
  const htmlDownloadUrl = available && analysis
    ? testReportAnalysisDocumentUrl(analysis.id, locale, "html", true)
    : null
  const markdownUrl = available && analysis
    ? testReportAnalysisDocumentUrl(analysis.id, locale, "markdown", true)
    : null

  return (
    <section
      aria-labelledby="test-report-analysis-tab"
      className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_minmax(0,1fr)] overflow-hidden"
      id="test-report-analysis-panel"
      role="tabpanel"
    >
      <aside className="min-h-0 overflow-y-auto border-r border-foreground bg-paper-muted p-4">
        <div className="border border-technical/50 bg-technical/6 p-3">
          <div className="flex items-start gap-2">
            <Bot className="mt-0.5 size-4 shrink-0 text-technical" />
            <div>
              <h2 className="text-sm font-[760]">{t("analysis.title")}</h2>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                {t("analysis.disclaimer")}
              </p>
            </div>
          </div>
        </div>

        {controller.analyses.length > 0 ? (
          <label className="mt-4 block">
            <span className="font-mono text-[9px] font-bold uppercase">
              {t("analysis.revision.label")}
            </span>
            <select
              aria-label={t("analysis.revision.label")}
              className="mt-1.5 h-9 w-full border border-rule bg-background px-2 font-mono text-[10px]"
              onChange={(event) =>
                controller.actions.selectAnalysis(event.target.value)
              }
              value={controller.selectedAnalysisId ?? ""}
            >
              {controller.analyses.map((item) => (
                <option key={item.id} value={item.id}>
                  {t("analysis.revision.option", {
                    revision: item.revisionNumber,
                    status: t(`analysis.status.${item.status}`),
                  })}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <h3 className="font-mono text-[9px] font-bold uppercase">
            {t("analysis.selection.title")}
          </h3>
          <span className="font-mono text-[8px] text-muted-foreground">
            {t("analysis.selection.count", {
              selected: controller.selectedCaseIds.length,
              total: controller.selectableCases.length,
            })}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          {t("analysis.selection.description")}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button
            className="h-7 rounded-none px-2 text-[9px]"
            onClick={controller.actions.selectDefaultCases}
            type="button"
            variant="outline"
          >
            {t("analysis.selection.default")}
          </Button>
          <Button
            className="h-7 rounded-none px-2 text-[9px]"
            onClick={controller.actions.selectAllCases}
            type="button"
            variant="outline"
          >
            {t("analysis.selection.all")}
          </Button>
          <Button
            className="h-7 rounded-none px-2 text-[9px]"
            onClick={controller.actions.clearCases}
            type="button"
            variant="outline"
          >
            {t("analysis.selection.clear")}
          </Button>
        </div>
        <div className="mt-2 grid gap-1.5">
          {controller.selectableCases.map((item) => (
            <label
              className="flex cursor-pointer items-start gap-2 border border-rule-soft bg-background px-2.5 py-2 text-[10px]"
              key={item.evalRevisionCaseId}
            >
              <input
                checked={controller.selectedCaseIds.includes(
                  item.evalRevisionCaseId,
                )}
                className="mt-0.5"
                onChange={() =>
                  controller.actions.toggleCase(item.evalRevisionCaseId)
                }
                type="checkbox"
              />
              <span className="min-w-0">
                <strong className="block truncate">
                  #{item.externalId} · {item.name}
                </strong>
                <span className="font-mono text-[8px] text-muted-foreground">
                  {item.issueIds.length > 0
                    ? t("analysis.selection.issues", {
                        count: item.issueIds.length,
                      })
                    : t("analysis.selection.noIssues")}
                </span>
              </span>
            </label>
          ))}
        </div>
        {controller.selectableCases.length === 0 ? (
          <p className="mt-2 border border-rule-soft bg-background p-3 text-[10px] text-muted-foreground">
            {t("analysis.selection.unavailable")}
          </p>
        ) : null}
        {controller.mutationError ? (
          <p className="mt-3 text-[10px] text-destructive" role="alert">
            {controller.mutationError}
          </p>
        ) : null}
        <Button
          className="mt-4 w-full rounded-none"
          disabled={
            controller.creating ||
            controller.analysisActive ||
            controller.selectedCaseIds.length === 0
          }
          onClick={() =>
            void controller.actions.create().catch(() => undefined)
          }
          type="button"
        >
          {controller.creating ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <CheckSquare2 data-icon="inline-start" />
          )}
          {t(
            controller.analyses.length > 0
              ? "analysis.generateAgain"
              : "analysis.generate",
          )}
        </Button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col bg-background">
        {controller.loading || controller.detailLoading ? (
          <AnalysisCenteredState icon="loading" title={t("analysis.loading")} />
        ) : controller.error ? (
          <AnalysisCenteredState
            action={
              <Button
                className="mt-4 rounded-none"
                onClick={controller.actions.retry}
                type="button"
                variant="outline"
              >
                <RotateCcw data-icon="inline-start" />
                {t("states.retry")}
              </Button>
            }
            description={t("analysis.loadErrorDescription")}
            icon="error"
            title={t("analysis.loadError")}
          />
        ) : !analysis ? (
          <AnalysisCenteredState
            description={t("analysis.emptyDescription")}
            icon="empty"
            title={t("analysis.emptyTitle")}
          />
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper-raised px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">
                    {t("analysis.revision.title", {
                      revision: analysis.revisionNumber,
                    })}
                  </strong>
                  <span className="border border-rule px-2 py-1 font-mono text-[8px] font-bold">
                    {t(`analysis.status.${analysis.status}`)}
                  </span>
                  <span className="border border-technical/50 bg-technical/6 px-2 py-1 font-mono text-[8px] font-bold text-technical">
                    {t("analysis.modelGenerated")}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                  {t("analysis.meta", {
                    model: analysis.modelId || "—",
                    configuredModel: analysis.configuredModelId || "—",
                    prompt: analysis.promptVersion || "—",
                    count: analysis.selectedEvalRevisionCaseIds.length,
                  })}
                </p>
                <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                  {t("analysis.runtimePolicy", {
                    schema: analysis.runtimePolicy.schemaVersion,
                    budget: analysis.runtimePolicy.maxBudgetUsd.toFixed(2),
                    timeout: formatAnalysisDuration(
                      analysis.runtimePolicy.timeoutMs,
                    ),
                  })}
                </p>
                {analysis.usage ? (
                  <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                    {t("analysis.usage", {
                      input: analysis.usage.inputTokens.toLocaleString(),
                      output: analysis.usage.outputTokens.toLocaleString(),
                      cost: analysis.usage.totalCostUsd.toFixed(4),
                      duration: formatAnalysisDuration(analysis.usage.durationMs),
                      turns: analysis.usage.numTurns,
                    })}
                  </p>
                ) : null}
              </div>
              {available ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    asChild
                    className="rounded-none"
                    size="sm"
                    variant="outline"
                  >
                    <a href={htmlDownloadUrl!}>
                      <FileCode2 data-icon="inline-start" />
                      {t("analysis.downloadHtml")}
                    </a>
                  </Button>
                  <Button
                    asChild
                    className="rounded-none"
                    size="sm"
                    variant="outline"
                  >
                    <a href={markdownUrl!}>
                      <Download data-icon="inline-start" />
                      {t("analysis.downloadMarkdown")}
                    </a>
                  </Button>
                </div>
              ) : null}
            </div>
            {available && htmlUrl ? (
              <iframe
                className="min-h-0 flex-1 border-0 bg-[#f5f1e8]"
                sandbox="allow-top-navigation-by-user-activation"
                src={htmlUrl}
                title={t("analysis.documentTitle", {
                  revision: analysis.revisionNumber,
                })}
              />
            ) : analysis.status === "FAILED" ? (
              <AnalysisCenteredState
                action={
                  <Button
                    className="mt-4 rounded-none"
                    disabled={
                      controller.creating || controller.analysisActive
                    }
                    onClick={() =>
                      void controller.actions
                        .create(analysis.selectedEvalRevisionCaseIds)
                        .catch(() => undefined)
                    }
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw data-icon="inline-start" />
                    {t("analysis.retry")}
                  </Button>
                }
                description={
                  analysis.error?.message ?? t("analysis.failedDescription")
                }
                icon="error"
                title={t("analysis.failedTitle")}
              />
            ) : (
              <AnalysisCenteredState
                description={t("analysis.runningDescription")}
                icon="loading"
                title={t(
                  analysis.status === "PENDING"
                    ? "analysis.pendingTitle"
                    : "analysis.runningTitle",
                )}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

function AnalysisCenteredState({
  action,
  description,
  icon,
  title,
}: {
  action?: React.ReactNode
  description?: string
  icon: "empty" | "error" | "loading"
  title: string
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-md">
        {icon === "loading" ? (
          <LoaderCircle className="mx-auto size-9 animate-spin text-technical" />
        ) : icon === "error" ? (
          <AlertTriangle className="mx-auto size-9 text-status-failed" />
        ) : (
          <Bot className="mx-auto size-9 text-muted-foreground" />
        )}
        <h2 className="mt-4 text-lg font-[760]">{title}</h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action}
      </div>
    </div>
  )
}

function formatAnalysisDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`
  return `${(value / 1_000).toFixed(1)} s`
}

export function TestReportByRunRedirect({
  workspace,
  runId,
}: {
  workspace: SkillWorkspace
  runId: string
}) {
  const { t } = useTranslation("testReports")
  const query = useTestReportByRun(runId)
  if (query.isPending) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-xs">
        <LoaderCircle className="size-4 animate-spin" />
        {t("states.findingReport")}
      </main>
    )
  }
  if (query.isError) {
    return (
      <main className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <h1 className="mt-3 text-lg font-[760]">
            {t("states.reportLookupError")}
          </h1>
          <Button asChild className="mt-4 rounded-none" variant="outline">
            <Link to={`/workbenches/${workspace.id}/runs/${runId}`}>
              {t("detail.openRun")}
            </Link>
          </Button>
        </div>
      </main>
    )
  }
  return (
    <Navigate
      replace
      to={`/workbenches/${workspace.id}/reports/${query.data.id}`}
    />
  )
}
