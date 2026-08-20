import assert from "node:assert/strict"
import test from "node:test"

import type { StoredTestRunUsage } from "../src/infrastructure/database/index.js"
import { buildSkillScoreMetrics } from "../src/modules/test-runs/test-run-score-metrics.js"

function usage(seed: number): StoredTestRunUsage {
  return {
    inputTokens: seed,
    outputTokens: seed * 2,
    cacheCreationInputTokens: seed * 3,
    cacheReadInputTokens: seed * 4,
    totalCostUsd: seed / 100,
    durationMs: seed * 10,
    durationApiMs: seed * 8,
    numTurns: seed,
  }
}

test("aggregates execution and grading usage in business display order", () => {
  const metrics = buildSkillScoreMetrics({
    mode: "target_vs_no_skill",
    target: { skillVersionName: null, skillVersionNumber: null },
    baseline: { kind: "no_skill" },
    cases: [
      { side: "BASELINE", usage: usage(1), gradingUsage: usage(2) },
      { side: "TARGET", usage: usage(3), gradingUsage: usage(4) },
    ],
  })

  assert.equal(metrics.status, "COMPLETE")
  assert.deepEqual(
    metrics.subjects.map(({ id, kind, displayName }) => ({
      id,
      kind,
      displayName,
    })),
    [
      {
        id: "first",
        kind: "without_skill",
        displayName: "Without current Skill",
      },
      {
        id: "second",
        kind: "with_skill",
        displayName: "With current Skill",
      },
    ],
  )
  assert.equal(metrics.subjects[0].usage?.inputTokens, 3)
  assert.equal(metrics.subjects[1].usage?.inputTokens, 7)
  assert.equal(metrics.difference.modelTokens, 12)
  assert.ok(
    metrics.difference.totalCostUsd !== null &&
      Math.abs(metrics.difference.totalCostUsd - 0.04) < Number.EPSILON,
  )
  assert.equal(metrics.difference.durationMs, 40)
  assert.equal(metrics.difference.numTurns, 4)
})

test("uses actual version names and marks incomplete usage as partial", () => {
  const metrics = buildSkillScoreMetrics({
    mode: "version_vs_version",
    target: { skillVersionName: "Checkout helper", skillVersionNumber: 8 },
    baseline: {
      kind: "skill_version",
      skillVersionName: "Checkout helper",
      skillVersionNumber: 7,
    },
    cases: [
      { side: "BASELINE", usage: usage(1), gradingUsage: usage(1) },
      { side: "TARGET", usage: usage(1), gradingUsage: null },
    ],
  })

  assert.equal(metrics.status, "PARTIAL")
  assert.equal(metrics.subjects[0].displayName, "Checkout helper (revision 7)")
  assert.equal(metrics.subjects[1].displayName, "Checkout helper (revision 8)")
  assert.equal(metrics.subjects[0].usage?.numTurns, 2)
  assert.equal(metrics.subjects[1].usage, null)
  assert.deepEqual(metrics.difference, {
    modelTokens: null,
    totalCostUsd: null,
    durationMs: null,
    numTurns: null,
  })
})

test("returns unavailable when neither subject has usage", () => {
  const metrics = buildSkillScoreMetrics({
    mode: "target_vs_no_skill",
    target: { skillVersionName: null, skillVersionNumber: null },
    baseline: { kind: "no_skill" },
    cases: [
      { side: "BASELINE", usage: null, gradingUsage: null },
      { side: "TARGET", usage: null, gradingUsage: null },
    ],
  })

  assert.equal(metrics.status, "UNAVAILABLE")
  assert.equal(metrics.subjects[0].usage, null)
  assert.equal(metrics.subjects[1].usage, null)
})
