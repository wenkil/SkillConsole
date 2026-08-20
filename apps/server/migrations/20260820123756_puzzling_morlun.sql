CREATE TABLE "eval_generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"request_idempotency_key" text NOT NULL,
	"agent_session_id" uuid,
	"status" "eval_generation_status" NOT NULL,
	"error_code" text,
	"error_message" text,
	"error_details" jsonb,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "eval_generation_events_source_agent_unique";--> statement-breakpoint
ALTER TABLE "eval_generation_events" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_generation_attempts" ADD CONSTRAINT "eval_generation_attempts_task_id_eval_generation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eval_generation_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_generation_attempts" ADD CONSTRAINT "eval_generation_attempts_agent_session_id_agent_sessions_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "eval_generation_attempts" (
	"id", "task_id", "attempt_number", "request_idempotency_key", "agent_session_id", "status",
	"error_code", "error_message", "error_details", "usage", "created_at", "updated_at", "started_at", "completed_at"
)
SELECT uuidv7(), task."id", 1, CONCAT('initial:', task."id"), task."agent_session_id", task."status",
	task."error_code", task."error_message", task."error_details", task."usage", task."created_at", task."updated_at", task."started_at", task."completed_at"
FROM "eval_generation_tasks" AS task;--> statement-breakpoint
UPDATE "eval_generation_events" AS event SET "attempt_id" = attempt."id"
FROM "eval_generation_attempts" AS attempt
WHERE attempt."task_id" = event."task_id" AND attempt."attempt_number" = 1;--> statement-breakpoint
ALTER TABLE "eval_generation_events" ALTER COLUMN "attempt_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_attempts_task_number_unique" ON "eval_generation_attempts" USING btree ("task_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_attempts_task_request_unique" ON "eval_generation_attempts" USING btree ("task_id","request_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_attempts_agent_session_unique" ON "eval_generation_attempts" USING btree ("agent_session_id") WHERE "eval_generation_attempts"."agent_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_attempts_active_task_unique" ON "eval_generation_attempts" USING btree ("task_id") WHERE "eval_generation_attempts"."status" in ('PREPARING', 'RUNNING', 'VALIDATING', 'CANCELING');--> statement-breakpoint
CREATE INDEX "eval_generation_attempts_task_number_idx" ON "eval_generation_attempts" USING btree ("task_id","attempt_number");--> statement-breakpoint
ALTER TABLE "eval_generation_events" ADD CONSTRAINT "eval_generation_events_attempt_id_eval_generation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."eval_generation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_generation_events_source_agent_unique" ON "eval_generation_events" USING btree ("attempt_id","source_agent_sequence") WHERE "eval_generation_events"."source_agent_sequence" is not null;
