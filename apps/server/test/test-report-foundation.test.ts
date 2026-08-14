import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import path from "node:path"
import test from "node:test"
import { Check } from "typebox/value"

import type {
  TestRunCaseView,
  TestRunDetailView,
} from "../src/modules/test-runs/test-run.domain.js"
import { AgentSystemPromptStore } from "../src/modules/agent-sessions/agent-system-prompt.js"
import { buildStructuredTestReport } from "../src/modules/test-reports/test-report-generator.js"
import {
  createTestReportAnalysisInputFingerprint,
  parseTestReportAnalysis,
  TestReportAnalysisProtocolError,
} from "../src/modules/test-reports/test-report-analysis-protocol.js"
import {
  renderTestReportHtml,
  renderTestReportMarkdown,
} from "../src/modules/test-reports/test-report-renderer.js"
import {
  getCombinedTestReportDocumentFilename,
  renderCombinedTestReportHtml,
} from "../src/modules/test-reports/test-report-combined-renderer.js"
import {
  renderTestReportAnalysisHtml,
  type RenderableTestReportAnalysis,
} from "../src/modules/test-reports/test-report-analysis-renderer.js"
import { StructuredTestReportSchema } from "../src/modules/test-reports/test-report.contract.js"
import { TestReportService } from "../src/modules/test-reports/test-report.service.js"
import type { TestReportRepository } from "../src/modules/test-reports/test-report.repository.js"
import type { TestRunService } from "../src/modules/test-runs/test-run.service.js"

const hash = "a".repeat(64)
const now = new Date().toISOString()

function usage(overrides: Partial<NonNullable<TestRunCaseView["usage"]>> = {}) {
  return {
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCostUsd: 0.01,
    durationMs: 1_000,
    durationApiMs: 800,
    numTurns: 2,
    ...overrides,
  }
}

function runCase(input: {
  side: "TARGET" | "BASELINE"
  externalId: number
  status:
    | "PASSED"
    | "FAILED"
    | "INSUFFICIENT_EVIDENCE"
    | readonly ("PASSED" | "FAILED" | "INSUFFICIENT_EVIDENCE")[]
  inputFingerprint?: string
  observation?: "OBSERVED" | "NOT_OBSERVED" | "NOT_APPLICABLE" | null
  omitAssertionResult?: boolean
  executionStatus?: TestRunCaseView["executionStatus"]
}): TestRunCaseView {
  const caseId = randomUUID()
  const statuses = Array.isArray(input.status) ? input.status : [input.status]
  const executionStatus = input.executionStatus ?? "COMPLETED"
  return {
    id: caseId,
    evalRevisionCaseId: `00000000-0000-4000-8000-${String(input.externalId).padStart(12, "0")}`,
    externalId: input.externalId,
    name: `Case ${input.externalId}`,
    side: input.side,
    executionOrder: input.externalId * 2 + (input.side === "TARGET" ? 1 : 0),
    prompt: `Prompt ${input.externalId}`,
    expectedOutput: `Expected ${input.externalId}`,
    assertions: statuses.map(
      (_, index) => `Assertion ${index + 1} is correct.`,
    ),
    files: [],
    inputFingerprint: input.inputFingerprint ?? hash,
    participantExecutionFingerprint: hash,
    executionStatus,
    assessmentStatus:
      input.omitAssertionResult || executionStatus !== "COMPLETED"
        ? "NOT_EVALUATED"
        : "COMPLETED",
    finalOutput: `${input.side} output ${input.externalId}`,
    usage: usage(),
    gradingUsage: usage({ inputTokens: 30, outputTokens: 10, totalCostUsd: 0.005 }),
    skillInvocationObserved:
      input.observation === undefined ? "OBSERVED" : input.observation,
    skillToolCallCount:
      input.observation === "NOT_APPLICABLE" || input.observation === null
        ? 0
        : 1,
    bundledScriptUses:
      input.side === "TARGET"
        ? [{ relativePath: "scripts/check.py", count: 1, evidenceSequences: [2] }]
        : [],
    executionError: null,
    assessmentError: null,
    assertionResults: input.omitAssertionResult
      ? []
      : statuses.map((status, assertionIndex) => ({
            id: randomUUID(),
            assertionIndex,
            assertion: `Assertion ${assertionIndex + 1} is correct.`,
            status,
            reason: `Result is ${status}`,
            evidence: [],
          })),
    artifacts: [
      {
        id: randomUUID(),
        relativePath: "summary.txt",
        sha256: input.side === "TARGET" ? "b".repeat(64) : "c".repeat(64),
        byteSize: 20,
        mediaTypeHint: "text/plain",
        contentKind: "text",
        downloadUrl: `/artifact/${caseId}`,
      },
    ],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    executionCompletedAt: now,
    assessmentCompletedAt: now,
  }
}

