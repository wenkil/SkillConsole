import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

import { evalRevisionCases } from "./evals.js"
import { agentSessions } from "./agent-sessions.js"
import { skillWorkspaces } from "./skill-workspaces.js"
import {
  assertionResultStatus,
  assertionResults,
  skillTestRunCases,
  skillTestRuns,
} from "./test-runs.js"

export const testReportType = pgEnum("test_report_type", [
  "skill_effect",
  "version_comparison",
])

export const testReportStatus = pgEnum("test_report_status", [
  "GENERATION_PENDING",
  "AVAILABLE",
  "PARTIAL",
  "GENERATION_FAILED",
  "UNAVAILABLE",
])

export const testReportComparabilityStatus = pgEnum(
  "test_report_comparability_status",
  [
    "COMPARABLE",
    "COMPARABLE_WITH_LIMITATIONS",
    "NOT_COMPARABLE",
    "UNKNOWN_LEGACY",
  ],
)

export const testReportAnalysisStatus = pgEnum(
  "test_report_analysis_status",
  ["NOT_REQUESTED", "PENDING", "RUNNING", "AVAILABLE", "FAILED"],
)

export const testReportAnalysisRevisionStatus = pgEnum(
  "test_report_analysis_revision_status",
  ["PENDING", "RUNNING", "AVAILABLE", "FAILED"],
)

export const testReportCaseOutcome = pgEnum(
  "test_report_case_outcome",
  [
    "PASSED",
    "FAILED",
    "INCONCLUSIVE",
    "EXECUTION_ERROR",
    "ASSESSMENT_ERROR",
    "CANCELED",
    "INTERRUPTED",
  ],
)

export interface StoredReportEvidenceRef {
  readonly kind:
    | "RUN_CASE"
    | "ASSERTION"
    | "ARTIFACT"
    | "EVENT"
    | "RUN_ERROR"
  readonly caseId?: string
  readonly assertionResultId?: string
  readonly artifactId?: string
  readonly sequence?: number
  readonly runId?: string
}

export const skillTestReports = pgTable(
  "skill_test_reports",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => skillTestRuns.id, { onDelete: "cascade" }),
    reportType: testReportType("report_type").notNull(),
    status: testReportStatus("status")
      .default("GENERATION_PENDING")
      .notNull(),
    comparabilityStatus: testReportComparabilityStatus(
      "comparability_status",
    ),
    currentRevisionId: uuid("current_revision_id").references(
      (): AnyPgColumn => skillTestReportRevisions.id,
      { onDelete: "set null" },
    ),
    analysisStatus: testReportAnalysisStatus("analysis_status")
      .default("NOT_REQUESTED")
      .notNull(),
    issueCount: integer("issue_count").default(0).notNull(),
    negativeTransitionCount: integer("negative_transition_count")
      .default(0)
      .notNull(),
    positiveTransitionCount: integer("positive_transition_count")
      .default(0)
      .notNull(),
    primaryPassRate: doublePrecision("primary_pass_rate"),
    assessmentCoverageRate: doublePrecision(
      "assessment_coverage_rate",
    ),
    executionCostUsd: doublePrecision("execution_cost_usd")
      .default(0)
      .notNull(),
    gradingCostUsd: doublePrecision("grading_cost_usd")
      .default(0)
      .notNull(),
    totalCostUsd: doublePrecision("total_cost_usd")
      .default(0)
      .notNull(),
    wallClockDurationMs: bigint("wall_clock_duration_ms", {
      mode: "number",
    }),
    generationErrorCode: text("generation_error_code"),
    generationErrorMessage: text("generation_error_message"),
    generationStartedAt: timestamp("generation_started_at", {
      mode: "date",
      withTimezone: true,
    }),
    generationLeaseExpiresAt: timestamp("generation_lease_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_test_reports_run_unique").on(table.runId),
    index("skill_test_reports_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("skill_test_reports_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("skill_test_reports_generation_lease_idx").on(
      table.status,
      table.generationLeaseExpiresAt,
    ),
    check(
      "skill_test_reports_counts_check",
      sql`${table.issueCount} >= 0
        and ${table.negativeTransitionCount} >= 0
        and ${table.positiveTransitionCount} >= 0`,
    ),
    check(
      "skill_test_reports_rates_check",
      sql`(${table.primaryPassRate} is null or ${table.primaryPassRate} between 0 and 1)
        and (${table.assessmentCoverageRate} is null or ${table.assessmentCoverageRate} between 0 and 1)`,
    ),
    check(
      "skill_test_reports_cost_check",
      sql`${table.executionCostUsd} >= 0
        and ${table.gradingCostUsd} >= 0
        and ${table.totalCostUsd} >= 0`,
    ),
  ],
)

