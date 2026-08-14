import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  FileDown,
  FileChartColumn,
  Fingerprint,
  ListTree,
  LoaderCircle,
  RotateCcw,
  ScrollText,
  Square,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"

import { TestRunStatusBadge } from "@/features/test-runs/components/test-run-status"
import { useTestRunDetailController } from "@/features/test-runs/hooks/use-test-runs-controller"
import {
  getCoverageRate,
  getPassRate,
  isActiveTestRun,
  isBenchmarkComparable,
  type TestRunAssertionStatus,
  type TestRunBenchmarkSide,
  type TestRunCase,
  type TestRunLogFilters,
} from "@/features/test-runs/model/test-run"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"
import { cn } from "@/shared/lib/utils"

function formatRate(side: TestRunBenchmarkSide): string {
  const rate = getPassRate(side)
  return rate === null ? "—" : `${Math.round(rate * 100)}%`
}

function AssertionStatus({
  status,
}: {
  status: TestRunAssertionStatus
}) {
  return (
    <span
      className={cn(
        "inline-flex border px-1.5 py-0.5 font-mono text-[8px] font-bold",
        status === "PASSED" &&
          "border-status-passed/55 text-status-passed",
        status === "FAILED" &&
          "border-status-failed/55 text-status-failed",
        status === "INSUFFICIENT_EVIDENCE" &&
          "border-status-blocked/55 text-status-blocked",
        status === "NOT_EVALUATED" &&
          "border-status-cancelled/55 text-status-cancelled",
      )}
    >
      {status}
    </span>
  )
}

function BenchmarkCard({
  label,
  side,
  labels,
}: {
  label: string
  side: TestRunBenchmarkSide | null
  labels: {
    readonly passRate: string
    readonly coverage: string
  }
}) {
  const coverage = side ? getCoverageRate(side) : null
  return (
    <article className="border border-foreground bg-paper-raised p-4">
      <span className="font-mono text-[9px] font-bold text-muted-foreground uppercase">
        {label}
      </span>
      <strong className="mt-2 block text-3xl tracking-[-0.04em]">
        {side ? formatRate(side) : "—"}
      </strong>
      <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
        {labels.passRate} · {labels.coverage}{" "}
        {coverage === null ? "—" : `${Math.round(coverage * 100)}%`}
      </span>
      <div className="mt-3 grid grid-cols-4 gap-px border border-rule bg-rule font-mono text-[9px]">
        <span className="bg-background p-2 text-status-passed">
          PASS {side?.passed ?? "—"}
        </span>
        <span className="bg-background p-2 text-status-failed">
          FAIL {side?.failed ?? "—"}
        </span>
        <span className="bg-background p-2 text-status-blocked">
          I/E {side?.insufficientEvidence ?? "—"}
        </span>
        <span className="bg-background p-2 text-muted-foreground">
          N/E {side?.notEvaluated ?? "—"}
        </span>
      </div>
    </article>
  )
}