function createRun(
  mode: "target_vs_no_skill" | "version_vs_version",
  cases: TestRunCaseView[],
): TestRunDetailView {
  const versionMode = mode === "version_vs_version"
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    mode,
    executionPolicy: versionMode
      ? "paired_serial_alternating_v1"
      : "target_then_no_skill_serial_v1",
    status: "COMPLETED",
    target: {
      draftId: versionMode ? null : randomUUID(),
      draftRevisionId: versionMode ? null : randomUUID(),
      draftContentRevision: versionMode ? null : 1,
      skillVersionId: versionMode ? randomUUID() : null,
      skillVersionName: versionMode ? "Candidate" : null,
      skillVersionNumber: versionMode ? 2 : null,
      skillSnapshotId: randomUUID(),
      evalRevisionId: randomUUID(),
      evalRevisionNumber: 1,
      evalCount: new Set(cases.map((item) => item.externalId)).size,
    },
    baseline: versionMode
      ? {
          kind: "skill_version",
          skillVersionId: randomUUID(),
          skillVersionName: "Baseline",
          skillVersionNumber: 1,
          skillSnapshotId: randomUUID(),
          skillManifestHash: "d".repeat(64),
        }
      : {
          kind: "no_skill",
          skillVersionId: null,
          skillSnapshotId: null,
        },
    environment: {
      status: "captured",
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      sdkVersion: "0.3.220",
      model: "sdk_default",
      apiEndpointHash: null,
      executionLimits: { timeoutMs: 120_000 },
      gradingLimits: { timeoutMs: 60_000 },
      executionPromptVersion: "execution-v1",
      graderProtocolVersion: "grader-v1",
      toolPermissionPolicyVersion: "tools-v1",
      executionPolicy: versionMode
        ? "paired_serial_alternating_v1"
        : "target_then_no_skill_serial_v1",
      runtimeCapabilities: [],
    },
    traceability: {
      protocolVersion: "protocol-v1",
      sdkVersion: "0.3.220",
      skillCreatorCommit: "e".repeat(40),
      skillCreatorTreeHash: hash,
      configurationFingerprint: hash,
      semanticConfigurationFingerprint: hash,
      executionSettingsFingerprint: hash,
      gradingSettingsFingerprint: hash,
      environmentFingerprint: hash,
      skillManifestHash: hash,
      baselineSkillManifestHash: versionMode ? "d".repeat(64) : null,
      evalManifestHash: hash,
      comparabilityFingerprint: hash,
      runInputFingerprint: hash,
      executionPromptVersion: "execution-v1",
      graderProtocolVersion: "grader-v1",
      toolPermissionPolicyVersion: "tools-v1",
    },
    progress: { totalCases: cases.length, completedCases: cases.length },
    benchmark: null,
    error: null,
    cases,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: new Date(new Date(now).getTime() + 5_000).toISOString(),
  }
}

function build(
  run: TestRunDetailView,
  evalCases = [
    ...new Map(
      run.cases.map((runCase) => [
        runCase.evalRevisionCaseId,
        {
          id: runCase.evalRevisionCaseId,
          externalId: runCase.externalId,
          name: runCase.name,
          assertions: runCase.assertions,
        },
      ]),
    ).values(),
  ],
) {
  const report = buildStructuredTestReport({
    run,
    reportId: randomUUID(),
    revisionId: randomUUID(),
    revisionNumber: 1,
    generatedAt: now,
    targetBundledScripts: ["scripts/check.py"],
    baselineBundledScripts:
      run.mode === "version_vs_version" ? ["scripts/check.py"] : [],
    lastEventSequence: 20,
    evalCases,
  })
  assert.equal(Check(StructuredTestReportSchema, report), true)
  return report
}

test("version reports calculate decisive rates and Fixed/Regression transitions", () => {
  const report = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: "PASSED" }),
      runCase({ side: "TARGET", externalId: 1, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 2, status: "PASSED" }),
      runCase({ side: "BASELINE", externalId: 2, status: "FAILED" }),
    ]),
  )
  assert.equal(report.status, "AVAILABLE")
  assert.equal(report.comparability.status, "COMPARABLE")
  assert.equal(report.metrics.target.assertions.decisivePassRate.value, 0.5)
  assert.equal(report.metrics.target.assertions.assessmentCoverageRate.value, 1)
  assert.equal(report.transitions.counts.REGRESSION, 1)
  assert.equal(report.transitions.counts.FIXED, 1)
  assert.equal(report.transitions.negativeCount, 1)
  assert.equal(report.transitions.positiveCount, 1)
  assert.equal(report.metrics.target.outputConsistency.status, "INSUFFICIENT_SAMPLE")
  assert.equal(report.metrics.target.usage.execution.totalCostUsd, 0.02)
  assert.equal(report.metrics.target.usage.grading.totalCostUsd, 0.01)
})