export const skillTestReportRevisions = pgTable(
  "skill_test_report_revisions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => skillTestReports.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    schemaVersion: text("schema_version").notNull(),
    generatorVersion: text("generator_version").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    summarySnapshot: jsonb("summary_snapshot")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    generatedAt: timestamp("generated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_test_report_revisions_id_report_unique").on(
      table.id,
      table.reportId,
    ),
    uniqueIndex("skill_test_report_revisions_number_unique").on(
      table.reportId,
      table.revisionNumber,
    ),
    uniqueIndex("skill_test_report_revisions_source_unique").on(
      table.reportId,
      table.schemaVersion,
      table.generatorVersion,
      table.sourceFingerprint,
    ),
    check(
      "skill_test_report_revisions_number_check",
      sql`${table.revisionNumber} >= 1`,
    ),
    check(
      "skill_test_report_revisions_hash_check",
      sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "skill_test_report_revisions_snapshot_check",
      sql`jsonb_typeof(${table.summarySnapshot}) = 'object'`,
    ),
  ],
)

export const skillTestReportCaseRows = pgTable(
  "skill_test_report_case_rows",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    reportRevisionId: uuid("report_revision_id")
      .notNull()
      .references(() => skillTestReportRevisions.id, {
        onDelete: "cascade",
      }),
    evalRevisionCaseId: uuid("eval_revision_case_id")
      .notNull()
      .references(() => evalRevisionCases.id, { onDelete: "cascade" }),
    externalId: integer("external_id").notNull(),
    name: text("name").notNull(),
    classification: text("classification").notNull(),
    pairComparability: testReportComparabilityStatus(
      "pair_comparability",
    ).notNull(),
    targetCaseId: uuid("target_case_id").references(
      () => skillTestRunCases.id,
      { onDelete: "cascade" },
    ),
    baselineCaseId: uuid("baseline_case_id").references(
      () => skillTestRunCases.id,
      { onDelete: "cascade" },
    ),
    targetOutcome: testReportCaseOutcome("target_outcome"),
    baselineOutcome: testReportCaseOutcome("baseline_outcome"),
    issueCount: integer("issue_count").default(0).notNull(),
    issueKinds: jsonb("issue_kinds")
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    issueSides: jsonb("issue_sides")
      .$type<readonly ("TARGET" | "BASELINE")[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    issueKeys: jsonb("issue_keys")
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    derivedSnapshot: jsonb("derived_snapshot")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_test_report_case_rows_case_unique").on(
      table.reportRevisionId,
      table.evalRevisionCaseId,
    ),
    index("skill_test_report_case_rows_filter_idx").on(
      table.reportRevisionId,
      table.classification,
      table.externalId,
    ),
    check(
      "skill_test_report_case_rows_counts_check",
      sql`${table.externalId} >= 1 and ${table.issueCount} >= 0`,
    ),
    check(
      "skill_test_report_case_rows_snapshot_check",
      sql`jsonb_typeof(${table.derivedSnapshot}) = 'object'
        and jsonb_typeof(${table.issueKinds}) = 'array'
        and jsonb_typeof(${table.issueSides}) = 'array'
        and jsonb_typeof(${table.issueKeys}) = 'array'`,
    ),
  ],
)

export const skillTestReportAssertionRows = pgTable(
  "skill_test_report_assertion_rows",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    reportCaseRowId: uuid("report_case_row_id")
      .notNull()
      .references(() => skillTestReportCaseRows.id, {
        onDelete: "cascade",
      }),
    assertionIndex: integer("assertion_index").notNull(),
    assertion: text("assertion").notNull(),
    baselineStatus: assertionResultStatus("baseline_status"),
    targetStatus: assertionResultStatus("target_status"),
    transition: text("transition").notNull(),
    baselineAssertionResultId: uuid(
      "baseline_assertion_result_id",
    ).references(() => assertionResults.id, { onDelete: "cascade" }),
    targetAssertionResultId: uuid(
      "target_assertion_result_id",
    ).references(() => assertionResults.id, { onDelete: "cascade" }),
    evidenceRefs: jsonb("evidence_refs")
      .$type<readonly StoredReportEvidenceRef[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_test_report_assertion_rows_index_unique").on(
      table.reportCaseRowId,
      table.assertionIndex,
    ),
    check(
      "skill_test_report_assertion_rows_index_check",
      sql`${table.assertionIndex} >= 0`,
    ),
    check(
      "skill_test_report_assertion_rows_evidence_check",
      sql`jsonb_typeof(${table.evidenceRefs}) = 'array'`,
    ),
  ],
)

