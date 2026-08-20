import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js"
import { Bar } from "react-chartjs-2"
import { useTranslation } from "react-i18next"

import type {
  SkillScoreMetricSubject,
  SkillScoreMetrics,
} from "@/features/test-reports/api/skill-score-reports-api"

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  Tooltip,
)

const subjectColors = ["#16847f", "#ef4b35"] as const
const subjectBorderColors = ["#0f615d", "#a93425"] as const
const gridColor = "rgba(164, 156, 141, 0.35)"
const textColor = "#39434b"

function createBarOptions({
  axisFormatter,
  missingLabel,
  tooltipFormatter,
  precision,
}: {
  axisFormatter: (value: number) => string
  missingLabel: string
  tooltipFormatter: (value: number) => string
  precision: number
}): ChartOptions<"bar"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 260 },
    interaction: {
      axis: "x",
      intersect: false,
      mode: "index",
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: { boxWidth: 10, boxHeight: 10, color: textColor },
      },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (context) => {
            const label = context.dataset.label
              ? `${context.dataset.label}: `
              : ""
            return `${label}${
              context.parsed.y === null
                ? missingLabel
                : tooltipFormatter(context.parsed.y)
            }`
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: textColor },
      },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          precision,
          callback: (value) => axisFormatter(Number(value)),
        },
      },
    },
  }
}

function signed(value: number, formatter: (input: number) => string): string {
  if (value === 0) return formatter(0)
  return `${value > 0 ? "+" : "−"}${formatter(Math.abs(value))}`
}

