CREATE TYPE "public"."agent_session_log_artifact_status" AS ENUM('WRITING', 'COMPLETE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."agent_session_log_status" AS ENUM('WRITING', 'COMPLETE', 'DEGRADED', 'FAILED', 'RECOVERY_REQUIRED');--> statement-breakpoint
CREATE TABLE "agent_session_log_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_session_id" uuid NOT NULL,
	"sdk_session_id" text,
	"artifact_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" "agent_session_log_artifact_status" NOT NULL,
	"byte_size" bigint,
	"sha256" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "origin_type" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "origin_key" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "log_status" "agent_session_log_status";--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "log_error_code" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "log_error_message" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "logs_finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_session_log_artifacts" ADD CONSTRAINT "agent_session_log_artifacts_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_log_artifacts_path_unique" ON "agent_session_log_artifacts" USING btree ("agent_session_id","storage_path");--> statement-breakpoint
CREATE INDEX "agent_session_log_artifacts_session_type_idx" ON "agent_session_log_artifacts" USING btree ("agent_session_id","artifact_type");--> statement-breakpoint
CREATE INDEX "agent_sessions_origin_idx" ON "agent_sessions" USING btree ("origin_type","origin_key");--> statement-breakpoint
CREATE INDEX "agent_sessions_log_status_idx" ON "agent_sessions" USING btree ("log_status","updated_at");