export const skillTestReportAnalyses = pgTable(
  "skill_test_report_analyses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => skillTestReports.id, { onDelete: "cascade" }),
    reportRevisionId: uuid("report_revision_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    status: testReportAnalysisRevisionStatus("status")
      .default("PENDING")
      .notNull(),
    agentSessionId: uuid("agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "restrict" },
    ),
    configuredModelId: text("model_id").notNull(),
    actualModelId: text("actual_model_id"),
    configurationFingerprint: text("configuration_fingerprint").notNull(),
    semanticConfigurationFingerprint: text(
      "semantic_configuration_fingerprint",
    ).notNull(),
    runtimePolicy: jsonb("runtime_policy")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    runtimePolicyFingerprint: text("runtime_policy_fingerprint").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    selectedEvalRevisionCaseIds: jsonb(
      "selected_eval_revision_case_ids",
    )
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    analysisSnapshot: jsonb("analysis_snapshot").$type<
      Readonly<Record<string, unknown>>
    >(),
    usage: jsonb("usage").$type<StoredAnalysisUsage>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      name: "skill_test_report_analyses_revision_report_fk",
      columns: [table.reportRevisionId, table.reportId],
      foreignColumns: [
        skillTestReportRevisions.id,
        skillTestReportRevisions.reportId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("skill_test_report_analyses_revision_unique").on(
      table.reportId,
      table.revisionNumber,
    ),
    uniqueIndex("skill_test_report_analyses_idempotency_unique").on(
      table.reportId,
      table.idempotencyKey,
    ),
    uniqueIndex("skill_test_report_analyses_agent_session_unique")
      .on(table.agentSessionId)
      .where(sql`${table.agentSessionId} is not null`),
    index("skill_test_report_analyses_report_created_idx").on(
      table.reportId,
      table.createdAt,
    ),
    index("skill_test_report_analyses_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "skill_test_report_analyses_revision_check",
      sql`${table.revisionNumber} >= 1`,
    ),
    check(
      "skill_test_report_analyses_hash_check",
      sql`${table.inputFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.configurationFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.semanticConfigurationFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.runtimePolicyFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "skill_test_report_analyses_json_check",
      sql`jsonb_typeof(${table.selectedEvalRevisionCaseIds}) = 'array'
        and jsonb_typeof(${table.runtimePolicy}) = 'object'
        and (${table.analysisSnapshot} is null or jsonb_typeof(${table.analysisSnapshot}) = 'object')
        and (${table.usage} is null or jsonb_typeof(${table.usage}) = 'object')`,
    ),
    check(
      "skill_test_report_analyses_text_check",
      sql`char_length(${table.configuredModelId}) between 1 and 200
        and (${table.actualModelId} is null or char_length(${table.actualModelId}) between 1 and 200)
        and char_length(${table.promptVersion}) between 1 and 200
        and char_length(${table.idempotencyKey}) between 1 and 200`,
    ),
    check(
      "skill_test_report_analyses_state_check",
      sql`(${table.status} = 'PENDING'
          and ${table.agentSessionId} is null
          and ${table.startedAt} is null
          and ${table.completedAt} is null
          and ${table.analysisSnapshot} is null
          and ${table.errorCode} is null
          and ${table.errorMessage} is null)
        or (${table.status} = 'RUNNING'
          and ${table.agentSessionId} is not null
          and ${table.startedAt} is not null
          and ${table.completedAt} is null
          and ${table.analysisSnapshot} is null
          and ${table.errorCode} is null
          and ${table.errorMessage} is null)
        or (${table.status} = 'AVAILABLE'
          and ${table.agentSessionId} is not null
          and ${table.startedAt} is not null
          and ${table.completedAt} is not null
          and ${table.analysisSnapshot} is not null
          and ${table.usage} is not null
          and ${table.errorCode} is null
          and ${table.errorMessage} is null)
        or (${table.status} = 'FAILED'
          and ${table.completedAt} is not null
          and ${table.analysisSnapshot} is null
          and ${table.errorCode} is not null
          and ${table.errorMessage} is not null)`,
    ),
  ],
)

export interface StoredAnalysisUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationInputTokens: number
  readonly cacheReadInputTokens: number
  readonly totalCostUsd: number
  readonly durationMs: number
  readonly durationApiMs: number
  readonly numTurns: number
}

export type SkillTestReportRow = typeof skillTestReports.$inferSelect
export type SkillTestReportRevisionRow =
  typeof skillTestReportRevisions.$inferSelect
export type SkillTestReportCaseRow =
  typeof skillTestReportCaseRows.$inferSelect
export type SkillTestReportAssertionRow =
  typeof skillTestReportAssertionRows.$inferSelect
export type SkillTestReportAnalysisRow =
  typeof skillTestReportAnalyses.$inferSelect
export type TestReportType = (typeof testReportType.enumValues)[number]
export type TestReportStatus =
  (typeof testReportStatus.enumValues)[number]
export type TestReportComparabilityStatus =
  (typeof testReportComparabilityStatus.enumValues)[number]
export type TestReportAnalysisStatus =
  (typeof testReportAnalysisStatus.enumValues)[number]
export type TestReportAnalysisRevisionStatus =
  (typeof testReportAnalysisRevisionStatus.enumValues)[number]
export type TestReportCaseOutcome =
  (typeof testReportCaseOutcome.enumValues)[number]
