CREATE TABLE "skill_test_run_score_report_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"report_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_test_run_score_report_events" ADD CONSTRAINT "skill_test_run_score_report_events_report_id_skill_test_run_score_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."skill_test_run_score_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_run_score_report_events_report_sequence_unique" ON "skill_test_run_score_report_events" USING btree ("report_id","sequence");--> statement-breakpoint
CREATE INDEX "skill_test_run_score_report_events_report_occurred_idx" ON "skill_test_run_score_report_events" USING btree ("report_id","occurred_at");