test("version reports cover stable, persistent-fail, and inconclusive transitions", () => {
  const report = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: "PASSED" }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
      runCase({ side: "BASELINE", externalId: 2, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 2, status: "FAILED" }),
      runCase({
        side: "BASELINE",
        externalId: 3,
        status: "INSUFFICIENT_EVIDENCE",
      }),
      runCase({ side: "TARGET", externalId: 3, status: "PASSED" }),
    ]),
  )
  assert.equal(report.transitions.counts.STABLE_PASS, 1)
  assert.equal(report.transitions.counts.PERSISTENT_FAIL, 1)
  assert.equal(report.transitions.counts.INCONCLUSIVE, 1)
  assert.equal(report.issues.counts.PERSISTENT_FAILURE, 1)
})

test("Skill effect reports keep No-Skill activation N/A and classify Skill gain", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "FAILED",
        observation: "NOT_APPLICABLE",
      }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ]),
  )
  assert.equal(report.transitions.counts.SKILL_GAIN, 1)
  assert.equal(report.metrics.baseline.activation.observedRate.value, null)
  assert.equal(report.metrics.baseline.activation.observedRate.status, "NOT_APPLICABLE")
  assert.equal(report.metrics.baseline.bundledScripts.observedCaseRate.status, "NOT_APPLICABLE")
  assert.equal(report.metrics.target.activation.observedRate.value, 1)
  assert.equal(report.metrics.target.bundledScripts.observedCaseRate.value, 1)
})

test("Skill effect reports cover degradation, both-pass, both-fail, and inconclusive", () => {
  const baseline = (
    externalId: number,
    status: "PASSED" | "FAILED" | "INSUFFICIENT_EVIDENCE",
  ) =>
    runCase({
      side: "BASELINE",
      externalId,
      status,
      observation: "NOT_APPLICABLE",
    })
  const report = build(
    createRun("target_vs_no_skill", [
      baseline(1, "PASSED"),
      runCase({ side: "TARGET", externalId: 1, status: "FAILED" }),
      baseline(2, "PASSED"),
      runCase({ side: "TARGET", externalId: 2, status: "PASSED" }),
      baseline(3, "FAILED"),
      runCase({ side: "TARGET", externalId: 3, status: "FAILED" }),
      baseline(4, "INSUFFICIENT_EVIDENCE"),
      runCase({ side: "TARGET", externalId: 4, status: "PASSED" }),
    ]),
  )
  assert.equal(report.transitions.counts.SKILL_DEGRADATION, 1)
  assert.equal(report.transitions.counts.BOTH_PASS, 1)
  assert.equal(report.transitions.counts.BOTH_FAIL, 1)
  assert.equal(report.transitions.counts.INCONCLUSIVE, 1)
  assert.equal(report.issues.counts.BOTH_FAILED, 1)
})

test("missing assertion results remain inconclusive and do not become failures", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "FAILED",
        observation: "NOT_APPLICABLE",
      }),
      runCase({
        side: "TARGET",
        externalId: 1,
        status: "PASSED",
        omitAssertionResult: true,
      }),
    ]),
  )
  assert.equal(report.status, "PARTIAL")
  assert.equal(report.metrics.target.assertions.notEvaluated, 1)
  assert.equal(report.metrics.target.assertions.decisivePassRate.value, null)
  assert.equal(report.cases[0]?.targetOutcome, "INCONCLUSIVE")
  assert.equal(report.issues.counts.NOT_EVALUATED, 1)
})

test("input fingerprint mismatches suppress Delta and outcome transitions", () => {
  const report = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: "PASSED", inputFingerprint: "b".repeat(64) }),
      runCase({ side: "TARGET", externalId: 1, status: "FAILED", inputFingerprint: "c".repeat(64) }),
    ]),
  )
  assert.equal(report.comparability.status, "NOT_COMPARABLE")
  assert.equal(report.metrics.delta, null)
  assert.equal(report.cases[0]?.pairComparability, "NOT_COMPARABLE")
  assert.equal(report.cases[0]?.classification, "INCONCLUSIVE")
  assert.equal(report.transitions.negativeCount, 0)
  assert.equal(report.issues.counts.REGRESSION, undefined)
  assert.equal(report.issues.counts.INPUT_MISMATCH, 1)
  const html = renderTestReportHtml(report, "en")
  const markdown = renderTestReportMarkdown(report, "en")
  assert.doesNotMatch(html, /raw false/)
  assert.doesNotMatch(markdown, /raw=false/)
  assert.match(html, /Not comparable/)
  assert.match(markdown, /Not comparable/)
})