function MetricValues({
  difference,
  differenceFormatter,
  labels,
  values,
}: {
  difference: number | null
  differenceFormatter: (value: number) => string
  labels: readonly [string, string]
  values: readonly [string, string]
}) {
  const { t } = useTranslation("testReports")
  return (
    <div className="mt-4 border-t border-border-subtle pt-3 text-xs">
      <dl className="grid gap-2">
        {labels.map((label, index) => (
          <div className="flex items-start justify-between gap-4" key={label}>
            <dt className="min-w-0 text-muted-foreground">{label}</dt>
            <dd className="shrink-0 font-mono font-bold tabular-nums">
              {values[index]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-muted-foreground">
        {t("skillScore.metrics.difference", {
          value:
            difference === null
              ? t("skillScore.metrics.missing")
              : signed(difference, differenceFormatter),
        })}
      </p>
    </div>
  )
}

export function SkillScoreMetricsComparison({
  locale,
  metrics,
}: {
  locale: string
  metrics: SkillScoreMetrics
}) {
  const { t } = useTranslation("testReports")
  const subjects = metrics.subjects
  const formatSubject = (subject: SkillScoreMetricSubject): string => {
    if (subject.kind === "without_skill") {
      return t("skillScore.metrics.withoutSkill")
    }
    if (subject.kind === "with_skill") {
      return t("skillScore.metrics.withSkill")
    }
    return subject.versionName && subject.versionNumber !== null
      ? t("skillScore.metrics.version", {
          name: subject.versionName,
          revision: subject.versionNumber,
        })
      : subject.displayName
  }
  const subjectLabels: [string, string] = [
    formatSubject(subjects[0]),
    formatSubject(subjects[1]),
  ]
  const statusTranslationKey = {
    COMPLETE: "skillScore.metrics.complete",
    PARTIAL: "skillScore.metrics.partial",
    UNAVAILABLE: "skillScore.metrics.unavailable",
  } as const
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const cost = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
  const seconds = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const valueOrMissing = (
    value: number | undefined,
    formatter: (input: number) => string,
  ) =>
    value === undefined
      ? t("skillScore.metrics.missing")
      : formatter(value)

  const tokenOptions = createBarOptions({
    axisFormatter: (value) => number.format(value),
    missingLabel: t("skillScore.metrics.missing"),
    tooltipFormatter: (value) =>
      t("skillScore.metrics.tokens", { value: number.format(value) }),
    precision: 0,
  })
  const costOptions = createBarOptions({
    axisFormatter: (value) => `$${cost.format(value)}`,
    missingLabel: t("skillScore.metrics.missing"),
    tooltipFormatter: (value) =>
      t("skillScore.metrics.cost", { value: cost.format(value) }),
    precision: 4,
  })
  const durationOptions = createBarOptions({
    axisFormatter: (value) => `${seconds.format(value)}s`,
    missingLabel: t("skillScore.metrics.missing"),
    tooltipFormatter: (value) =>
      t("skillScore.metrics.duration", { value: seconds.format(value) }),
    precision: 1,
  })
  const turnsOptions = createBarOptions({
    axisFormatter: (value) => number.format(value),
    missingLabel: t("skillScore.metrics.missing"),
    tooltipFormatter: (value) =>
      t("skillScore.metrics.turns", { value: number.format(value) }),
    precision: 0,
  })
  const subjectDataset = (
    index: number,
    data: (number | null)[],
  ) => ({
    label: subjectLabels[index] ?? subjects[index]?.displayName ?? "",
    data,
    backgroundColor: subjectColors[index] ?? subjectColors[0],
    borderColor: subjectBorderColors[index] ?? subjectBorderColors[0],
    borderWidth: 1,
    maxBarThickness: 56,
  })
  const tokenData: ChartData<"bar", (number | null)[]> = {
    labels: [
      t("skillScore.metrics.inputTokens"),
      t("skillScore.metrics.outputTokens"),
      t("skillScore.metrics.cacheCreationTokens"),
      t("skillScore.metrics.cacheReadTokens"),
    ],
    datasets: subjects.map((subject, index) =>
      subjectDataset(
        index,
        subject.usage
          ? [
              subject.usage.inputTokens,
              subject.usage.outputTokens,
              subject.usage.cacheCreationInputTokens,
              subject.usage.cacheReadInputTokens,
            ]
          : [null, null, null, null],
      ),
    ),
  }
  const costData: ChartData<"bar", (number | null)[]> = {
    labels: [t("skillScore.metrics.costTitle")],
    datasets: subjects.map((subject, index) =>
      subjectDataset(index, [subject.usage?.totalCostUsd ?? null]),
    ),
  }
  const durationData: ChartData<"bar", (number | null)[]> = {
    labels: [t("skillScore.metrics.durationTitle")],
    datasets: subjects.map((subject, index) =>
      subjectDataset(index, [
        subject.usage ? subject.usage.durationMs / 1_000 : null,
      ]),
    ),
  }
  const turnsData: ChartData<"bar", (number | null)[]> = {
    labels: [t("skillScore.metrics.turnsTitle")],
    datasets: subjects.map((subject, index) =>
      subjectDataset(index, [subject.usage?.numTurns ?? null]),
    ),
  }
  const exactValues = <T extends number>(
    selector: (subject: SkillScoreMetricSubject) => T | undefined,
    formatter: (value: number) => string,
  ): [string, string] => [
    valueOrMissing(selector(subjects[0]), formatter),
    valueOrMissing(selector(subjects[1]), formatter),
  ]

  return (
    <section aria-labelledby="skill-score-metrics-title" className="border border-border-strong bg-paper-raised">
      <header className="border-b border-border-strong px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold" id="skill-score-metrics-title">
              {t("skillScore.metrics.title")}
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t("skillScore.metrics.description")}
            </p>
          </div>
          <span className="border border-border-default bg-paper-muted px-2 py-1 font-mono text-[11px] font-bold">
            {t(statusTranslationKey[metrics.status])}
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("skillScore.metrics.firstToSecond")}
        </p>
      </header>

      <div className="grid gap-px bg-rule lg:grid-cols-2">
        <figure className="bg-paper-raised p-5">
          <figcaption>
            <h4 className="font-bold">{t("skillScore.metrics.tokenTitle")}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("skillScore.metrics.tokenDescription")}
            </p>
          </figcaption>
          <div className="mt-4 h-64">
            <Bar data={tokenData} options={tokenOptions} />
          </div>
          <MetricValues
            difference={metrics.difference.modelTokens}
            differenceFormatter={(value) =>
              t("skillScore.metrics.tokens", { value: number.format(value) })
            }
            labels={subjectLabels}
            values={exactValues(
              (subject) =>
                subject.usage
                  ? subject.usage.inputTokens + subject.usage.outputTokens
                  : undefined,
              (value) =>
                t("skillScore.metrics.tokens", {
                  value: number.format(value),
                }),
            )}
          />
        </figure>

        <figure className="bg-paper-raised p-5">
          <figcaption>
            <h4 className="font-bold">{t("skillScore.metrics.costTitle")}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("skillScore.metrics.costDescription")}
            </p>
          </figcaption>
          <div className="mt-4 h-64">
            <Bar data={costData} options={costOptions} />
          </div>
          <MetricValues
            difference={metrics.difference.totalCostUsd}
            differenceFormatter={(value) =>
              t("skillScore.metrics.cost", { value: cost.format(value) })
            }
            labels={subjectLabels}
            values={exactValues(
              (subject) => subject.usage?.totalCostUsd,
              (value) =>
                t("skillScore.metrics.cost", { value: cost.format(value) }),
            )}
          />
        </figure>

        <figure className="bg-paper-raised p-5">
          <figcaption>
            <h4 className="font-bold">{t("skillScore.metrics.durationTitle")}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("skillScore.metrics.durationDescription")}
            </p>
          </figcaption>
          <div className="mt-4 h-64">
            <Bar data={durationData} options={durationOptions} />
          </div>
          <MetricValues
            difference={metrics.difference.durationMs}
            differenceFormatter={(value) =>
              t("skillScore.metrics.duration", {
                value: seconds.format(value / 1_000),
              })
            }
            labels={subjectLabels}
            values={exactValues(
              (subject) => subject.usage?.durationMs,
              (value) =>
                t("skillScore.metrics.duration", {
                  value: seconds.format(value / 1_000),
                }),
            )}
          />
        </figure>

        <figure className="bg-paper-raised p-5">
          <figcaption>
            <h4 className="font-bold">{t("skillScore.metrics.turnsTitle")}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("skillScore.metrics.turnsDescription")}
            </p>
          </figcaption>
          <div className="mt-4 h-64">
            <Bar data={turnsData} options={turnsOptions} />
          </div>
          <MetricValues
            difference={metrics.difference.numTurns}
            differenceFormatter={(value) =>
              t("skillScore.metrics.turns", { value: number.format(value) })
            }
            labels={subjectLabels}
            values={exactValues(
              (subject) => subject.usage?.numTurns,
              (value) =>
                t("skillScore.metrics.turns", {
                  value: number.format(value),
                }),
            )}
          />
        </figure>
      </div>
    </section>
  )
}
