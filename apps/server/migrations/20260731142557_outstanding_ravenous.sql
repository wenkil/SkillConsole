ALTER TABLE "skill_test_runs" ALTER COLUMN "skill_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD COLUMN "skill_draft_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "source_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "source_content_revision" integer;--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_skill_draft_revision_id_skill_draft_revisions_id_fk" FOREIGN KEY ("skill_draft_revision_id") REFERENCES "public"."skill_draft_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_source_draft_id_skill_drafts_id_fk" FOREIGN KEY ("source_draft_id") REFERENCES "public"."skill_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_versions_draft_origin_idx" ON "skill_versions" USING btree ("source_draft_id","source_content_revision","published_at");--> statement-breakpoint
ALTER TABLE "skill_test_runs" ADD CONSTRAINT "skill_test_runs_target_check" CHECK ("skill_test_runs"."skill_draft_revision_id" is not null or "skill_test_runs"."skill_version_id" is not null);--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_draft_origin_check" CHECK (("skill_versions"."source_draft_id" is null and "skill_versions"."source_content_revision" is null)
        or ("skill_versions"."source_draft_id" is not null and "skill_versions"."source_content_revision" >= 1));