test("legacy Runs preserve unknown comparability instead of inventing environment facts", () => {
  const run = createRun("version_vs_version", [
    runCase({ side: "BASELINE", externalId: 1, status: "PASSED" }),
    runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
  ])
  const report = build({
    ...run,
    environment: { status: "legacy_unavailable" },
  })
  assert.deepEqual(report.environment, { status: "legacy_unavailable" })
  assert.equal(report.comparability.status, "UNKNOWN_LEGACY")
  assert.equal(report.metrics.delta, null)
  assert.equal(report.issues.counts.LEGACY_TRACEABILITY_LIMITATION, 1)
})

test("Case classification gives directional changes precedence over stable Assertions", () => {
  const regression = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: ["PASSED", "PASSED"] }),
      runCase({ side: "TARGET", externalId: 1, status: ["FAILED", "PASSED"] }),
    ]),
  )
  assert.equal(regression.cases[0]?.classification, "REGRESSION")

  const mixed = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: ["PASSED", "FAILED"] }),
      runCase({ side: "TARGET", externalId: 1, status: ["FAILED", "PASSED"] }),
    ]),
  )
  assert.equal(mixed.cases[0]?.classification, "MIXED")
})

test("Skill activation denominators only include completed Skill Cases", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "FAILED",
        observation: "NOT_APPLICABLE",
      }),
      runCase({
        side: "TARGET",
        externalId: 1,
        status: "PASSED",
        observation: "OBSERVED",
        executionStatus: "CANCELED",
      }),
    ]),
  )
  assert.equal(report.metrics.target.activation.applicableCaseCount, 0)
  assert.equal(report.metrics.target.activation.observedRate.status, "MISSING_DATA")
  assert.equal(report.metrics.target.bundledScripts.eligibleCaseCount, 0)
  assert.equal(report.metrics.target.bundledScripts.observedCaseRate.status, "MISSING_DATA")
})

test("missing historical activation observations do not count as not observed", () => {
  const report = build(
    createRun("version_vs_version", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "PASSED",
        observation: null,
      }),
      runCase({
        side: "TARGET",
        externalId: 1,
        status: "PASSED",
        observation: null,
      }),
    ]),
  )
  assert.equal(report.metrics.target.activation.notObservedCaseCount, 0)
  assert.equal(report.metrics.target.activation.missingObservationCaseCount, 1)
  assert.equal(report.metrics.target.activation.observedRate.status, "MISSING_DATA")
  assert.equal(report.metrics.target.activation.observationCoverageRate.value, 0)
})

test("bundled script metrics only accept paths declared by the frozen Snapshot", () => {
  const baseline = runCase({
    side: "BASELINE",
    externalId: 1,
    status: "PASSED",
    observation: "NOT_APPLICABLE",
  })
  const target = runCase({
    side: "TARGET",
    externalId: 1,
    status: "PASSED",
  })
  const report = build(
    createRun("target_vs_no_skill", [
      baseline,
      {
        ...target,
        bundledScriptUses: [
          {
            relativePath: "scripts/not-in-snapshot.py",
            count: 4,
            evidenceSequences: [3],
          },
        ],
      },
    ]),
  )
  assert.equal(report.metrics.target.bundledScripts.observedCaseCount, 0)
  assert.equal(report.metrics.target.bundledScripts.callCount, 0)
  assert.equal(report.issues.counts.BUNDLED_SCRIPT_NOT_OBSERVED, 1)
})

test("small samples hide P95 and zero Baselines suppress percentage deltas", () => {
  const baseline = runCase({
    side: "BASELINE",
    externalId: 1,
    status: "PASSED",
  })
  const zero = usage({
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    durationApiMs: 0,
    numTurns: 0,
  })
  const report = build(
    createRun("version_vs_version", [
      { ...baseline, usage: zero, gradingUsage: zero },
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ]),
  )
  assert.equal(report.metrics.target.usage.p95CaseDurationMs, null)
  assert.equal(report.metrics.delta?.costPercent, null)
  assert.equal(report.metrics.delta?.activeDurationPercent, null)
})

