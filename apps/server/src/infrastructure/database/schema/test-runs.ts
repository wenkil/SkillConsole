import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { agentSessions } from "./agent-sessions.js"
import {
  evalRevisionCases,
  evalRevisions,
} from "./evals.js"
import {
  skillDraftRevisions,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
} from "./skill-workspaces.js"

export const testRunMode = pgEnum("test_run_mode", [
  "target_vs_no_skill",
])

export const testRunStatus = pgEnum("test_run_status", [
  "PREPARING",
  "RUNNING",
  "SCORING",
  "CANCELING",
  "COMPLETED",
  "CANCELED",
  "INTERRUPTED",
  "FAILED",
])

export const testRunCaseSide = pgEnum("test_run_case_side", [
  "TARGET",
  "BASELINE",
])

export const testRunCaseExecutionStatus = pgEnum(
  "test_run_case_execution_status",
  [
    "PENDING",
    "PREPARING",
    "RUNNING",
    "COMPLETED",
    "CANCELED",
    "INTERRUPTED",
    "FAILED",
  ],
)

export const testRunCaseAssessmentStatus = pgEnum(
  "test_run_case_assessment_status",
  [
    "PENDING",
    "RUNNING",
    "COMPLETED",
    "NOT_EVALUATED",
    "FAILED",
  ],
)

export const assertionResultStatus = pgEnum(
  "assertion_result_status",
  [
    "PASSED",
    "FAILED",
    "INSUFFICIENT_EVIDENCE",
    "NOT_EVALUATED",
  ],
)

export interface StoredTestRunUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationInputTokens: number
  readonly cacheReadInputTokens: number
  readonly totalCostUsd: number
  readonly durationMs: number
  readonly durationApiMs: number
  readonly numTurns: number
}

export interface StoredAssertionEvidence {
  readonly source:
    | "assistant_output"
    | "tool_result"
    | "artifact"
    | "execution_error"
  readonly reference: string
  readonly excerpt: string | null
}

export interface StoredBenchmarkSide {
  readonly executed: number
  readonly executionFailed: number
  readonly passed: number
  readonly failed: number
  readonly insufficientEvidence: number
  readonly notEvaluated: number
  readonly durationMs: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalCostUsd: number
}

