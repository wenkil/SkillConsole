CREATE TYPE "public"."test_report_analysis_status" AS ENUM('NOT_REQUESTED', 'PENDING', 'RUNNING', 'AVAILABLE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."test_report_case_outcome" AS ENUM('PASSED', 'FAILED', 'INCONCLUSIVE', 'EXECUTION_ERROR', 'ASSESSMENT_ERROR', 'CANCELED', 'INTERRUPTED');--> statement-breakpoint
CREATE TYPE "public"."test_report_comparability_status" AS ENUM('COMPARABLE', 'COMPARABLE_WITH_LIMITATIONS', 'NOT_COMPARABLE', 'UNKNOWN_LEGACY');--> statement-breakpoint
CREATE TYPE "public"."test_report_status" AS ENUM('GENERATION_PENDING', 'AVAILABLE', 'PARTIAL', 'GENERATION_FAILED', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."test_report_type" AS ENUM('skill_effect', 'version_comparison');--> statement-breakpoint
CREATE TABLE "skill_test_report_assertion_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"report_case_row_id" uuid NOT NULL,
	"assertion_index" integer NOT NULL,
	"assertion" text NOT NULL,
	"baseline_status" "assertion_result_status",
	"target_status" "assertion_result_status",
	"transition" text NOT NULL,
	"baseline_assertion_result_id" uuid,
	"target_assertion_result_id" uuid,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "skill_test_report_assertion_rows_index_check" CHECK ("skill_test_report_assertion_rows"."assertion_index" >= 0),
	CONSTRAINT "skill_test_report_assertion_rows_evidence_check" CHECK (jsonb_typeof("skill_test_report_assertion_rows"."evidence_refs") = 'array')
);
--> statement-breakpoint
CREATE TABLE "skill_test_report_case_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"report_revision_id" uuid NOT NULL,
	"eval_revision_case_id" uuid NOT NULL,
	"external_id" integer NOT NULL,
	"name" text NOT NULL,
	"classification" text NOT NULL,
	"pair_comparability" "test_report_comparability_status" NOT NULL,
	"target_case_id" uuid,
	"baseline_case_id" uuid,
	"target_outcome" "test_report_case_outcome",
	"baseline_outcome" "test_report_case_outcome",
	"issue_count" integer DEFAULT 0 NOT NULL,
	"issue_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_sides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"derived_snapshot" jsonb NOT NULL,
	CONSTRAINT "skill_test_report_case_rows_counts_check" CHECK ("skill_test_report_case_rows"."external_id" >= 1 and "skill_test_report_case_rows"."issue_count" >= 0),
	CONSTRAINT "skill_test_report_case_rows_snapshot_check" CHECK (jsonb_typeof("skill_test_report_case_rows"."derived_snapshot") = 'object'
        and jsonb_typeof("skill_test_report_case_rows"."issue_kinds") = 'array'
        and jsonb_typeof("skill_test_report_case_rows"."issue_sides") = 'array'
        and jsonb_typeof("skill_test_report_case_rows"."issue_keys") = 'array')
);
--> statement-breakpoint
CREATE TABLE "skill_test_report_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"report_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"schema_version" text NOT NULL,
	"generator_version" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"summary_snapshot" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_test_report_revisions_number_check" CHECK ("skill_test_report_revisions"."revision_number" >= 1),
	CONSTRAINT "skill_test_report_revisions_hash_check" CHECK ("skill_test_report_revisions"."source_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_test_report_revisions_snapshot_check" CHECK (jsonb_typeof("skill_test_report_revisions"."summary_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "skill_test_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"report_type" "test_report_type" NOT NULL,
	"status" "test_report_status" DEFAULT 'GENERATION_PENDING' NOT NULL,
	"comparability_status" "test_report_comparability_status",
	"current_revision_id" uuid,
	"analysis_status" "test_report_analysis_status" DEFAULT 'NOT_REQUESTED' NOT NULL,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"negative_transition_count" integer DEFAULT 0 NOT NULL,
	"positive_transition_count" integer DEFAULT 0 NOT NULL,
	"primary_pass_rate" double precision,
	"assessment_coverage_rate" double precision,
	"execution_cost_usd" double precision DEFAULT 0 NOT NULL,
	"grading_cost_usd" double precision DEFAULT 0 NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"wall_clock_duration_ms" bigint,
	"generation_error_code" text,
	"generation_error_message" text,
	"generation_started_at" timestamp with time zone,
	"generation_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_test_reports_counts_check" CHECK ("skill_test_reports"."issue_count" >= 0
        and "skill_test_reports"."negative_transition_count" >= 0
        and "skill_test_reports"."positive_transition_count" >= 0),
	CONSTRAINT "skill_test_reports_rates_check" CHECK (("skill_test_reports"."primary_pass_rate" is null or "skill_test_reports"."primary_pass_rate" between 0 and 1)
        and ("skill_test_reports"."assessment_coverage_rate" is null or "skill_test_reports"."assessment_coverage_rate" between 0 and 1)),
	CONSTRAINT "skill_test_reports_cost_check" CHECK ("skill_test_reports"."execution_cost_usd" >= 0
        and "skill_test_reports"."grading_cost_usd" >= 0
        and "skill_test_reports"."total_cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "skill_test_report_assertion_rows" ADD CONSTRAINT "skill_test_report_assertion_rows_report_case_row_id_skill_test_report_case_rows_id_fk" FOREIGN KEY ("report_case_row_id") REFERENCES "public"."skill_test_report_case_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_assertion_rows" ADD CONSTRAINT "skill_test_report_assertion_rows_baseline_assertion_result_id_assertion_results_id_fk" FOREIGN KEY ("baseline_assertion_result_id") REFERENCES "public"."assertion_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_assertion_rows" ADD CONSTRAINT "skill_test_report_assertion_rows_target_assertion_result_id_assertion_results_id_fk" FOREIGN KEY ("target_assertion_result_id") REFERENCES "public"."assertion_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_case_rows" ADD CONSTRAINT "skill_test_report_case_rows_report_revision_id_skill_test_report_revisions_id_fk" FOREIGN KEY ("report_revision_id") REFERENCES "public"."skill_test_report_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_case_rows" ADD CONSTRAINT "skill_test_report_case_rows_eval_revision_case_id_eval_revision_cases_id_fk" FOREIGN KEY ("eval_revision_case_id") REFERENCES "public"."eval_revision_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_case_rows" ADD CONSTRAINT "skill_test_report_case_rows_target_case_id_skill_test_run_cases_id_fk" FOREIGN KEY ("target_case_id") REFERENCES "public"."skill_test_run_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_case_rows" ADD CONSTRAINT "skill_test_report_case_rows_baseline_case_id_skill_test_run_cases_id_fk" FOREIGN KEY ("baseline_case_id") REFERENCES "public"."skill_test_run_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_revisions" ADD CONSTRAINT "skill_test_report_revisions_report_id_skill_test_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."skill_test_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_reports" ADD CONSTRAINT "skill_test_reports_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_reports" ADD CONSTRAINT "skill_test_reports_run_id_skill_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_reports" ADD CONSTRAINT "skill_test_reports_current_revision_id_skill_test_report_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."skill_test_report_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_assertion_rows_index_unique" ON "skill_test_report_assertion_rows" USING btree ("report_case_row_id","assertion_index");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_case_rows_case_unique" ON "skill_test_report_case_rows" USING btree ("report_revision_id","eval_revision_case_id");--> statement-breakpoint
CREATE INDEX "skill_test_report_case_rows_filter_idx" ON "skill_test_report_case_rows" USING btree ("report_revision_id","classification","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_revisions_number_unique" ON "skill_test_report_revisions" USING btree ("report_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_revisions_source_unique" ON "skill_test_report_revisions" USING btree ("report_id","schema_version","generator_version","source_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_reports_run_unique" ON "skill_test_reports" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "skill_test_reports_workspace_created_idx" ON "skill_test_reports" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "skill_test_reports_workspace_status_idx" ON "skill_test_reports" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "skill_test_reports_generation_lease_idx" ON "skill_test_reports" USING btree ("status","generation_lease_expires_at");
--> statement-breakpoint
INSERT INTO "skill_test_reports" (
	"workspace_id",
	"run_id",
	"report_type",
	"status",
	"analysis_status",
	"created_at",
	"updated_at"
)
SELECT
	run."workspace_id",
	run."id",
	CASE
		WHEN run."mode"::text = 'version_vs_version'
			THEN 'version_comparison'::"test_report_type"
		ELSE 'skill_effect'::"test_report_type"
	END,
	'GENERATION_PENDING'::"test_report_status",
	'NOT_REQUESTED'::"test_report_analysis_status",
	COALESCE(run."completed_at", run."updated_at", run."created_at"),
	now()
FROM "skill_test_runs" run
WHERE run."status"::text IN ('COMPLETED', 'FAILED', 'CANCELED', 'INTERRUPTED')
ON CONFLICT ("run_id") DO NOTHING;