test("source fingerprints are deterministic across report Revision identities", () => {
  const run = createRun("target_vs_no_skill", [
    runCase({
      side: "BASELINE",
      externalId: 1,
      status: "PASSED",
      observation: "NOT_APPLICABLE",
    }),
    runCase({ side: "TARGET", externalId: 1, status: "FAILED" }),
  ])
  const first = build(run)
  const second = build(run)
  assert.equal(first.sourceFingerprint, second.sourceFingerprint)
  assert.deepEqual(
    first.issues.items.map((issue) => issue.id),
    second.issues.items.map((issue) => issue.id),
  )
})

test("both Run modes and all four terminal statuses produce structured reports", () => {
  for (const mode of [
    "target_vs_no_skill",
    "version_vs_version",
  ] as const) {
    const base = createRun(mode, [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "FAILED",
        observation:
          mode === "target_vs_no_skill" ? "NOT_APPLICABLE" : "OBSERVED",
      }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ])
    for (const status of [
      "COMPLETED",
      "FAILED",
      "CANCELED",
      "INTERRUPTED",
    ] as const) {
      const report = build({
        ...base,
        status,
        error:
          status === "COMPLETED"
            ? null
            : {
                code: `TEST_RUN_${status}`,
                message: `Run ended as ${status}.`,
                details: null,
              },
      })
      assert.equal(
        report.status,
        status === "COMPLETED" ? "AVAILABLE" : "PARTIAL",
      )
      assert.equal(report.run.runStatus, status)
      assert.equal(
        report.completeness.status,
        status === "COMPLETED" ? "COMPLETE" : "PARTIAL",
      )
    }
  }
})

test("insufficient evidence lowers decisiveness without making the report structurally partial", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "INSUFFICIENT_EVIDENCE",
        observation: "NOT_APPLICABLE",
      }),
      runCase({
        side: "TARGET",
        externalId: 1,
        status: "INSUFFICIENT_EVIDENCE",
      }),
    ]),
  )
  assert.equal(report.status, "AVAILABLE")
  assert.equal(report.metrics.target.assertions.decisivePassRate.value, null)
  assert.equal(report.metrics.target.assertions.assessmentCoverageRate.value, 1)
  assert.equal(report.cases[0]?.targetOutcome, "INCONCLUSIVE")
})

test("missing Usage facts make totals explicitly partial instead of silently complete", () => {
  const baseline = runCase({
    side: "BASELINE",
    externalId: 1,
    status: "PASSED",
    observation: "NOT_APPLICABLE",
  })
  const target = runCase({
    side: "TARGET",
    externalId: 1,
    status: "PASSED",
  })
  const report = build(
    createRun("target_vs_no_skill", [
      baseline,
      { ...target, gradingUsage: null },
    ]),
  )
  assert.equal(report.status, "PARTIAL")
  assert.equal(report.comparability.status, "COMPARABLE_WITH_LIMITATIONS")
  assert.equal(report.metrics.delta?.inputTokensAbsolute, null)
  assert.equal(report.metrics.delta?.costUsdAbsolute, null)
  assert.equal(report.cases[0]?.usageDelta.inputTokens, null)
  assert.equal(report.cases[0]?.usageDelta.activeDurationMs, null)
  assert.equal(
    report.completeness.reasons.some((reason) =>
      reason.includes("no grading Usage facts"),
    ),
    true,
  )
})

test("execution failures produce partial reports with blocking evidence", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "PASSED",
        observation: "NOT_APPLICABLE",
      }),
      runCase({
        side: "TARGET",
        externalId: 1,
        status: "PASSED",
        executionStatus: "FAILED",
      }),
    ]),
  )
  assert.equal(report.status, "PARTIAL")
  assert.equal(report.cases[0]?.targetOutcome, "EXECUTION_ERROR")
  assert.equal(
    report.issues.items.some(
      (issue) =>
        issue.kind === "EXECUTION_ERROR" &&
        issue.triage === "BLOCKING_EVIDENCE",
    ),
    true,
  )
})

test("the frozen EvalRevision still produces a row when both Run Cases are missing", () => {
  const base = createRun("target_vs_no_skill", [
    runCase({
      side: "BASELINE",
      externalId: 1,
      status: "PASSED",
      observation: "NOT_APPLICABLE",
    }),
    runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
  ])
  const missingEvalCaseId = randomUUID()
  const report = build(
    {
      ...base,
      target: { ...base.target, evalCount: 2 },
    },
    [
      {
        id: base.cases[0]!.evalRevisionCaseId,
        externalId: 1,
        name: "Case 1",
        assertions: ["Assertion 1 is correct."],
      },
      {
        id: missingEvalCaseId,
        externalId: 2,
        name: "Missing Case 2",
        assertions: ["Missing Assertion is correct."],
      },
    ],
  )
  assert.equal(report.status, "PARTIAL")
  assert.equal(report.cases.length, 2)
  assert.equal(report.cases[1]?.evalRevisionCaseId, missingEvalCaseId)
  assert.equal(report.cases[1]?.targetCaseId, null)
  assert.equal(report.cases[1]?.baselineCaseId, null)
  assert.equal(report.completeness.missingTargetCaseCount, 1)
  assert.equal(report.completeness.missingBaselineCaseCount, 1)
  assert.equal(report.metrics.target.assertions.notEvaluated, 1)
  assert.equal(report.metrics.baseline.assertions.notEvaluated, 1)
  assert.equal(
    report.issues.items.filter(
      (issue) =>
        issue.evalRevisionCaseId === missingEvalCaseId &&
        issue.kind === "NOT_EVALUATED",
    ).length,
    2,
  )
})

