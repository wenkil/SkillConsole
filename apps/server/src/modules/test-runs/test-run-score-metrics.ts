import type { StoredTestRunUsage } from "../../infrastructure/database/index.js"
import type {
  SkillScoreMetricSubject,
  SkillScoreMetricUsage,
  SkillScoreMetricsV1,
} from "./test-run.domain.js"

interface ScoreMetricsCase {
  readonly side: "TARGET" | "BASELINE"
  readonly usage: StoredTestRunUsage | null
  readonly gradingUsage: StoredTestRunUsage | null
}

interface ScoreMetricsRun {
  readonly mode: "target_vs_no_skill" | "version_vs_version"
  readonly target: {
    readonly skillVersionName: string | null
    readonly skillVersionNumber: number | null
  }
  readonly baseline:
    | { readonly kind: "no_skill" }
    | {
        readonly kind: "skill_version"
        readonly skillVersionName: string
        readonly skillVersionNumber: number
      }
  readonly cases: readonly ScoreMetricsCase[]
}

const emptyUsage = (): SkillScoreMetricUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalCostUsd: 0,
  durationMs: 0,
  durationApiMs: 0,
  numTurns: 0,
})

function addUsage(
  total: SkillScoreMetricUsage,
  usage: StoredTestRunUsage,
): SkillScoreMetricUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cacheCreationInputTokens:
      total.cacheCreationInputTokens + usage.cacheCreationInputTokens,
    cacheReadInputTokens:
      total.cacheReadInputTokens + usage.cacheReadInputTokens,
    totalCostUsd: total.totalCostUsd + usage.totalCostUsd,
    durationMs: total.durationMs + usage.durationMs,
    durationApiMs: total.durationApiMs + usage.durationApiMs,
    numTurns: total.numTurns + usage.numTurns,
  }
}

function aggregateCases(cases: readonly ScoreMetricsCase[]): {
  readonly usage: SkillScoreMetricUsage | null
  readonly hasAnyUsage: boolean
} {
  const hasAnyUsage = cases.some(
    (runCase) => runCase.usage !== null || runCase.gradingUsage !== null,
  )
  if (
    cases.length === 0 ||
    cases.some(
      (runCase) => runCase.usage === null || runCase.gradingUsage === null,
    )
  ) {
    return { usage: null, hasAnyUsage }
  }

  const usage = cases.reduce((total, runCase) => {
    const withExecution = addUsage(total, runCase.usage!)
    return addUsage(withExecution, runCase.gradingUsage!)
  }, emptyUsage())
  return { usage, hasAnyUsage }
}

function formatVersionName(name: string, versionNumber: number): string {
  return `${name} (revision ${versionNumber})`
}

export function buildSkillScoreMetrics(
  run: ScoreMetricsRun,
): SkillScoreMetricsV1 {
  const targetAggregate = aggregateCases(
    run.cases.filter((runCase) => runCase.side === "TARGET"),
  )
  const baselineAggregate = aggregateCases(
    run.cases.filter((runCase) => runCase.side === "BASELINE"),
  )

  const targetSubject: Omit<SkillScoreMetricSubject, "id"> =
    run.mode === "version_vs_version" &&
    run.target.skillVersionName !== null &&
    run.target.skillVersionNumber !== null
      ? {
          kind: "skill_version",
          displayName: formatVersionName(
            run.target.skillVersionName,
            run.target.skillVersionNumber,
          ),
          versionName: run.target.skillVersionName,
          versionNumber: run.target.skillVersionNumber,
          usage: targetAggregate.usage,
        }
      : {
          kind: "with_skill",
          displayName: "With current Skill",
          versionName: run.target.skillVersionName,
          versionNumber: run.target.skillVersionNumber,
          usage: targetAggregate.usage,
        }

  const baselineSubject: Omit<SkillScoreMetricSubject, "id"> =
    run.baseline.kind === "no_skill"
      ? {
          kind: "without_skill",
          displayName: "Without current Skill",
          versionName: null,
          versionNumber: null,
          usage: baselineAggregate.usage,
        }
      : {
          kind: "skill_version",
          displayName: formatVersionName(
            run.baseline.skillVersionName,
            run.baseline.skillVersionNumber,
          ),
          versionName: run.baseline.skillVersionName,
          versionNumber: run.baseline.skillVersionNumber,
          usage: baselineAggregate.usage,
        }

  const subjects: SkillScoreMetricsV1["subjects"] = [
    { id: "first", ...baselineSubject },
    { id: "second", ...targetSubject },
  ]
  const firstUsage = subjects[0].usage
  const secondUsage = subjects[1].usage
  const isComplete = firstUsage !== null && secondUsage !== null
  const hasAnyUsage =
    targetAggregate.hasAnyUsage || baselineAggregate.hasAnyUsage

  return {
    schemaVersion: "skill-score-metrics.v1",
    status: isComplete
      ? "COMPLETE"
      : hasAnyUsage
        ? "PARTIAL"
        : "UNAVAILABLE",
    subjects,
    difference: {
      modelTokens: isComplete
        ? secondUsage.inputTokens +
          secondUsage.outputTokens -
          firstUsage.inputTokens -
          firstUsage.outputTokens
        : null,
      totalCostUsd: isComplete
        ? secondUsage.totalCostUsd - firstUsage.totalCostUsd
        : null,
      durationMs: isComplete
        ? secondUsage.durationMs - firstUsage.durationMs
        : null,
      numTurns: isComplete
        ? secondUsage.numTurns - firstUsage.numTurns
        : null,
    },
  }
}
