CREATE TYPE "public"."eval_generation_draft_status" AS ENUM('READY', 'PUBLISHED', 'DISCARDED');--> statement-breakpoint
CREATE TYPE "public"."eval_generation_status" AS ENUM('PREPARING', 'RUNNING', 'VALIDATING', 'SUCCEEDED', 'CANCELING', 'CANCELED', 'INTERRUPTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."eval_target_source_kind" AS ENUM('DRAFT_REVISION', 'SKILL_VERSION');--> statement-breakpoint
CREATE TABLE "eval_generation_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"status" "eval_generation_draft_status" NOT NULL,
	"storage_locator" text NOT NULL,
	"source_schema_variant" text NOT NULL,
	"raw_evals_sha256" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"eval_count" integer NOT NULL,
	"file_count" integer NOT NULL,
	"total_bytes" bigint NOT NULL,
	"cases" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_generation_drafts_raw_hash_check" CHECK ("eval_generation_drafts"."raw_evals_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_generation_drafts_manifest_hash_check" CHECK ("eval_generation_drafts"."manifest_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_generation_drafts_schema_variant_check" CHECK ("eval_generation_drafts"."source_schema_variant" in ('assertions', 'expectations', 'mixed')),
	CONSTRAINT "eval_generation_drafts_counts_check" CHECK ("eval_generation_drafts"."eval_count" >= 1 and "eval_generation_drafts"."file_count" >= 0 and "eval_generation_drafts"."total_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "eval_generation_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_agent_sequence" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_generation_events_sequence_check" CHECK ("eval_generation_events"."sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "eval_generation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"suite_id" uuid NOT NULL,
	"agent_session_id" uuid,
	"target_snapshot_id" uuid NOT NULL,
	"target_source_kind" "eval_target_source_kind" NOT NULL,
	"target_version_id" uuid,
	"target_draft_revision_id" uuid,
	"skill_name" text NOT NULL,
	"status" "eval_generation_status" NOT NULL,
	"max_eval_count" integer NOT NULL,
	"generation_brief" text,
	"prompt_contract_version" text NOT NULL,
	"skill_creator_commit" text NOT NULL,
	"skill_creator_tree_hash" text NOT NULL,
	"configuration_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"error_details" jsonb,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "eval_generation_tasks_source_check" CHECK ((
        "eval_generation_tasks"."target_source_kind" = 'SKILL_VERSION'
        and "eval_generation_tasks"."target_version_id" is not null
        and "eval_generation_tasks"."target_draft_revision_id" is null
      ) or (
        "eval_generation_tasks"."target_source_kind" = 'DRAFT_REVISION'
        and "eval_generation_tasks"."target_version_id" is null
        and "eval_generation_tasks"."target_draft_revision_id" is not null
      )),
	CONSTRAINT "eval_generation_tasks_skill_name_check" CHECK (char_length("eval_generation_tasks"."skill_name") between 1 and 64),
	CONSTRAINT "eval_generation_tasks_count_check" CHECK ("eval_generation_tasks"."max_eval_count" between 1 and 20),
	CONSTRAINT "eval_generation_tasks_brief_check" CHECK ("eval_generation_tasks"."generation_brief" is null or char_length("eval_generation_tasks"."generation_brief") <= 4000),
	CONSTRAINT "eval_generation_tasks_commit_check" CHECK ("eval_generation_tasks"."skill_creator_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "eval_generation_tasks_tree_hash_check" CHECK ("eval_generation_tasks"."skill_creator_tree_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_generation_tasks_config_hash_check" CHECK ("eval_generation_tasks"."configuration_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_generation_tasks_request_hash_check" CHECK ("eval_generation_tasks"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_generation_tasks_idempotency_key_check" CHECK (char_length("eval_generation_tasks"."idempotency_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "eval_revision_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"external_id" integer NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"expected_output" text NOT NULL,
	"assertions" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	CONSTRAINT "eval_revision_cases_external_id_check" CHECK ("eval_revision_cases"."external_id" >= 1),
	CONSTRAINT "eval_revision_cases_text_check" CHECK (char_length("eval_revision_cases"."name") between 1 and 120
        and char_length("eval_revision_cases"."prompt") between 1 and 20000
        and char_length("eval_revision_cases"."expected_output") between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "eval_revision_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"media_type_hint" text NOT NULL,
	"content_kind" text NOT NULL,
	CONSTRAINT "eval_revision_files_path_check" CHECK (char_length("eval_revision_files"."relative_path") between 1 and 512),
	CONSTRAINT "eval_revision_files_sha256_check" CHECK ("eval_revision_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_revision_files_byte_size_check" CHECK ("eval_revision_files"."byte_size" >= 0),
	CONSTRAINT "eval_revision_files_content_kind_check" CHECK ("eval_revision_files"."content_kind" in ('text', 'binary'))
);
--> statement-breakpoint
CREATE TABLE "eval_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"suite_id" uuid NOT NULL,
	"source_generation_task_id" uuid NOT NULL,
	"source_snapshot_id" uuid NOT NULL,
	"source_kind" "eval_target_source_kind" NOT NULL,
	"source_version_id" uuid,
	"source_draft_revision_id" uuid,
	"revision_number" integer NOT NULL,
	"skill_name" text NOT NULL,
	"storage_locator" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"raw_evals_sha256" text NOT NULL,
	"eval_count" integer NOT NULL,
	"file_count" integer NOT NULL,
	"total_bytes" bigint NOT NULL,
	"prompt_contract_version" text NOT NULL,
	"skill_creator_commit" text NOT NULL,
	"skill_creator_tree_hash" text NOT NULL,
	"configuration_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_revisions_source_check" CHECK ((
        "eval_revisions"."source_kind" = 'SKILL_VERSION'
        and "eval_revisions"."source_version_id" is not null
        and "eval_revisions"."source_draft_revision_id" is null
      ) or (
        "eval_revisions"."source_kind" = 'DRAFT_REVISION'
        and "eval_revisions"."source_version_id" is null
        and "eval_revisions"."source_draft_revision_id" is not null
      )),
	CONSTRAINT "eval_revisions_number_check" CHECK ("eval_revisions"."revision_number" >= 1),
	CONSTRAINT "eval_revisions_skill_name_check" CHECK (char_length("eval_revisions"."skill_name") between 1 and 64),
	CONSTRAINT "eval_revisions_hashes_check" CHECK ("eval_revisions"."manifest_hash" ~ '^[0-9a-f]{64}$'
        and "eval_revisions"."raw_evals_sha256" ~ '^[0-9a-f]{64}$'
        and "eval_revisions"."skill_creator_tree_hash" ~ '^[0-9a-f]{64}$'
        and "eval_revisions"."configuration_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "eval_revisions_commit_check" CHECK ("eval_revisions"."skill_creator_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "eval_revisions_counts_check" CHECK ("eval_revisions"."eval_count" >= 1 and "eval_revisions"."file_count" >= 0 and "eval_revisions"."total_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_draft_revisions" DROP CONSTRAINT "skill_draft_revisions_reason_check";--> statement-breakpoint
ALTER TABLE "eval_generation_drafts" ADD CONSTRAINT "eval_generation_drafts_task_id_eval_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eval_generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_events" ADD CONSTRAINT "eval_generation_events_task_id_eval_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eval_generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" ADD CONSTRAINT "eval_generation_tasks_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" ADD CONSTRAINT "eval_generation_tasks_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" ADD CONSTRAINT "eval_generation_tasks_target_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("target_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" ADD CONSTRAINT "eval_generation_tasks_target_version_id_skill_versions_id_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" ADD CONSTRAINT "eval_generation_tasks_target_draft_revision_id_skill_draft_revisions_id_fk" FOREIGN KEY ("target_draft_revision_id") REFERENCES "public"."skill_draft_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revision_cases" ADD CONSTRAINT "eval_revision_cases_revision_id_eval_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."eval_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revision_files" ADD CONSTRAINT "eval_revision_files_revision_id_eval_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."eval_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revisions" ADD CONSTRAINT "eval_revisions_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revisions" ADD CONSTRAINT "eval_revisions_source_generation_task_id_eval_generation_tasks_id_fk" FOREIGN KEY ("source_generation_task_id") REFERENCES "public"."eval_generation_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revisions" ADD CONSTRAINT "eval_revisions_source_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revisions" ADD CONSTRAINT "eval_revisions_source_version_id_skill_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_revisions" ADD CONSTRAINT "eval_revisions_source_draft_revision_id_skill_draft_revisions_id_fk" FOREIGN KEY ("source_draft_revision_id") REFERENCES "public"."skill_draft_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_drafts_task_unique" ON "eval_generation_drafts" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_drafts_storage_unique" ON "eval_generation_drafts" USING btree ("storage_locator");--> statement-breakpoint
CREATE INDEX "eval_generation_drafts_created_idx" ON "eval_generation_drafts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_events_sequence_unique" ON "eval_generation_events" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_events_source_agent_unique" ON "eval_generation_events" USING btree ("task_id","source_agent_sequence") WHERE "eval_generation_events"."source_agent_sequence" is not null;--> statement-breakpoint
CREATE INDEX "eval_generation_events_task_occurred_idx" ON "eval_generation_events" USING btree ("task_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_tasks_agent_session_unique" ON "eval_generation_tasks" USING btree ("agent_session_id") WHERE "eval_generation_tasks"."agent_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_tasks_idempotency_unique" ON "eval_generation_tasks" USING btree ("suite_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_tasks_active_suite_unique" ON "eval_generation_tasks" USING btree ("suite_id") WHERE "eval_generation_tasks"."status" in ('PREPARING', 'RUNNING', 'VALIDATING', 'CANCELING');--> statement-breakpoint
CREATE INDEX "eval_generation_tasks_suite_created_idx" ON "eval_generation_tasks" USING btree ("suite_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_generation_tasks_status_updated_idx" ON "eval_generation_tasks" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_revision_cases_external_id_unique" ON "eval_revision_cases" USING btree ("revision_id","external_id");--> statement-breakpoint
CREATE INDEX "eval_revision_cases_revision_idx" ON "eval_revision_cases" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_revision_files_path_unique" ON "eval_revision_files" USING btree ("revision_id","relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_revision_files_casefold_path_unique" ON "eval_revision_files" USING btree ("revision_id",lower("relative_path"));--> statement-breakpoint
CREATE UNIQUE INDEX "eval_revisions_suite_number_unique" ON "eval_revisions" USING btree ("suite_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_revisions_generation_unique" ON "eval_revisions" USING btree ("source_generation_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_revisions_storage_unique" ON "eval_revisions" USING btree ("storage_locator");--> statement-breakpoint
CREATE INDEX "eval_revisions_suite_created_idx" ON "eval_revisions" USING btree ("suite_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_suites_workspace_unique" ON "eval_suites" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_draft_revisions_source_reason_unique" ON "skill_draft_revisions" USING btree ("draft_id","source_content_revision","reason");--> statement-breakpoint
ALTER TABLE "skill_draft_revisions" ADD CONSTRAINT "skill_draft_revisions_reason_check" CHECK ("skill_draft_revisions"."reason" in ('TRIAL', 'PRE_REGRESSION', 'RELEASE_GATE', 'FINALIZE', 'EVAL_GENERATION'));