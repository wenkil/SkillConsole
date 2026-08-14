import { createHash } from "node:crypto"

import type {
  ReportEvidenceRef,
  StructuredTestReportV1,
  TestReportAnalysisFindingScope,
  TestReportAnalysisV1,
} from "./test-report.domain.js"

export type {
  TestReportAnalysisFindingScope,
  TestReportAnalysisV1,
} from "./test-report.domain.js"

export const testReportAnalysisSchemaVersion =
  "test-report-analysis.v1" as const
export type TestReportAnalysisFindingKind =
  TestReportAnalysisV1["findings"][number]["kind"]

export class TestReportAnalysisProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "TestReportAnalysisProtocolError"
  }
}

function invalidSchema(message: string): never {
  throw new TestReportAnalysisProtocolError(
    "TEST_REPORT_ANALYZER_SCHEMA_INVALID",
    message,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(value: string): unknown {
  const trimmed = value.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch (error) {
    throw new TestReportAnalysisProtocolError(
      "TEST_REPORT_ANALYZER_JSON_INVALID",
      "The Analyzer response was not valid JSON.",
      { cause: error },
    )
  }
}

function nonEmptyString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    return invalidSchema(`${field} must be a string.`)
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    return invalidSchema(`${field} failed its length constraint.`)
  }
  return normalized
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null) return null
  return nonEmptyString(value, field, maxLength)
}

function normalizedEvidenceRef(value: unknown): ReportEvidenceRef {
  if (!isRecord(value)) return invalidSchema("An EvidenceRef is invalid.")
  const kind = value.kind
  if (
    kind !== "RUN_CASE" &&
    kind !== "ASSERTION" &&
    kind !== "ARTIFACT" &&
    kind !== "EVENT" &&
    kind !== "RUN_ERROR"
  ) {
    return invalidSchema("An EvidenceRef kind is invalid.")
  }
  const ref: {
    kind: typeof kind
    caseId?: string
    assertionResultId?: string
    artifactId?: string
    sequence?: number
    runId?: string
  } = { kind }
  for (const name of [
    "caseId",
    "assertionResultId",
    "artifactId",
    "runId",
  ] as const) {
    if (value[name] !== undefined) {
      ref[name] = nonEmptyString(value[name], `EvidenceRef.${name}`, 128)
    }
  }
  if (value.sequence !== undefined) {
    if (
      typeof value.sequence !== "number" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1
    ) {
      return invalidSchema("EvidenceRef.sequence is invalid.")
    }
    ref.sequence = value.sequence
  }
  return ref
}

function evidenceKey(value: ReportEvidenceRef): string {
  return JSON.stringify({
    kind: value.kind,
    caseId: value.caseId ?? null,
    assertionResultId: value.assertionResultId ?? null,
    artifactId: value.artifactId ?? null,
    sequence: value.sequence ?? null,
    runId: value.runId ?? null,
  })
}

function availableEvidence(
  report: StructuredTestReportV1,
  selectedEvalRevisionCaseIds: ReadonlySet<string>,
): Map<string, ReadonlySet<string>> {
  const refs = new Map<string, Set<string>>()
  const add = (
    evidenceRef: ReportEvidenceRef,
    evalRevisionCaseId: string,
  ): void => {
    const key = evidenceKey(evidenceRef)
    const cases = refs.get(key) ?? new Set<string>()
    cases.add(evalRevisionCaseId)
    refs.set(key, cases)
  }
  if (report.run.terminalError) {
    add({ kind: "RUN_ERROR", runId: report.runId }, "__RUN__")
  }
  for (const issue of report.issues.items) {
    if (selectedEvalRevisionCaseIds.has(issue.evalRevisionCaseId)) {
      for (const evidenceRef of issue.evidenceRefs) {
        add(evidenceRef, issue.evalRevisionCaseId)
      }
    }
  }
  for (const reportCase of report.cases) {
    if (!selectedEvalRevisionCaseIds.has(reportCase.evalRevisionCaseId)) {
      continue
    }
    for (const evidenceRef of reportCase.evidenceRefs) {
      add(evidenceRef, reportCase.evalRevisionCaseId)
    }
    for (const assertion of reportCase.assertionTransitions) {
      for (const evidenceRef of assertion.evidenceRefs) {
        add(evidenceRef, reportCase.evalRevisionCaseId)
      }
    }
  }
  return refs
}

function assertEvidenceShape(ref: ReportEvidenceRef): void {
  const valid =
    (ref.kind === "RUN_CASE" && Boolean(ref.caseId)) ||
    (ref.kind === "ASSERTION" && Boolean(ref.assertionResultId)) ||
    (ref.kind === "ARTIFACT" && Boolean(ref.artifactId) && Boolean(ref.caseId)) ||
    (ref.kind === "EVENT" && ref.sequence !== undefined) ||
    (ref.kind === "RUN_ERROR" && Boolean(ref.runId))
  if (!valid) invalidSchema(`EvidenceRef ${ref.kind} is incomplete.`)
}