function CaseSidePanel({
  title,
  runCase,
  empty,
  labels,
}: {
  title: string
  runCase: TestRunCase | null
  empty: string
  labels: {
    readonly finalOutput: string
    readonly assertions: string
    readonly artifacts: string
    readonly observability: string
    readonly skillInvocation: string
    readonly skillToolCalls: string
    readonly bundledScripts: string
    readonly usage: string
    readonly usageTokens: string
    readonly usageCost: string
    readonly usageDuration: string
    readonly usageTurns: string
  }
}) {
  if (!runCase) {
    return (
      <section className="border border-rule bg-paper-muted p-5 text-xs text-muted-foreground">
        {empty}
      </section>
    )
  }
  return (
    <section className="min-w-0 border border-foreground bg-paper-raised">
      <header className="flex items-center justify-between gap-2 border-b border-rule-soft px-4 py-3">
        <strong className="font-mono text-[10px]">{title}</strong>
        <span className="font-mono text-[8px] text-muted-foreground">
          {runCase.executionStatus} / {runCase.assessmentStatus}
        </span>
      </header>
      <div className="grid gap-4 p-4">
        {runCase.executionError || runCase.assessmentError ? (
          <div className="border border-destructive/45 bg-destructive/5 p-3 text-[11px] leading-5">
            {runCase.executionError?.message ??
              runCase.assessmentError?.message}
          </div>
        ) : null}
        <div>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">
            {labels.usage}
          </span>
          {runCase.usage || runCase.gradingUsage ? (
            <div className="mt-1.5 grid grid-cols-4 gap-px border border-rule bg-rule font-mono text-[9px]">
              <span className="bg-background p-2">
                {labels.usageTokens}
              </span>
              <span className="bg-background p-2">
                {labels.usageCost}
              </span>
              <span className="bg-background p-2">
                {labels.usageDuration}
              </span>
              <span className="bg-background p-2">
                {labels.usageTurns}
              </span>
            </div>
          ) : (
            <span className="mt-1.5 block text-xs text-muted-foreground">
              —
            </span>
          )}
        </div>
        <div>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">
            {labels.finalOutput}
          </span>
          <pre className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-words border border-rule-soft bg-paper-muted p-3 font-mono text-[10px] leading-5">
            {runCase.finalOutput ?? "—"}
          </pre>
        </div>
        <div>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">
            {labels.assertions}
          </span>
          <div className="mt-1.5 grid gap-2">
            {runCase.assertionResults.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              runCase.assertionResults.map((result) => (
                <article
                  className="border border-rule-soft p-3 text-[11px] leading-5"
                  key={result.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <strong>{result.assertion}</strong>
                    <AssertionStatus status={result.status} />
                  </div>
                  <p className="mt-1.5 text-muted-foreground">
                    {result.reason}
                  </p>
                  {result.evidence.map((evidence, index) => (
                    <div
                      className="mt-2 border-l-2 border-technical pl-2 font-mono text-[9px]"
                      key={`${result.id}:${index}`}
                    >
                      {evidence.source} · {evidence.reference}
                      {evidence.excerpt ? (
                        <span className="mt-1 block text-muted-foreground">
                          {evidence.excerpt}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </article>
              ))
            )}
          </div>
        </div>
        <div>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">
            {labels.artifacts}
          </span>
          <div className="mt-1.5 grid gap-1.5">
            {runCase.artifacts.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              runCase.artifacts.map((artifact) => (
                <a
                  className="flex items-center justify-between gap-3 border border-rule-soft px-3 py-2 font-mono text-[9px] hover:border-primary"
                  download
                  href={artifact.downloadUrl}
                  key={artifact.id}
                >
                  <span className="min-w-0 truncate">
                    {artifact.relativePath}
                  </span>
                  <FileDown className="size-3.5 shrink-0" />
                </a>
              ))
            )}
          </div>
        </div>
        <div>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">
            {labels.observability}
          </span>
          <div className="mt-1.5 grid gap-2 border border-rule-soft p-3 font-mono text-[9px]">
            <div className="flex items-center justify-between gap-3">
              <span>{labels.skillInvocation}</span>
              <strong>{runCase.skillInvocationObserved ?? "—"}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{labels.skillToolCalls}</span>
              <strong>{runCase.skillToolCallCount}</strong>
            </div>
            {runCase.bundledScriptUses.length > 0 ? (
              <div>
                <span className="text-muted-foreground">
                  {labels.bundledScripts}
                </span>
                {runCase.bundledScriptUses.map((script) => (
                  <div
                    className="mt-1 flex items-center justify-between gap-3"
                    key={script.relativePath}
                  >
                    <code className="truncate" title={script.relativePath}>
                      {script.relativePath}
                    </code>
                    <span>×{script.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export function TestRunDetailView({
  workspace,
  runId,
  locale,
}: {
  workspace: SkillWorkspace
  runId: string
  locale: string
}) {
  const { t } = useTranslation("testRuns")
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const linkedExternalId = useMemo(() => {
    const value = searchParams.get("externalId")
    if (!value || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }, [searchParams])
  const [tab, setTab] = useState<"results" | "logs">("results")
  const [requestedExternalId, setRequestedExternalId] = useState<
    number | null
  >(linkedExternalId)
  const [logSide, setLogSide] = useState<"" | "TARGET" | "BASELINE">("")
  const [logExternalId, setLogExternalId] = useState("")
  const [logPhase, setLogPhase] = useState<
    "" | "execution" | "grading" | "orchestration"
  >("")
  const logFilters = useMemo<TestRunLogFilters>(
    () => ({
      ...(logSide ? { side: logSide } : {}),
      ...(logExternalId
        ? { externalId: Number(logExternalId) }
        : {}),
      ...(logPhase ? { phase: logPhase } : {}),
    }),
    [logExternalId, logPhase, logSide],
  )
  const controller = useTestRunDetailController(
    workspace.id,
    runId,
    logFilters,
  )
  if (controller.loading) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-xs">
        <LoaderCircle className="size-4 animate-spin" />
        {t("states.loadingDetail")}
      </main>
    )
  }
  if (controller.error || !controller.run) {
    return (
      <main className="flex h-full items-center justify-center px-8">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <h1 className="mt-3 text-lg font-[760]">
            {t("states.detailError")}
          </h1>
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

  const run = controller.run
  const externalIds = [
    ...new Set(run.cases.map((runCase) => runCase.externalId)),
  ].sort((left, right) => left - right)
  const selectedExternalId =
    externalIds.includes(requestedExternalId ?? -1)
      ? requestedExternalId
      : externalIds[0] ?? null
  const selectedCases = run.cases.filter(
    (runCase) => runCase.externalId === selectedExternalId,
  )
  const target =
    selectedCases.find((runCase) => runCase.side === "TARGET") ?? null
  const baseline =
    selectedCases.find((runCase) => runCase.side === "BASELINE") ?? null
  const progress =
    run.progress.totalCases === 0
      ? 0
      : (run.progress.completedCases / run.progress.totalCases) * 100
  const benchmarkComparable = isBenchmarkComparable(run.benchmark)
  const versionComparison =
    run.mode === "version_vs_version" &&
    run.baseline.kind === "skill_version"
  const targetLabel = versionComparison
    ? t("detail.candidate", {
        name: run.target.skillVersionName,
        revision: run.target.skillVersionNumber,
      })
    : t("detail.target")
  const baselineLabel = run.baseline.kind === "skill_version"
    ? t("detail.versionBaseline", {
        name: run.baseline.skillVersionName,
        revision: run.baseline.skillVersionNumber,
      })
    : t("detail.baseline")
  const sidePanels = versionComparison
    ? [
        {
          key: "baseline",
          runCase: baseline,
          benchmark: run.benchmark?.baseline ?? null,
          label: baselineLabel,
        },
        {
          key: "target",
          runCase: target,
          benchmark: run.benchmark?.target ?? null,
          label: targetLabel,
        },
      ]
    : [
        {
          key: "target",
          runCase: target,
          benchmark: run.benchmark?.target ?? null,
          label: targetLabel,
        },
        {
          key: "baseline",
          runCase: baseline,
          benchmark: run.benchmark?.baseline ?? null,
          label: baselineLabel,
        },
      ]

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground hover:text-foreground"
              onClick={() =>
                navigate(`/workbenches/${workspace.id}/runs`)
              }
              type="button"
            >
              <ArrowLeft className="size-3" />
              {t("detail.back")}
            </button>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-[790] tracking-[-0.035em]">
                {versionComparison
                  ? t("detail.versionComparisonTitle", {
                      candidate: run.target.skillVersionNumber,
                      baseline:
                        run.baseline.kind === "skill_version"
                          ? run.baseline.skillVersionNumber
                          : "—",
                    })
                  : run.target.draftContentRevision
                  ? t("detail.draftRevision", {
                      revision: run.target.draftContentRevision,
                    })
                  : (run.target.skillVersionName ?? "—")}
                {" × EVALS R"}
                {run.target.evalRevisionNumber}
              </h1>
              <TestRunStatusBadge status={run.status} t={t} />
              <span className="border border-rule px-2 py-1 font-mono text-[9px] font-bold">
                {t(
                  versionComparison
                    ? "detail.versionComparisonMode"
                    : "detail.skillEffectMode",
                )}
              </span>
            </div>
            <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">
              RUN {run.id}
            </p>
            <p className="mt-1 font-mono text-[9px] text-muted-foreground">
              {t("detail.confirmedVersion")}: {run.target.skillVersionName
                ? `${run.target.skillVersionName} · #${run.target.skillVersionNumber}`
                : "—"}
            </p>
            <p className="mt-1 font-mono text-[9px] text-muted-foreground">
              BASELINE:{" "}
              {run.baseline.kind === "no_skill"
                ? "No-Skill"
                : `${run.baseline.skillVersionName} · #${run.baseline.skillVersionNumber}`}
              {" · "}
              {run.executionPolicy}
            </p>
          </div>
          <div className="flex items-center gap-2">
          {isActiveTestRun(run.status) ? (
            <Button
              className="rounded-none"
              disabled={controller.mutationPending}
              onClick={() => {
                void controller.actions.cancel().catch(() => undefined)
              }}
              type="button"
              variant="outline"
            >
              <Square data-icon="inline-start" />
              {t("detail.cancel")}
            </Button>
          ) : (
            <Button
              className="rounded-none"
              onClick={() =>
                navigate(
                  `/workbenches/${workspace.id}/reports/by-run/${run.id}`,
                )
              }
              type="button"
              variant="outline"
            >
              <FileChartColumn data-icon="inline-start" />
              {t("detail.viewReport")}
            </Button>
          )}
          </div>
        </div>
        <div className="mt-4 h-1.5 border border-rule bg-paper-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>{t("detail.progress")}</span>
          <span>
            {run.progress.completedCases} / {run.progress.totalCases}
          </span>
        </div>
      </header>

      {controller.mutationError || run.error ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-destructive/50 bg-destructive/5 px-5 py-2 text-xs"
          role="alert"
        >
          <AlertTriangle className="size-4 text-destructive" />
          {controller.mutationError ?? run.error?.message}
        </div>
      ) : null}

      <div className="shrink-0 border-b border-foreground bg-paper-muted/40 px-6 py-4">
        {run.benchmark && !benchmarkComparable ? (
          <div className="mb-3 flex items-start gap-2 border border-status-blocked/50 bg-status-blocked/5 p-3 text-[11px] leading-5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-blocked" />
            <div>
              <strong className="block">
                {t("detail.notComparableTitle")}
              </strong>
              <span className="text-muted-foreground">
                {t("detail.notComparableDescription")}
              </span>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          {sidePanels.map((panel) => (
            <BenchmarkCard
              key={panel.key}
              label={panel.label}
              labels={{
                passRate: t("detail.passRate"),
                coverage: t("detail.coverage"),
              }}
              side={panel.benchmark}
            />
          ))}
        </div>
      </div>

      <div
        aria-label={t("detail.tabsLabel")}
        className="flex shrink-0 border-b border-foreground bg-paper-muted px-6"
        role="tablist"
      >
        {(["results", "logs"] as const).map((item) => (
          <button
            aria-selected={tab === item}
            className={cn(
              "border-b-2 px-5 py-3 font-mono text-[10px] font-bold",
              tab === item
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )}
            key={item}
            onClick={() => setTab(item)}
            role="tab"
            type="button"
          >
            {t(`detail.tabs.${item}`)}
            {item === "logs" ? ` · ${controller.events.length}` : ""}
          </button>
        ))}
      </div>

      {tab === "results" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto border-r border-foreground bg-sidebar p-3">
            <div className="flex items-center gap-2 px-2 pb-2 font-mono text-[9px] font-bold text-muted-foreground uppercase">
              <ListTree className="size-3.5" />
              {t("detail.cases")}
            </div>
            {externalIds.map((externalId) => {
              const first = run.cases.find(
                (runCase) => runCase.externalId === externalId,
              )
              return (
                <button
                  className={cn(
                    "mb-1.5 w-full border px-3 py-2.5 text-left",
                    selectedExternalId === externalId
                      ? "border-primary bg-paper-raised shadow-[inset_3px_0_0_var(--primary)]"
                      : "border-transparent hover:border-rule",
                  )}
                  key={externalId}
                  onClick={() => setRequestedExternalId(externalId)}
                  type="button"
                >
                  <span className="font-mono text-[9px] text-muted-foreground">
                    EVAL {String(externalId).padStart(2, "0")}
                  </span>
                  <strong className="mt-1 block text-xs leading-5">
                    {first?.name}
                  </strong>
                </button>
              )
            })}
          </aside>

          <div className="min-h-0 overflow-y-auto p-5">
            {target || baseline ? (
              <section className="mb-4 border border-rule-soft bg-paper-muted p-4">
                <div className="font-mono text-[9px] text-muted-foreground uppercase">
                  {t("detail.userTask")}
                </div>
                <p className="mt-2 text-sm leading-6">
                  {(target ?? baseline)?.prompt}
                </p>
                <div className="mt-3 font-mono text-[9px] text-muted-foreground">
                  INPUT {(target ?? baseline)?.inputFingerprint}
                </div>
                <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                  TARGET {target?.participantExecutionFingerprint ?? "-"}
                </div>
                <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                  BASELINE {baseline?.participantExecutionFingerprint ?? "-"}
                </div>
              </section>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              {sidePanels.map((panel) => (
                <CaseSidePanel
                  empty={t("detail.noCase")}
                  key={panel.key}
                  labels={{
                    finalOutput: t("detail.finalOutput"),
                    assertions: t("detail.assertions"),
                    artifacts: t("detail.artifacts"),
                    observability: t("detail.observability"),
                    skillInvocation: t("detail.skillInvocation"),
                    skillToolCalls: t("detail.skillToolCalls", {
                      count: panel.runCase?.skillToolCallCount ?? 0,
                    }),
                    bundledScripts: t("detail.bundledScripts"),
                    usage: t("detail.usage"),
                    usageTokens: t("detail.usageTokens", {
                      count:
                        (panel.runCase?.usage?.inputTokens ?? 0) +
                        (panel.runCase?.usage?.outputTokens ?? 0) +
                        (panel.runCase?.gradingUsage?.inputTokens ?? 0) +
                        (panel.runCase?.gradingUsage?.outputTokens ?? 0),
                    }),
                    usageCost: t("detail.usageCost", {
                      value: (
                        (panel.runCase?.usage?.totalCostUsd ?? 0) +
                        (panel.runCase?.gradingUsage?.totalCostUsd ?? 0)
                      ).toFixed(4),
                    }),
                    usageDuration: t("detail.usageDuration", {
                      seconds: (
                        ((panel.runCase?.usage?.durationMs ?? 0) +
                          (panel.runCase?.gradingUsage?.durationMs ?? 0)) /
                        1_000
                      ).toFixed(1),
                    }),
                    usageTurns: t("detail.usageTurns", {
                      count:
                        (panel.runCase?.usage?.numTurns ?? 0) +
                        (panel.runCase?.gradingUsage?.numTurns ?? 0),
                    }),
                  }}
                  runCase={panel.runCase}
                  title={panel.label}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col bg-trace text-trace-foreground">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/15 px-5 py-3">
            <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase">
              <ScrollText className="size-4" />
              {t("detail.logs")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t("detail.allSides")}
                className="h-7 border border-white/25 bg-trace px-2 font-mono text-[9px] text-white outline-none"
                onChange={(event) =>
                  setLogSide(
                    event.target.value as "" | "TARGET" | "BASELINE",
                  )
                }
                value={logSide}
              >
                <option value="">{t("detail.allSides")}</option>
                <option value="BASELINE">{baselineLabel}</option>
                <option value="TARGET">{targetLabel}</option>
              </select>
              <select
                aria-label={t("detail.cases")}
                className="h-7 border border-white/25 bg-trace px-2 font-mono text-[9px] text-white outline-none"
                onChange={(event) =>
                  setLogExternalId(event.target.value)
                }
                value={logExternalId}
              >
                <option value="">{t("detail.allCases")}</option>
                {externalIds.map((externalId) => (
                  <option key={externalId} value={externalId}>
                    EVAL {String(externalId).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("detail.allPhases")}
                className="h-7 border border-white/25 bg-trace px-2 font-mono text-[9px] text-white outline-none"
                onChange={(event) =>
                  setLogPhase(
                    event.target.value as
                      | ""
                      | "execution"
                      | "grading"
                      | "orchestration",
                  )
                }
                value={logPhase}
              >
                <option value="">{t("detail.allPhases")}</option>
                <option value="execution">
                  {t("detail.phaseExecution")}
                </option>
                <option value="grading">
                  {t("detail.phaseGrading")}
                </option>
                <option value="orchestration">
                  {t("detail.phaseOrchestration")}
                </option>
              </select>
              <span className="font-mono text-[9px] text-white/55">
                {controller.events.length}
              </span>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-[10px]">
            {controller.hasEarlierEvents ? (
              <div className="mb-3 text-center">
                <Button
                  className="rounded-none border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  disabled={controller.loadingEarlierEvents}
                  onClick={() => {
                    void controller.actions.loadEarlierEvents()
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {controller.loadingEarlierEvents
                    ? t("detail.loadingLogs")
                    : t("detail.loadEarlierLogs")}
                </Button>
              </div>
            ) : null}
            {controller.logsError ? (
              <div className="flex items-center justify-between gap-3 border border-destructive/60 p-3 text-destructive">
                {t("detail.logsError")}
                <button
                  className="underline"
                  onClick={controller.actions.retryLogs}
                  type="button"
                >
                  {t("states.retry")}
                </button>
              </div>
            ) : controller.logsLoading ? (
              <div className="flex items-center gap-2 text-white/55">
                <LoaderCircle className="size-3 animate-spin" />
                {t("detail.loadingLogs")}
              </div>
            ) : controller.events.length === 0 ? (
              <div className="flex items-center gap-2 text-white/55">
                {isActiveTestRun(run.status) ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : null}
                {t("detail.noLogs")}
              </div>
            ) : (
              controller.events.map((event) => (
                <article
                  className="grid grid-cols-[3.5rem_10rem_minmax(0,1fr)] gap-3 border-b border-white/10 py-2.5"
                  key={event.sequence}
                >
                  <span className="text-white/35">#{event.sequence}</span>
                  <time className="text-white/45">
                    {new Intl.DateTimeFormat(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }).format(new Date(event.occurredAt))}
                  </time>
                  <div className="min-w-0">
                    <strong className="text-white">{event.type}</strong>
                    {Object.keys(event.payload).length > 0 ? (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[9px] leading-4 text-white/60">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      <footer className="grid shrink-0 grid-cols-2 gap-6 border-t border-foreground bg-paper-muted px-5 py-2">
        <details>
          <summary className="flex cursor-pointer items-center gap-2 font-mono text-[9px] font-bold uppercase">
            <Cpu className="size-3.5" />
            {t("detail.environment")}
          </summary>
          {run.environment.status === "legacy_unavailable" ? (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t("detail.legacyEnvironment")}
            </p>
          ) : (
            <div className="mt-2 grid gap-2 font-mono text-[8px] text-muted-foreground">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)]">
                <span>{t("detail.runtime")}</span>
                <code>
                  {run.environment.nodeVersion} · {run.environment.platform}/
                  {run.environment.architecture} · SDK{" "}
                  {run.environment.sdkVersion}
                </code>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)]">
                <span>{t("detail.model")}</span>
                <code>{run.environment.model}</code>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)]">
                <span>{t("detail.executionLimits")}</span>
                <code>
                  {run.environment.executionLimits.maxTurns} turns · US$
                  {run.environment.executionLimits.maxBudgetUsd} ·{" "}
                  {Math.round(
                    run.environment.executionLimits.timeoutMs / 1_000,
                  )}
                  s
                </code>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)]">
                <span>{t("detail.gradingLimits")}</span>
                <code>
                  {run.environment.gradingLimits.maxTurns} turns · US$
                  {run.environment.gradingLimits.maxBudgetUsd} ·{" "}
                  {Math.round(
                    run.environment.gradingLimits.timeoutMs / 1_000,
                  )}
                  s
                </code>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)]">
                <span>{t("detail.capabilities")}</span>
                <div>
                  {run.environment.runtimeCapabilities.map((capability) => (
                    <div key={capability.capability}>
                      {capability.capability}:{" "}
                      {capability.commands
                        .map(
                          (command) =>
                            `${command.name}=${command.available ? command.version ?? "available" : "missing"}`,
                        )
                        .join(", ")}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </details>
        <details>
          <summary className="flex cursor-pointer items-center gap-2 font-mono text-[9px] font-bold uppercase">
            <Fingerprint className="size-3.5" />
            {t("detail.traceability")}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[8px] text-muted-foreground">
            {Object.entries(run.traceability).map(([key, value]) => (
              <div className="grid grid-cols-[10rem_minmax(0,1fr)]" key={key}>
                <span>{key}</span>
                <code className="truncate" title={value ?? undefined}>
                  {value ?? "—"}
                </code>
              </div>
            ))}
          </div>
        </details>
      </footer>
    </main>
  )
}
