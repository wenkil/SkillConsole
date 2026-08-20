CREATE TYPE "public"."test_run_skill_score_report_status" AS ENUM('PENDING', 'RUNNING', 'AVAILABLE', 'FAILED');--> statement-breakpoint
CREATE TABLE "skill_test_run_score_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" "test_run_skill_score_report_status" DEFAULT 'PENDING' NOT NULL,
	"agent_session_id" uuid,
	"html" text,
	"raw_response" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "assertion_agent_session_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "assertion_agent_raw_response" text;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "assertion_agent_json" jsonb;--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD COLUMN "assertion_json_parse_error" text;--> statement-breakpoint
ALTER TABLE "skill_test_run_score_reports" ADD CONSTRAINT "skill_test_run_score_reports_run_id_skill_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_run_score_reports" ADD CONSTRAINT "skill_test_run_score_reports_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_score_reports_run_unique" ON "skill_test_run_score_reports" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_score_reports_session_unique" ON "skill_test_run_score_reports" USING btree ("agent_session_id") WHERE "skill_test_run_score_reports"."agent_session_id" is not null;--> statement-breakpoint
CREATE INDEX "skill_test_run_score_reports_status_created_idx" ON "skill_test_run_score_reports" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "skill_test_run_cases" ADD CONSTRAINT "skill_test_run_cases_assertion_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("assertion_agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE restrict ON UPDATE no action;