function containsProhibitedConclusion(value: string): boolean {
  return /(?:已通过验收|验收通过|(?:推荐|建议|可以|可直接|适合)(?:发布|上线|部署)|(?:已|已经)?(?:准备好|可用于)(?:发布|上线|生产)|(?:目标|候选)(?:版本)?(?:整体)?(?:优于|胜过|好于|胜出|获胜)(?:基线)?|candidate\s+(?:wins?|is\s+the\s+winner|outperforms?\s+(?:the\s+)?baseline)|target\s+(?:is\s+)?better\s+than\s+baseline|(?:ready|approved?)\s+for\s+(?:release|production|deployment)|recommend(?:ed|ing)?\s+(?:release|deployment)|ship\s+it|root\s+cause\s+is|唯一根因|确定根因)/iu.test(
    value,
  )
}

function containsUnqualifiedSkillAttribution(
  value: string,
  kind: TestReportAnalysisFindingKind,
): boolean {
  const causal =
    /(?:(?:使用|启用|安装)(?:了|该|目标)?(?:\s|的)*(?:Skill|技能).{0,32}(?:导致|造成|带来|提升|改善|降低|使得)|(?:Skill|技能).{0,32}(?:导致|造成|带来|提升|改善|降低|使得)|(?:using|enabling|installing|the)\s+(?:tested\s+)?skill.{0,32}(?:caused?|led\s+to|improved?|increased?|reduced?|resulted\s+in))/iu.test(
      value,
    )
  if (!causal) return false
  return (
    kind === "FACT" ||
    !/(?:可能|或许|推测|证据不足|may|might|could|possibly|suggests?|uncertain)/iu.test(
      value,
    )
  )
}