test("static HTML and Markdown documents share one safe structured Revision", () => {
  const base = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ]),
  )
  const report = {
    ...base,
    title: '<script>alert("document")</script> Candidate | Baseline',
  }
  const html = renderTestReportHtml(report, "zh-CN")
  const markdown = renderTestReportMarkdown(report, "zh-CN")

  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /测试报告/)
  assert.match(html, /逐 Eval 结果/)
  assert.match(html, /技术详情/)
  assert.match(html, /输出一致性/)
  assert.match(html, /样本不足/)
  assert.match(html, /观察到的 Skill 工具调用/)
  assert.match(html, /FIXED/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /BASELINE output 1/)
  assert.match(
    html,
    new RegExp(
      `/workbenches/${base.workspaceId}/runs/${base.runId}\\?externalId=1`,
    ),
  )
  assert.ok(html.indexOf("概览") < html.indexOf("逐 Eval 结果"))
  assert.ok(html.indexOf("逐 Eval 结果") < html.indexOf("Usage 与 Artifact"))
  assert.ok(html.indexOf("Usage 与 Artifact") < html.indexOf("技术详情"))
  assert.match(html, /<details class="technical-details">/)
  assert.doesNotMatch(html, /<section><h2>问题与变化<\/h2>/)

  assert.match(markdown, /^# &lt;script&gt;/)
  assert.match(markdown, /## 指标概览/)
  assert.match(markdown, /## 逐 Eval 结果/)
  assert.match(markdown, /Candidate \\| Baseline/)
  assert.doesNotMatch(markdown, /BASELINE output 1/)
  assert.match(markdown, new RegExp(base.sourceFingerprint))
  assert.match(
    markdown,
    new RegExp(
      `/workbenches/${base.workspaceId}/runs/${base.runId}\\?externalId=1`,
    ),
  )
})

test("combined HTML binds one fact Report Revision to one AI Analysis Revision", () => {
  const report = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ]),
  )
  const analysis = {
    id: randomUUID(),
    reportId: report.reportId,
    reportRevisionId: report.reportRevisionId,
    revisionNumber: 2,
    configuredModelId: "configured-analyzer-model",
    actualModelId: "actual-analyzer-model",
    modelId: "actual-analyzer-model",
    configurationFingerprint: hash,
    semanticConfigurationFingerprint: hash,
    runtimePolicy: {
      schemaVersion: "test-report-analyzer-runtime-policy.v4",
      timeoutMs: 1_800_000,
      cancellationGraceMs: 5_000,
      maxInputCharacters: 500_000,
      capabilitySource: "project_settings",
      promptControlledFileAccess: true,
    },
    runtimePolicyFingerprint: hash,
    promptVersion: "test-report-analyzer-prompt-v1",
    inputFingerprint: hash,
    analysis: {
      schemaVersion: "test-report-analysis.v1",
      summary: '<img src=x onerror="alert(1)"> AI summary',
      findings: [
        {
          id: "finding-1",
          kind: "INFERENCE",
          scope: "SKILL",
          confidence: "MEDIUM",
          title: "Selected Case improved",
          statement: "The selected Case changed from failed to passed.",
          evidenceRefs: report.issues.items[0]?.evidenceRefs ?? [],
          affectedEvalCaseIds: [report.cases[0]!.evalRevisionCaseId],
          suggestedAction: "Inspect the linked Run Case.",
        },
      ],
      priorityOrder: ["finding-1"],
      limitations: ["One Eval Case only."],
    },
    usage: usage(),
    createdAt: now,
    completedAt: now,
  } satisfies RenderableTestReportAnalysis

  const html = renderCombinedTestReportHtml(analysis, report, "zh-CN")
  const analysisHtml = renderTestReportAnalysisHtml(analysis, report, "zh-CN")
  const filename = getCombinedTestReportDocumentFilename(analysis, report)

  assert.equal([...html.matchAll(/<!doctype html>/g)].length, 1)
  assert.match(html, /确定性事实报告/)
  assert.match(html, /第二部分 · AI 分析/)
  assert.match(analysisHtml, /font-size:16px/)
  assert.match(analysisHtml, /class="analysis-document"/)
  assert.match(html, /Selected Case improved/)
  assert.match(
    html,
    /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; AI summary/,
  )
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /test-report-combined-renderer-v1/)
  assert.match(
    filename,
    new RegExp(
      `-${report.runId.slice(0, 8)}-r${report.reportRevisionNumber}-a2-full\\.html$`,
    ),
  )
})