export const skillTestRuns = pgTable(
  "skill_test_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => skillWorkspaces.id, { onDelete: "cascade" }),
    skillVersionId: uuid("skill_version_id").references(
      () => skillVersions.id,
      { onDelete: "restrict" },
    ),
    skillDraftRevisionId: uuid("skill_draft_revision_id").references(
      () => skillDraftRevisions.id,
      { onDelete: "restrict" },
    ),
    skillSnapshotId: uuid("skill_snapshot_id")
      .notNull()
      .references(() => skillSnapshots.id, { onDelete: "restrict" }),
    evalRevisionId: uuid("eval_revision_id")
      .notNull()
      .references(() => evalRevisions.id, { onDelete: "restrict" }),
    mode: testRunMode("mode").notNull(),
    status: testRunStatus("status").notNull(),
    protocolVersion: text("protocol_version").notNull(),
    sdkVersion: text("sdk_version").notNull(),
    skillCreatorCommit: text("skill_creator_commit").notNull(),
    skillCreatorTreeHash: text("skill_creator_tree_hash").notNull(),
    configurationFingerprint: text("configuration_fingerprint").notNull(),
    environmentFingerprint: text("environment_fingerprint").notNull(),
    skillManifestHash: text("skill_manifest_hash").notNull(),
    evalManifestHash: text("eval_manifest_hash").notNull(),
    comparabilityFingerprint: text("comparability_fingerprint").notNull(),
    runInputFingerprint: text("run_input_fingerprint").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    totalCaseCount: integer("total_case_count").notNull(),
    completedCaseCount: integer("completed_case_count").default(0).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details").$type<
      Readonly<Record<string, unknown>>
    >(),
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
    check(
      "skill_test_runs_target_check",
      sql`${table.skillDraftRevisionId} is not null or ${table.skillVersionId} is not null`,
    ),
    check(
      "skill_test_runs_hashes_check",
      sql`${table.skillCreatorTreeHash} ~ '^[0-9a-f]{64}$'
        and ${table.configurationFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.environmentFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.skillManifestHash} ~ '^[0-9a-f]{64}$'
        and ${table.evalManifestHash} ~ '^[0-9a-f]{64}$'
        and ${table.comparabilityFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.runInputFingerprint} ~ '^[0-9a-f]{64}$'
        and ${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "skill_test_runs_creator_commit_check",
      sql`${table.skillCreatorCommit} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      "skill_test_runs_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) between 1 and 200`,
    ),
    check(
      "skill_test_runs_case_count_check",
      sql`${table.totalCaseCount} >= 2
        and ${table.completedCaseCount} >= 0
        and ${table.completedCaseCount} <= ${table.totalCaseCount}`,
    ),
    uniqueIndex("skill_test_runs_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("skill_test_runs_active_workspace_unique")
      .on(table.workspaceId)
      .where(
        sql`${table.status} in ('PREPARING', 'RUNNING', 'SCORING', 'CANCELING')`,
      ),
    index("skill_test_runs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("skill_test_runs_comparability_idx").on(
      table.workspaceId,
      table.comparabilityFingerprint,
    ),
    index("skill_test_runs_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
)

export const skillTestRunCases = pgTable(
  "skill_test_run_cases",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => skillTestRuns.id, { onDelete: "cascade" }),
    evalRevisionCaseId: uuid("eval_revision_case_id")
      .notNull()
      .references(() => evalRevisionCases.id, { onDelete: "restrict" }),
    side: testRunCaseSide("side").notNull(),
    executionOrder: integer("execution_order").notNull(),
    externalId: integer("external_id").notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    expectedOutput: text("expected_output").notNull(),
    assertions: jsonb("assertions").$type<readonly string[]>().notNull(),
    files: jsonb("files").$type<readonly string[]>().notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    executionStatus:
      testRunCaseExecutionStatus("execution_status").notNull(),
    assessmentStatus:
      testRunCaseAssessmentStatus("assessment_status").notNull(),
    executionAgentSessionId: uuid("execution_agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "restrict" },
    ),
    graderAgentSessionId: uuid("grader_agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "restrict" },
    ),
    workspaceLocator: text("workspace_locator"),
    finalOutput: text("final_output"),
    usage: jsonb("usage").$type<StoredTestRunUsage>(),
    executionErrorCode: text("execution_error_code"),
    executionErrorMessage: text("execution_error_message"),
    assessmentErrorCode: text("assessment_error_code"),
    assessmentErrorMessage: text("assessment_error_message"),
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
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    executionCompletedAt: timestamp("execution_completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    assessmentCompletedAt: timestamp("assessment_completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    check(
      "skill_test_run_cases_sequence_check",
      sql`${table.executionOrder} >= 1 and ${table.externalId} >= 1`,
    ),
    check(
      "skill_test_run_cases_text_check",
      sql`char_length(${table.name}) between 1 and 120
        and char_length(${table.prompt}) between 1 and 20000
        and char_length(${table.expectedOutput}) between 1 and 10000`,
    ),
    check(
      "skill_test_run_cases_input_hash_check",
      sql`${table.inputFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("skill_test_run_cases_side_unique").on(
      table.runId,
      table.evalRevisionCaseId,
      table.side,
    ),
    uniqueIndex("skill_test_run_cases_order_unique").on(
      table.runId,
      table.executionOrder,
    ),
    uniqueIndex("skill_test_run_cases_execution_session_unique")
      .on(table.executionAgentSessionId)
      .where(sql`${table.executionAgentSessionId} is not null`),
    uniqueIndex("skill_test_run_cases_grader_session_unique")
      .on(table.graderAgentSessionId)
      .where(sql`${table.graderAgentSessionId} is not null`),
    index("skill_test_run_cases_run_external_idx").on(
      table.runId,
      table.externalId,
    ),
    index("skill_test_run_cases_execution_status_idx").on(
      table.executionStatus,
      table.updatedAt,
    ),
  ],
)

export const skillTestRunEvents = pgTable(
  "skill_test_run_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => skillTestRuns.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => skillTestRunCases.id, {
      onDelete: "cascade",
    }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    sourceAgentSessionId: uuid("source_agent_session_id").references(
      () => agentSessions.id,
      { onDelete: "restrict" },
    ),
    sourceAgentSequence: bigint("source_agent_sequence", {
      mode: "number",
    }),
    occurredAt: timestamp("occurred_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("skill_test_run_events_sequence_check", sql`${table.sequence} >= 1`),
    uniqueIndex("skill_test_run_events_sequence_unique").on(
      table.runId,
      table.sequence,
    ),
    uniqueIndex("skill_test_run_events_source_agent_unique")
      .on(table.sourceAgentSessionId, table.sourceAgentSequence)
      .where(
        sql`${table.sourceAgentSessionId} is not null
          and ${table.sourceAgentSequence} is not null`,
      ),
    index("skill_test_run_events_run_occurred_idx").on(
      table.runId,
      table.occurredAt,
    ),
  ],
)

export const skillTestArtifacts = pgTable(
  "skill_test_artifacts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => skillTestRunCases.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    storageLocator: text("storage_locator").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mediaTypeHint: text("media_type_hint").notNull(),
    contentKind: text("content_kind").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "skill_test_artifacts_path_check",
      sql`char_length(${table.relativePath}) between 1 and 512`,
    ),
    check(
      "skill_test_artifacts_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "skill_test_artifacts_byte_size_check",
      sql`${table.byteSize} >= 0`,
    ),
    check(
      "skill_test_artifacts_content_kind_check",
      sql`${table.contentKind} in ('text', 'binary')`,
    ),
    uniqueIndex("skill_test_artifacts_case_path_unique").on(
      table.caseId,
      table.relativePath,
    ),
    uniqueIndex("skill_test_artifacts_casefold_path_unique").on(
      table.caseId,
      sql`lower(${table.relativePath})`,
    ),
    uniqueIndex("skill_test_artifacts_storage_unique").on(
      table.storageLocator,
    ),
  ],
)

export const assertionResults = pgTable(
  "assertion_results",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => skillTestRunCases.id, { onDelete: "cascade" }),
    assertionIndex: integer("assertion_index").notNull(),
    assertion: text("assertion").notNull(),
    status: assertionResultStatus("status").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence")
      .$type<readonly StoredAssertionEvidence[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "assertion_results_index_check",
      sql`${table.assertionIndex} >= 0`,
    ),
    check(
      "assertion_results_text_check",
      sql`char_length(${table.assertion}) between 1 and 2000
        and char_length(${table.reason}) between 1 and 10000`,
    ),
    uniqueIndex("assertion_results_case_index_unique").on(
      table.caseId,
      table.assertionIndex,
    ),
    index("assertion_results_case_status_idx").on(
      table.caseId,
      table.status,
    ),
  ],
)

export const runBenchmarks = pgTable(
  "run_benchmarks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => skillTestRuns.id, { onDelete: "cascade" }),
    target: jsonb("target").$type<StoredBenchmarkSide>().notNull(),
    baseline: jsonb("baseline").$type<StoredBenchmarkSide>().notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("run_benchmarks_run_unique").on(table.runId),
  ],
)

export type SkillTestRunRow = typeof skillTestRuns.$inferSelect
export type SkillTestRunCaseRow = typeof skillTestRunCases.$inferSelect
export type SkillTestRunEventRow = typeof skillTestRunEvents.$inferSelect
export type SkillTestArtifactRow = typeof skillTestArtifacts.$inferSelect
export type AssertionResultRow = typeof assertionResults.$inferSelect
export type RunBenchmarkRow = typeof runBenchmarks.$inferSelect
export type TestRunStatus = (typeof testRunStatus.enumValues)[number]
export type TestRunCaseSide = (typeof testRunCaseSide.enumValues)[number]
export type TestRunCaseExecutionStatus =
  (typeof testRunCaseExecutionStatus.enumValues)[number]
export type TestRunCaseAssessmentStatus =
  (typeof testRunCaseAssessmentStatus.enumValues)[number]
export type AssertionResultStatus =
  (typeof assertionResultStatus.enumValues)[number]
