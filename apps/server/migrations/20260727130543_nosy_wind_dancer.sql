CREATE TABLE "skill_draft_mutations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"draft_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"base_content_revision" integer NOT NULL,
	"result_content_revision" integer NOT NULL,
	"result_snapshot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_draft_mutations_idempotency_key_check" CHECK (char_length("skill_draft_mutations"."idempotency_key") between 1 and 200),
	CONSTRAINT "skill_draft_mutations_request_hash_check" CHECK ("skill_draft_mutations"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_draft_mutations_revision_check" CHECK ("skill_draft_mutations"."base_content_revision" >= 1 and "skill_draft_mutations"."result_content_revision" = "skill_draft_mutations"."base_content_revision" + 1)
);
--> statement-breakpoint
CREATE TABLE "skill_draft_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"draft_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"source_content_revision" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_draft_revisions_source_revision_check" CHECK ("skill_draft_revisions"."source_content_revision" >= 1),
	CONSTRAINT "skill_draft_revisions_reason_check" CHECK ("skill_draft_revisions"."reason" in ('TRIAL', 'PRE_REGRESSION', 'RELEASE_GATE', 'FINALIZE'))
);
--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD COLUMN "ignore_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD COLUMN "current_ignored_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_draft_mutations" ADD CONSTRAINT "skill_draft_mutations_draft_id_skill_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."skill_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_draft_mutations" ADD CONSTRAINT "skill_draft_mutations_result_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("result_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_draft_revisions" ADD CONSTRAINT "skill_draft_revisions_draft_id_skill_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."skill_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_draft_revisions" ADD CONSTRAINT "skill_draft_revisions_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_draft_mutations_idempotency_unique" ON "skill_draft_mutations" USING btree ("draft_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "skill_draft_mutations_draft_created_idx" ON "skill_draft_mutations" USING btree ("draft_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_draft_revisions_snapshot_unique" ON "skill_draft_revisions" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "skill_draft_revisions_draft_created_idx" ON "skill_draft_revisions" USING btree ("draft_id","created_at");