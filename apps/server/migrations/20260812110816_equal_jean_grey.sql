CREATE TYPE "public"."skill_invocation_observation" AS ENUM('OBSERVED', 'NOT_OBSERVED', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."test_run_execution_policy" AS ENUM('target_then_no_skill_serial_v1', 'paired_serial_alternating_v1');--> statement-breakpoint
ALTER TYPE "public"."test_run_mode" ADD VALUE 'version_vs_version';--> statement-breakpoint
ALTER TABLE "skill_test_runs" DROP CONSTRAINT "skill_test_runs_target_check";--> statement-breakpoint
ALTER TABLE "skill_test_runs" DROP CONSTRAINT "skill_test_runs_hashes_check";--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "skill_invocation_observed" "skill_invocation_observation";--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "skill_tool_call_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "bundled_script_uses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "grading_usage" jsonb;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "participant_execution_fingerprint" text;--> statement-breakpoint
UPDATE "skill_test_run_cases"
SET "participant_execution_fingerprint" = "input_fingerprint";--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ALTER COLUMN "participant_execution_fingerprint" SET NOT NULL;--> statement-breakpoint
UPDATE "run_benchmarks"
SET
	"target" = '{"gradingDurationMs":0,"gradingInputTokens":0,"gradingOutputTokens":0,"gradingTotalCostUsd":0,"gradingNumTurns":0}'::jsonb || "target",
	"baseline" = '{"gradingDurationMs":0,"gradingInputTokens":0,"gradingOutputTokens":0,"gradingTotalCostUsd":0,"gradingNumTurns":0}'::jsonb || "baseline";--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "baseline_skill_version_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "baseline_skill_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "execution_policy" "test_run_execution_policy";--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "semantic_configuration_fingerprint" text;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "environment_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "baseline_skill_manifest_hash" text;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "execution_prompt_version" text;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "grader_protocol_version" text;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "tool_permission_policy_version" text;--> statement-breakpoint
UPDATE "skill_test_runs"
SET
	"execution_policy" = 'target_then_no_skill_serial_v1',
	"semantic_configuration_fingerprint" = "configuration_fingerprint",
	"environment_snapshot" = '{"status":"legacy_unavailable"}'::jsonb,
	"execution_prompt_version" = 'legacy_unavailable',
	"grader_protocol_version" = 'legacy_unavailable',
	"tool_permission_policy_version" = 'legacy_unavailable';--> statement-breakpoint
ALTER TABLE "skill_test_runs" ALTER COLUMN "execution_policy" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ALTER COLUMN "semantic_configuration_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ALTER COLUMN "environment_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ALTER COLUMN "execution_prompt_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ALTER COLUMN "grader_protocol_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ALTER COLUMN "tool_permission_policy_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_baseline_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("baseline_skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_baseline_skill_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("baseline_skill_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" DROP CONSTRAINT "skill_test_run_cases_input_hash_check";--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_input_hash_check" CHECK ("skill_test_run_cases"."input_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_run_cases"."participant_execution_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_observation_check" CHECK ("skill_test_run_cases"."skill_tool_call_count" >= 0
        and jsonb_typeof("skill_test_run_cases"."bundled_script_uses") = 'array');--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_execution_policy_check" CHECK (("skill_test_runs"."mode"::text = 'target_vs_no_skill'
          and "skill_test_runs"."execution_policy" = 'target_then_no_skill_serial_v1')
        or ("skill_test_runs"."mode"::text = 'version_vs_version'
          and "skill_test_runs"."execution_policy" = 'paired_serial_alternating_v1'));--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_environment_snapshot_check" CHECK (jsonb_typeof("skill_test_runs"."environment_snapshot") = 'object');--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_protocol_metadata_check" CHECK (char_length(trim("skill_test_runs"."execution_prompt_version")) between 1 and 120
        and char_length(trim("skill_test_runs"."grader_protocol_version")) between 1 and 120
        and char_length(trim("skill_test_runs"."tool_permission_policy_version")) between 1 and 120);--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_target_check" CHECK ((
          "skill_test_runs"."mode"::text = 'target_vs_no_skill'
          and ("skill_test_runs"."skill_draft_revision_id" is not null or "skill_test_runs"."skill_version_id" is not null)
          and "skill_test_runs"."baseline_skill_version_id" is null
          and "skill_test_runs"."baseline_skill_snapshot_id" is null
          and "skill_test_runs"."baseline_skill_manifest_hash" is null
        ) or (
          "skill_test_runs"."mode"::text = 'version_vs_version'
          and "skill_test_runs"."skill_draft_revision_id" is null
          and "skill_test_runs"."skill_version_id" is not null
          and "skill_test_runs"."baseline_skill_version_id" is not null
          and "skill_test_runs"."baseline_skill_snapshot_id" is not null
          and "skill_test_runs"."baseline_skill_manifest_hash" is not null
          and "skill_test_runs"."skill_version_id" <> "skill_test_runs"."baseline_skill_version_id"
        ));--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_hashes_check" CHECK ("skill_test_runs"."skill_creator_tree_hash" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."semantic_configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."environment_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."skill_manifest_hash" ~ '^[0-9a-f]{64}$'
        and ("skill_test_runs"."baseline_skill_manifest_hash" is null
          or "skill_test_runs"."baseline_skill_manifest_hash" ~ '^[0-9a-f]{64}$')
        and "skill_test_runs"."eval_manifest_hash" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."comparability_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."run_input_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."request_hash" ~ '^[0-9a-f]{64}$');
