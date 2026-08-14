CREATE TYPE "public"."test_report_analysis_revision_status" AS ENUM('PENDING', 'RUNNING', 'AVAILABLE', 'FAILED');--> statement-breakpoint
CREATE TABLE "skill_test_report_analyses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"report_id" uuid NOT NULL,
	"report_revision_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "test_report_analysis_revision_status" DEFAULT 'PENDING' NOT NULL,
	"agent_session_id" uuid,
	"model_id" text NOT NULL,
	"actual_model_id" text,
	"configuration_fingerprint" text NOT NULL,
	"semantic_configuration_fingerprint" text NOT NULL,
	"runtime_policy" jsonb NOT NULL,
	"runtime_policy_fingerprint" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"selected_eval_revision_case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analysis_snapshot" jsonb,
	"usage" jsonb,
	"error_code" text,
	"error_message" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "skill_test_report_analyses_revision_check" CHECK ("skill_test_report_analyses"."revision_number" >= 1),
	CONSTRAINT "skill_test_report_analyses_hash_check" CHECK ("skill_test_report_analyses"."input_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_report_analyses"."configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_report_analyses"."semantic_configuration_fingerprint" ~ '^[0-9a-f]{64}$'
        and "skill_test_report_analyses"."runtime_policy_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_test_report_analyses_json_check" CHECK (jsonb_typeof("skill_test_report_analyses"."selected_eval_revision_case_ids") = 'array'
        and jsonb_typeof("skill_test_report_analyses"."runtime_policy") = 'object'
        and ("skill_test_report_analyses"."analysis_snapshot" is null or jsonb_typeof("skill_test_report_analyses"."analysis_snapshot") = 'object')
        and ("skill_test_report_analyses"."usage" is null or jsonb_typeof("skill_test_report_analyses"."usage") = 'object')),
	CONSTRAINT "skill_test_report_analyses_text_check" CHECK (char_length("skill_test_report_analyses"."model_id") between 1 and 200
        and ("skill_test_report_analyses"."actual_model_id" is null or char_length("skill_test_report_analyses"."actual_model_id") between 1 and 200)
        and char_length("skill_test_report_analyses"."prompt_version") between 1 and 200
        and char_length("skill_test_report_analyses"."idempotency_key") between 1 and 200),
	CONSTRAINT "skill_test_report_analyses_state_check" CHECK (("skill_test_report_analyses"."status" = 'PENDING'
          and "skill_test_report_analyses"."agent_session_id" is null
          and "skill_test_report_analyses"."started_at" is null
          and "skill_test_report_analyses"."completed_at" is null
          and "skill_test_report_analyses"."analysis_snapshot" is null
          and "skill_test_report_analyses"."error_code" is null
          and "skill_test_report_analyses"."error_message" is null)
        or ("skill_test_report_analyses"."status" = 'RUNNING'
          and "skill_test_report_analyses"."agent_session_id" is not null
          and "skill_test_report_analyses"."started_at" is not null
          and "skill_test_report_analyses"."completed_at" is null
          and "skill_test_report_analyses"."analysis_snapshot" is null
          and "skill_test_report_analyses"."error_code" is null
          and "skill_test_report_analyses"."error_message" is null)
        or ("skill_test_report_analyses"."status" = 'AVAILABLE'
          and "skill_test_report_analyses"."agent_session_id" is not null
          and "skill_test_report_analyses"."started_at" is not null
          and "skill_test_report_analyses"."completed_at" is not null
          and "skill_test_report_analyses"."analysis_snapshot" is not null
          and "skill_test_report_analyses"."usage" is not null
          and "skill_test_report_analyses"."error_code" is null
          and "skill_test_report_analyses"."error_message" is null)
        or ("skill_test_report_analyses"."status" = 'FAILED'
          and "skill_test_report_analyses"."completed_at" is not null
          and "skill_test_report_analyses"."analysis_snapshot" is null
          and "skill_test_report_analyses"."error_code" is not null
          and "skill_test_report_analyses"."error_message" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_revisions_id_report_unique" ON "skill_test_report_revisions" USING btree ("id","report_id");--> statement-breakpoint
ALTER TABLE "skill_test_report_analyses" ADD CONSTRAINT "skill_test_report_analyses_report_id_skill_test_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."skill_test_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_analyses" ADD CONSTRAINT "skill_test_report_analyses_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_test_report_analyses" ADD CONSTRAINT "skill_test_report_analyses_revision_report_fk" FOREIGN KEY ("report_revision_id","report_id") REFERENCES "public"."skill_test_report_revisions"("id","report_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_analyses_revision_unique" ON "skill_test_report_analyses" USING btree ("report_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_analyses_idempotency_unique" ON "skill_test_report_analyses" USING btree ("report_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_test_report_analyses_agent_session_unique" ON "skill_test_report_analyses" USING btree ("agent_session_id") WHERE "skill_test_report_analyses"."agent_session_id" is not null;--> statement-breakpoint
CREATE INDEX "skill_test_report_analyses_report_created_idx" ON "skill_test_report_analyses" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "skill_test_report_analyses_status_created_idx" ON "skill_test_report_analyses" USING btree ("status","created_at");
