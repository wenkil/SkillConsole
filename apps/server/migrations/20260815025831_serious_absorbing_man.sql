ALTER TABLE "eval_generation_tasks" DROP CONSTRAINT "eval_generation_tasks_commit_check";--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" DROP CONSTRAINT "eval_generation_tasks_tree_hash_check";--> statement-breakpoint
ALTER TABLE "eval_revisions" DROP CONSTRAINT "eval_revisions_commit_check";--> statement-breakpoint
ALTER TABLE "eval_revisions" DROP CONSTRAINT "eval_revisions_hashes_check";--> statement-breakpoint
ALTER TABLE "skill_test_runs" DROP CONSTRAINT "skill_test_runs_creator_commit_check";--> statement-breakpoint
ALTER TABLE "skill_test_runs" DROP CONSTRAINT "skill_test_runs_hashes_check";--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" DROP COLUMN "skill_creator_commit";--> statement-breakpoint
ALTER TABLE "eval_generation_tasks" DROP COLUMN "skill_creator_tree_hash";--> statement-breakpoint
ALTER TABLE "eval_revisions" DROP COLUMN "skill_creator_commit";--> statement-breakpoint
ALTER TABLE "eval_revisions" DROP COLUMN "skill_creator_tree_hash";--> statement-breakpoint
ALTER TABLE "skill_test_runs" DROP COLUMN "skill_creator_commit";--> statement-breakpoint
ALTER TABLE "skill_test_runs" DROP COLUMN "skill_creator_tree_hash";--> statement-breakpoint
ALTER TABLE "eval_revisions" ADD CONSTRAINT "eval_revisions_hashes_check" CHECK ("eval_revisions"."manifest_hash" ~ '^[0-9a-f]{64}$'
        and "eval_revisions"."raw_evals_sha256" ~ '^[0-9a-f]{64}$'
        and "eval_revisions"."configuration_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_hashes_check" CHECK ("skill_test_runs"."configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."semantic_configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."environment_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."skill_manifest_hash" ~ '^[0-9a-f]{64}$'
        and ("skill_test_runs"."baseline_skill_manifest_hash" is null
          or "skill_test_runs"."baseline_skill_manifest_hash" ~ '^[0-9a-f]{64}$')
        and "skill_test_runs"."eval_manifest_hash" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."comparability_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."run_input_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_runs"."request_hash" ~ '^[0-9a-f]{64}$');