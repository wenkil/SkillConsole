CREATE TYPE "public"."agent_session_status" AS ENUM('STARTING', 'RUNNING', 'IDLE', 'CANCELING', 'INTERRUPTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."agent_session_turn_status" AS ENUM('RUNNING', 'COMPLETED', 'CANCELED', 'INTERRUPTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "agent_session_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"status" "agent_session_turn_status" NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sdk_session_id" text,
	"status" "agent_session_status" NOT NULL,
	"workspace_locator" text NOT NULL,
	"next_event_sequence" bigint DEFAULT 1 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session_events" ADD CONSTRAINT "agent_session_events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_events" ADD CONSTRAINT "agent_session_events_turn_id_agent_session_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_session_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_turns" ADD CONSTRAINT "agent_session_turns_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_events_sequence_unique" ON "agent_session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "agent_session_events_session_occurred_idx" ON "agent_session_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_session_turns_session_started_idx" ON "agent_session_turns" USING btree ("session_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sessions_sdk_session_unique" ON "agent_sessions" USING btree ("sdk_session_id") WHERE "agent_sessions"."sdk_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sessions_workspace_locator_unique" ON "agent_sessions" USING btree ("workspace_locator");--> statement-breakpoint
CREATE INDEX "agent_sessions_status_updated_idx" ON "agent_sessions" USING btree ("status","updated_at");