test("Analyzer protocol binds every Finding to selected immutable evidence", async () => {
  const report = build(
    createRun("version_vs_version", [
      runCase({ side: "BASELINE", externalId: 1, status: "PASSED" }),
      runCase({ side: "TARGET", externalId: 1, status: "FAILED" }),
    ]),
  )
  const selectedCaseId = report.cases[0]!.evalRevisionCaseId
  const evidenceRef = report.cases[0]!.evidenceRefs[0]!
  const response = JSON.stringify({
    schemaVersion: "test-report-analysis.v1",
    summary: "The selected Eval contains one deterministic regression fact.",
    findings: [
      {
        id: "finding-1",
        kind: "FACT",
        scope: "UNKNOWN",
        confidence: "HIGH",
        title: "Selected assertion regressed",
        statement: "The structured transition is REGRESSION.",
        evidenceRefs: [evidenceRef],
        affectedEvalCaseIds: [selectedCaseId],
        suggestedAction: null,
      },
      {
        id: "finding-2",
        kind: "INFERENCE",
        scope: "EVALS",
        confidence: "LOW",
        title: "Prompt ambiguity may be relevant",
        statement: "The evidence may suggest prompt ambiguity; it requires investigation.",
        evidenceRefs: [evidenceRef],
        affectedEvalCaseIds: [selectedCaseId],
        suggestedAction: "Inspect the Eval prompt without modifying evidence.",
      },
    ],
    priorityOrder: ["finding-1", "finding-2"],
    limitations: ["Only one selected Eval was analyzed."],
  })
  const parsed = parseTestReportAnalysis(response, report, [selectedCaseId])
  assert.equal(parsed.findings.length, 2)
  assert.deepEqual(parsed.priorityOrder, ["finding-1", "finding-2"])
  assert.equal(
    createTestReportAnalysisInputFingerprint({
      report,
      selectedEvalRevisionCaseIds: [selectedCaseId],
      configuredModelId: "sdk_default",
      semanticConfigurationFingerprint: "c".repeat(64),
      runtimePolicyFingerprint: "d".repeat(64),
      promptVersion: "test-report-analyzer.system.md@sha256:test",
    }),
    createTestReportAnalysisInputFingerprint({
      report,
      selectedEvalRevisionCaseIds: [selectedCaseId],
      configuredModelId: "sdk_default",
      semanticConfigurationFingerprint: "c".repeat(64),
      runtimePolicyFingerprint: "d".repeat(64),
      promptVersion: "test-report-analyzer.system.md@sha256:test",
    }),
  )
  const prompt = await new AgentSystemPromptStore(
    path.resolve("agent-prompts"),
  ).load("test-report-analyzer")
  assert.match(prompt.content, /untrusted evidence/)
  assert.match(prompt.content, /inputs\/task\.json/)
  assert.doesNotMatch(prompt.content, /BASELINE output 1/)
})

test("Analyzer protocol rejects uncited, out-of-scope, and decisive conclusions", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({
        side: "BASELINE",
        externalId: 1,
        status: "FAILED",
        observation: "NOT_APPLICABLE",
      }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ]),
  )
  const selectedCaseId = report.cases[0]!.evalRevisionCaseId
  const invalid = JSON.stringify({
    schemaVersion: "test-report-analysis.v1",
    summary: "Candidate wins and is approved for release.",
    findings: [
      {
        id: "finding-1",
        kind: "FACT",
        scope: "SKILL",
        confidence: "HIGH",
        title: "Winner",
        statement: "The Candidate is the winner.",
        evidenceRefs: [{ kind: "RUN_CASE", caseId: randomUUID() }],
        affectedEvalCaseIds: [selectedCaseId],
        suggestedAction: null,
      },
    ],
    priorityOrder: ["finding-1"],
    limitations: [],
  })
  assert.throws(
    () => parseTestReportAnalysis(invalid, report, [selectedCaseId]),
    (error: unknown) =>
      error instanceof TestReportAnalysisProtocolError &&
      error.code === "TEST_REPORT_ANALYZER_PROHIBITED_CONCLUSION",
  )
})

