import { describe, expect, it } from "vitest"

import { getVersionComparisonDefaults } from "@/features/test-runs/hooks/use-test-runs-controller"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"

function version(
  sequenceNumber: number,
  options?: {
    baseline?: boolean
    state?: SkillVersionBrowser["snapshot"]["state"]
  },
): SkillVersionBrowser {
  return {
    id: `version-${sequenceNumber}`,
    sequenceNumber,
    name: `Version ${sequenceNumber}`,
    description: null,
    labels: [],
    sourceType: "folder",
    sourceName: "skill",
    createdAt: `2026-01-0${sequenceNumber}T00:00:00.000Z`,
    frozenAt: `2026-01-0${sequenceNumber}T00:00:00.000Z`,
    isOnline: false,
    isComparisonBaseline: options?.baseline ?? false,
    snapshot: {
      id: `snapshot-${sequenceNumber}`,
      state: options?.state ?? "READY",
      manifestHash: String(sequenceNumber).repeat(64),
      fileCount: 1,
      totalBytes: 1,
      createdAt: `2026-01-0${sequenceNumber}T00:00:00.000Z`,
    },
  }
}

describe("getVersionComparisonDefaults", () => {
  it("prefers the designated baseline and newest different READY candidate", () => {
    expect(
      getVersionComparisonDefaults([
        version(3),
        version(1),
        version(2, { baseline: true }),
        version(4, { state: "CORRUPTED" }),
      ]),
    ).toEqual({
      baselineVersionId: "version-2",
      candidateVersionId: "version-3",
    })
  })

  it("falls back to the earliest READY version as baseline", () => {
    expect(
      getVersionComparisonDefaults([version(3), version(1), version(2)]),
    ).toEqual({
      baselineVersionId: "version-1",
      candidateVersionId: "version-3",
    })
  })
})
