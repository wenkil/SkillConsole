CREATE TYPE "public"."assertion_result_status" AS ENUM('PASSED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'NOT_EVALUATED');--> statement-breakpoint
CREATE TYPE "public"."test_run_case_assessment_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'NOT_EVALUATED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."test_run_case_execution_status" AS ENUM('PENDING', 'PREPARING', 'RUNNING', 'COMPLETED', 'CANCELED', 'INTERRUPTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."test_run_case_side" AS ENUM('TARGET', 'BASELINE');--> statement-breakpoint
CREATE TYPE "public"."test_run_mode" AS ENUM('target_vs_no_skill');--> statement-breakpoint
CREATE TYPE "public"."test_run_status" AS ENUM('PREPARING', 'RUNNING', 'SCORING', 'CANCELING', 'COMPLETED', 'CANCELED', 'INTERRUPTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "assertion_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"case_id" uuid NOT NULL,
	"assertion_index" integer NOT NULL,
	"assertion" text NOT NULL,
	"status" "assertion_result_status" NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assertion_results_index_check" CHECK ("assertion_results"."assertion_index" >= 0),
	CONSTRAINT "assertion_results_text_check" CHECK (char_length("assertion_results"."assertion") between 1 and 2000
        and char_length("assertion_results"."reason") between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "run_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"target" jsonb NOT NULL,
	"baseline" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_test_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"case_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"storage_locator" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"media_type_hint" text NOT NULL,
	"content_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_test_artifacts_path_check" CHECK (char_length("skill_test_artifacts"."relative_path") between 1 and 512),
	CONSTRAINT "skill_test_artifacts_sha256_check" CHECK ("skill_test_artifacts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_test_artifacts_byte_size_check" CHECK ("skill_test_artifacts"."byte_size" >= 0),
	CONSTRAINT "skill_test_artifacts_content_kind_check" CHECK ("skill_test_artifacts"."content_kind" in ('text', 'binary'))
);
--> statement-breakpoint
CREATE TABLE "skill_test_run_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"eval_revision_case_id" uuid NOT NULL,
	"side" "test_run_case_side" NOT NULL,
	"execution_order" integer NOT NULL,
	"external_id" integer NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"expected_output" text NOT NULL,
	"assertions" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"execution_status" "test_run_case_execution_status" NOT NULL,
	"assessment_status" "test_run_case_assessment_status" NOT NULL,
	"execution_agent_session_id" uuid,
	"grader_agent_session_id" uuid,
	"workspace_locator" text,
	"final_output" text,
	"usage" jsonb,
	"execution_error_code" text,
	"execution_error_message" text,
	"assessment_error_code" text,
	"assessment_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"execution_completed_at" timestamp with time zone,
	"assessment_completed_at" timestamp with time zone,
	CONSTRAINT "skill_test_run_cases_sequence_check" CHECK ("skill_test_run_cases"."execution_order" >= 1 and "skill_test_run_cases"."external_id" >= 1),
	CONSTRAINT "skill_test_run_cases_text_check" CHECK (char_length("skill_test_run_cases"."name") between 1 and 120
        and char_length("skill_test_run_cases"."prompt") between 1 and 20000
        and char_length("skill_test_run_cases"."expected_output") between 1 and 10000),
	CONSTRAINT "skill_test_run_cases_input_hash_check" CHECK ("skill_test_run_cases"."input_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "skill_test_run_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_agent_session_id" uuid,
	"source_agent_sequence" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_test_run_events_sequence_check" CHECK ("skill_test_run_events"."sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "skill_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"skill_snapshot_id" uuid NOT NULL,
	"eval_revision_id" uuid NOT NULL,
	"mode" "test_run_mode" NOT NULL,
	"status" "test_run_status" NOT NULL,
	"protocol_version" text NOT NULL,
	"sdk_version" text NOT NULL,
	"skill_creator_commit" text NOT NULL,
	"skill_creator_tree_hash" text NOT NULL,
	"configuration_fingerprint" text NOT NULL,
	"environment_fingerprint" text NOT NULL,
	"skill_manifest_hash" text NOT NULL,
	"eval_manifest_hash" text NOT NULL,
	"comparability_fingerprint" text NOT NULL,
	"run_input_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"total_case_count" integer NOT NULL,
	"completed_case_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "skill_test_runs_hashes_check" CHECK ("skill_test_runs"."skill_creator_tree_hash" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."environment_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."skill_manifest_hash" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."eval_manifest_hash" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."comparability_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."run_input_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_test_runs_creator_commit_check" CHECK ("skill_test_runs"."skill_creator_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "skill_test_runs_idempotency_key_check" CHECK (char_length("skill_test_runs"."idempotency_key") between 1 and 200),
	CONSTRAINT "skill_test_runs_case_count_check" CHECK ("skill_test_runs"."total_case_count" >= 2
        and "skill_test_runs"."completed_case_count" >= 0
        and "skill_test_runs"."completed_case_count" <= "skill_test_runs"."total_case_count")
);
--> statement-breakpoint
ALTER TABLE "assertion_results" ADD CONSTRAINT "assertion_results_case_id_skill_test_run_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."skill_test_run_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_benchmarks" ADD CONSTRAINT "run_benchmarks_run_id_skill_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_artifacts" ADD CONSTRAINT "skill_test_artifacts_case_id_skill_test_run_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."skill_test_run_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_run_id_skill_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_eval_revision_case_id_eval_revision_cases_id_fk" FOREIGN KEY ("eval_revision_case_id") REFERENCES "public"."eval_revision_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_execution_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("execution_agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_grader_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("grader_agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_events" ADD CONSTRAINT "skill_test_run_events_run_id_skill_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_events" ADD CONSTRAINT "skill_test_run_events_case_id_skill_test_run_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."skill_test_run_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_events" ADD CONSTRAINT "skill_test_run_events_source_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("source_agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_skill_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("skill_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_eval_revision_id_eval_revisions_id_fk" FOREIGN KEY ("eval_revision_id") REFERENCES "public"."eval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assertion_results_case_index_unique" ON "assertion_results" USING btree ("case_id","assertion_index");--> statement-breakpoint
CREATE INDEX "assertion_results_case_status_idx" ON "assertion_results" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "run_benchmarks_run_unique" ON "run_benchmarks" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_artifacts_case_path_unique" ON "skill_test_artifacts" USING btree ("case_id","relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_artifacts_casefold_path_unique" ON "skill_test_artifacts" USING btree ("case_id",lower("relative_path"));--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_artifacts_storage_unique" ON "skill_test_artifacts" USING btree ("storage_locator");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_cases_side_unique" ON "skill_test_run_cases" USING btree ("run_id","eval_revision_case_id","side");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_cases_order_unique" ON "skill_test_run_cases" USING btree ("run_id","execution_order");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_cases_execution_session_unique" ON "skill_test_run_cases" USING btree ("execution_agent_session_id") WHERE "skill_test_run_cases"."execution_agent_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_cases_grader_session_unique" ON "skill_test_run_cases" USING btree ("grader_agent_session_id") WHERE "skill_test_run_cases"."grader_agent_session_id" is not null;--> statement-breakpoint
CREATE INDEX "skill_test_run_cases_run_external_idx" ON "skill_test_run_cases" USING btree ("run_id","external_id");--> statement-breakpoint
CREATE INDEX "skill_test_run_cases_execution_status_idx" ON "skill_test_run_cases" USING btree ("execution_status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_events_sequence_unique" ON "skill_test_run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_events_source_agent_unique" ON "skill_test_run_events" USING btree ("source_agent_session_id","source_agent_sequence") WHERE "skill_test_run_events"."source_agent_session_id" is not null
          and "skill_test_run_events"."source_agent_sequence" is not null;--> statement-breakpoint
CREATE INDEX "skill_test_run_events_run_occurred_idx" ON "skill_test_run_events" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_runs_idempotency_unique" ON "skill_test_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_runs_active_workspace_unique" ON "skill_test_runs" USING btree ("workspace_id") WHERE "skill_test_runs"."status" in ('PREPARING', 'RUNNING', 'SCORING', 'CANCELING');--> statement-breakpoint
CREATE INDEX "skill_test_runs_workspace_created_idx" ON "skill_test_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "skill_test_runs_comparability_idx" ON "skill_test_runs" USING btree ("workspace_id","comparability_fingerprint");--> statement-breakpoint
CREATE INDEX "skill_test_runs_status_updated_idx" ON "skill_test_runs" USING btree ("status","updated_at");