test("Analyzer protocol rejects unqualified Skill causality in summaries and any scope", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({ side: "BASELINE", externalId: 1, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
    ]),
  )
  const selectedCaseId = report.cases[0]!.evalRevisionCaseId
  const summaryOnly = JSON.stringify({
    schemaVersion: "test-report-analysis.v1",
    summary: "使用 Skill 导致通过率提升。",
    findings: [],
    priorityOrder: [],
    limitations: [],
  })
  assert.throws(
    () => parseTestReportAnalysis(summaryOnly, report, [selectedCaseId]),
    (error: unknown) =>
      error instanceof TestReportAnalysisProtocolError &&
      error.code === "TEST_REPORT_ANALYZER_SKILL_ATTRIBUTION_INVALID",
  )
  const evidenceRef = report.cases[0]!.evidenceRefs[0]!
  const wrongScope = JSON.stringify({
    schemaVersion: "test-report-analysis.v1",
    summary: "The report contains a bounded observation.",
    findings: [{
      id: "finding-1",
      kind: "FACT",
      scope: "UNKNOWN",
      confidence: "HIGH",
      title: "Causal claim",
      statement: "The tested Skill caused the pass-rate increase.",
      evidenceRefs: [evidenceRef],
      affectedEvalCaseIds: [selectedCaseId],
      suggestedAction: null,
    }],
    priorityOrder: ["finding-1"],
    limitations: [],
  })
  assert.throws(
    () => parseTestReportAnalysis(wrongScope, report, [selectedCaseId]),
    (error: unknown) =>
      error instanceof TestReportAnalysisProtocolError &&
      error.code === "TEST_REPORT_ANALYZER_SKILL_ATTRIBUTION_INVALID",
  )
})

test("Analyzer protocol requires evidence for every affected Eval Case", () => {
  const report = build(
    createRun("target_vs_no_skill", [
      runCase({ side: "BASELINE", externalId: 1, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 1, status: "PASSED" }),
      runCase({ side: "BASELINE", externalId: 2, status: "FAILED" }),
      runCase({ side: "TARGET", externalId: 2, status: "PASSED" }),
    ]),
  )
  const first = report.cases[0]!
  const second = report.cases[1]!
  const response = JSON.stringify({
    schemaVersion: "test-report-analysis.v1",
    summary: "Two selected Eval Cases are included in this bounded analysis.",
    findings: [{
      id: "finding-1",
      kind: "FACT",
      scope: "UNKNOWN",
      confidence: "HIGH",
      title: "Claim spans two Cases",
      statement: "The finding is declared for both selected Cases.",
      evidenceRefs: [first.evidenceRefs[0]!],
      affectedEvalCaseIds: [
        first.evalRevisionCaseId,
        second.evalRevisionCaseId,
      ],
      suggestedAction: null,
    }],
    priorityOrder: ["finding-1"],
    limitations: [],
  })
  assert.throws(
    () =>
      parseTestReportAnalysis(response, report, [
        first.evalRevisionCaseId,
        second.evalRevisionCaseId,
      ]),
    (error: unknown) =>
      error instanceof TestReportAnalysisProtocolError &&
      error.code === "TEST_REPORT_ANALYZER_EVIDENCE_COVERAGE_INVALID",
  )
})

test("report startup releases stale leases then subscribes before backfill", async () => {
  const runId = randomUUID()
  const reportId = randomUUID()
  let listener:
    | ((event: {
        sequence: number
        type: string
        runId: string
        caseId: string | null
        occurredAt: string
        payload: Readonly<Record<string, unknown>>
      }) => void)
    | null = null
  let ensuredRunId: string | null = null
  const repository = {
    async releasePendingGenerationLeases() {
      assert.equal(
        listener,
        null,
        "stale leases must be released before new workers can subscribe",
      )
    },
    async ensurePendingReports() {
      assert.ok(listener, "terminal subscription must exist before startup backfill")
      listener?.({
        sequence: 1,
        type: "run.completed",
        runId,
        caseId: null,
        occurredAt: now,
        payload: {},
      })
      return []
    },
    async listPendingOrExpired() {
      return []
    },
    async ensureForRun(value: string) {
      ensuredRunId = value
      return { id: reportId }
    },
    async claimGeneration() {
      return false
    },
  } as unknown as TestReportRepository
  const testRuns = {
    subscribeAll(value: NonNullable<typeof listener>) {
      listener = value
      return () => {
        listener = null
      }
    },
  } as unknown as TestRunService
  const service = new TestReportService({
    repository,
    testRuns,
    logger: { error() {} },
  })
  await service.initialize()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(ensuredRunId, runId)
  await service.shutdown()
})