export function parseTestReportAnalysis(
  response: string,
  report: StructuredTestReportV1,
  selectedEvalRevisionCaseIds: readonly string[],
): TestReportAnalysisV1 {
  const parsed = parseJson(response)
  if (!isRecord(parsed)) return invalidSchema("The Analyzer root is invalid.")
  if (parsed.schemaVersion !== testReportAnalysisSchemaVersion) {
    return invalidSchema("The Analyzer schemaVersion is invalid.")
  }
  const summary = nonEmptyString(parsed.summary, "summary", 8_000)
  if (!Array.isArray(parsed.findings) || parsed.findings.length > 100) {
    return invalidSchema("findings must be a bounded array.")
  }
  if (!Array.isArray(parsed.priorityOrder) || !Array.isArray(parsed.limitations)) {
    return invalidSchema("priorityOrder or limitations is invalid.")
  }
  const allowedCases = new Set(selectedEvalRevisionCaseIds)
  const allowedEvidence = availableEvidence(report, allowedCases)
  const findingIds = new Set<string>()
  const findings: TestReportAnalysisV1["findings"][number][] =
    parsed.findings.map((value, index) => {
    if (!isRecord(value)) return invalidSchema(`Finding ${index} is invalid.`)
    const id = nonEmptyString(value.id, `findings[${index}].id`, 128)
    if (findingIds.has(id)) return invalidSchema("Finding IDs must be unique.")
    findingIds.add(id)
    const kind = value.kind
    const scope = value.scope
    const confidence = value.confidence
    if (kind !== "FACT" && kind !== "INFERENCE" && kind !== "SUGGESTION") {
      return invalidSchema(`Finding ${id} kind is invalid.`)
    }
    if (
      scope !== "SKILL" &&
      scope !== "EVALS" &&
      scope !== "HARNESS" &&
      scope !== "ENVIRONMENT" &&
      scope !== "UNKNOWN"
    ) {
      return invalidSchema(`Finding ${id} scope is invalid.`)
    }
    if (confidence !== "HIGH" && confidence !== "MEDIUM" && confidence !== "LOW") {
      return invalidSchema(`Finding ${id} confidence is invalid.`)
    }
    const title = nonEmptyString(value.title, `findings[${index}].title`, 300)
    const statement = nonEmptyString(
      value.statement,
      `findings[${index}].statement`,
      8_000,
    )
    const suggestedAction = optionalString(
      value.suggestedAction,
      `findings[${index}].suggestedAction`,
      4_000,
    )
    if (containsProhibitedConclusion(`${title}\n${statement}\n${suggestedAction ?? ""}`)) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_PROHIBITED_CONCLUSION",
        "The Analyzer response asserted a prohibited winner, release, or root-cause conclusion.",
      )
    }
    if (
      containsUnqualifiedSkillAttribution(
        `${title}\n${statement}\n${suggestedAction ?? ""}`,
        kind,
      )
    ) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_SKILL_ATTRIBUTION_INVALID",
        "The Analyzer asserted an unsupported causal attribution to the tested Skill.",
      )
    }
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
      return invalidSchema(`Finding ${id} must cite evidence.`)
    }
    const evidenceRefs = value.evidenceRefs.map(normalizedEvidenceRef)
    evidenceRefs.forEach(assertEvidenceShape)
    if (evidenceRefs.some((ref) => !allowedEvidence.has(evidenceKey(ref)))) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_EVIDENCE_INVALID",
        "The Analyzer cited evidence outside the selected Report Revision.",
      )
    }
    if (
      !Array.isArray(value.affectedEvalCaseIds) ||
      value.affectedEvalCaseIds.length === 0
    ) {
      return invalidSchema(`Finding ${id} affectedEvalCaseIds is invalid.`)
    }
    const affectedEvalCaseIds = value.affectedEvalCaseIds.map((caseId) =>
      nonEmptyString(caseId, `findings[${index}].affectedEvalCaseIds`, 128),
    )
    if (new Set(affectedEvalCaseIds).size !== affectedEvalCaseIds.length) {
      return invalidSchema(`Finding ${id} affectedEvalCaseIds must be unique.`)
    }
    if (affectedEvalCaseIds.some((caseId) => !allowedCases.has(caseId))) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_CASE_SCOPE_INVALID",
        "The Analyzer referenced an Eval Case outside the requested scope.",
      )
    }
    const affectedSet = new Set(affectedEvalCaseIds)
    if (
      evidenceRefs.some((ref) => {
        const evidenceCases = allowedEvidence.get(evidenceKey(ref))
        return (
          !evidenceCases ||
          ![...evidenceCases].some(
            (caseId) => caseId === "__RUN__" || affectedSet.has(caseId),
          )
        )
      })
    ) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_EVIDENCE_SCOPE_INVALID",
        "A Finding cited evidence outside its affected Eval Cases.",
      )
    }
    if (
      affectedEvalCaseIds.some(
        (caseId) =>
          !evidenceRefs.some((ref) =>
            allowedEvidence.get(evidenceKey(ref))?.has(caseId),
          ),
      )
    ) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_EVIDENCE_COVERAGE_INVALID",
        "Every affected Eval Case must have at least one case-bound EvidenceRef.",
      )
    }
    if (
      kind === "INFERENCE" &&
      !/(?:可能|或许|推测|建议核查|需要核查|证据不足|may|might|could|possibly|suggests?|uncertain|requires?\s+(?:verification|investigation))/iu.test(
        statement,
      )
    ) {
      throw new TestReportAnalysisProtocolError(
        "TEST_REPORT_ANALYZER_INFERENCE_CERTAINTY_INVALID",
        "An INFERENCE Finding must use explicit uncertainty language.",
      )
    }
    if (kind === "SUGGESTION" && suggestedAction === null) {
      return invalidSchema(`Suggestion ${id} must include suggestedAction.`)
    }
    return {
      id,
      kind: kind as TestReportAnalysisFindingKind,
      scope: scope as TestReportAnalysisFindingScope,
      confidence: confidence as "HIGH" | "MEDIUM" | "LOW",
      title,
      statement,
      evidenceRefs,
      affectedEvalCaseIds: [...new Set(affectedEvalCaseIds)],
      suggestedAction,
    }
  })
  const priorityOrder = parsed.priorityOrder.map((id) =>
    nonEmptyString(id, "priorityOrder", 128),
  )
  if (
    priorityOrder.length !== findingIds.size ||
    new Set(priorityOrder).size !== priorityOrder.length ||
    priorityOrder.some((id) => !findingIds.has(id))
  ) {
    return invalidSchema("priorityOrder must contain every Finding exactly once.")
  }
  if (parsed.limitations.length > 100) {
    return invalidSchema("limitations must be a bounded array.")
  }
  const limitations = parsed.limitations.map((value) =>
    nonEmptyString(value, "limitations", 2_000),
  )
  if (containsProhibitedConclusion(summary)) {
    throw new TestReportAnalysisProtocolError(
      "TEST_REPORT_ANALYZER_PROHIBITED_CONCLUSION",
      "The Analyzer summary asserted a prohibited conclusion.",
    )
  }
  if (containsUnqualifiedSkillAttribution(summary, "FACT")) {
    throw new TestReportAnalysisProtocolError(
      "TEST_REPORT_ANALYZER_SKILL_ATTRIBUTION_INVALID",
      "The Analyzer summary asserted an unsupported causal attribution to the tested Skill.",
    )
  }
  return {
    schemaVersion: testReportAnalysisSchemaVersion,
    summary,
    findings,
    priorityOrder,
    limitations,
  }
}

export function createTestReportAnalysisInputFingerprint(input: {
  readonly report: StructuredTestReportV1
  readonly selectedEvalRevisionCaseIds: readonly string[]
  readonly configuredModelId: string
  readonly semanticConfigurationFingerprint: string
  readonly runtimePolicyFingerprint: string
  readonly promptVersion: string
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: testReportAnalysisSchemaVersion,
        promptVersion: input.promptVersion,
        configuredModelId: input.configuredModelId,
        semanticConfigurationFingerprint:
          input.semanticConfigurationFingerprint,
        runtimePolicyFingerprint: input.runtimePolicyFingerprint,
        reportRevisionId: input.report.reportRevisionId,
        sourceFingerprint: input.report.sourceFingerprint,
        selectedEvalRevisionCaseIds: [...input.selectedEvalRevisionCaseIds].sort(),
      }),
      "utf8",
    )
    .digest("hex")
}
