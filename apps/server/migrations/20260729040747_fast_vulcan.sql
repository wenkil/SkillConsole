CREATE TABLE "skill_draft_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"draft_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"media_type_hint" text NOT NULL,
	"content_kind" text NOT NULL,
	CONSTRAINT "skill_draft_files_path_check" CHECK (char_length("skill_draft_files"."relative_path") between 1 and 512),
	CONSTRAINT "skill_draft_files_sha256_check" CHECK ("skill_draft_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_draft_files_byte_size_check" CHECK ("skill_draft_files"."byte_size" >= 0),
	CONSTRAINT "skill_draft_files_content_kind_check" CHECK ("skill_draft_files"."content_kind" in ('text', 'binary'))
);
--> statement-breakpoint
ALTER TABLE "skill_draft_mutations" ALTER COLUMN "result_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_drafts" ALTER COLUMN "base_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_drafts" ALTER COLUMN "current_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD COLUMN "working_storage_locator" text;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD COLUMN "file_count" integer;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD COLUMN "total_bytes" bigint;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "labels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_operations" ADD COLUMN "manifest_hash" text;--> statement-breakpoint
UPDATE "skill_drafts"
SET
	"working_storage_locator" = 'drafts/' || "skill_drafts"."id"::text,
	"file_count" = "skill_snapshots"."file_count",
	"total_bytes" = "skill_snapshots"."total_bytes"
FROM "skill_snapshots"
WHERE "skill_snapshots"."id" = "skill_drafts"."current_snapshot_id";--> statement-breakpoint
INSERT INTO "skill_draft_files" (
	"draft_id",
	"relative_path",
	"sha256",
	"byte_size",
	"media_type_hint",
	"content_kind"
)
SELECT
	"skill_drafts"."id",
	"skill_snapshot_files"."relative_path",
	"skill_snapshot_files"."sha256",
	"skill_snapshot_files"."byte_size",
	"skill_snapshot_files"."media_type_hint",
	"skill_snapshot_files"."content_kind"
FROM "skill_drafts"
INNER JOIN "skill_snapshot_files"
	ON "skill_snapshot_files"."snapshot_id" = "skill_drafts"."current_snapshot_id";--> statement-breakpoint
UPDATE "skill_versions"
SET "name" = 'V' || "skill_versions"."version_number"::text;--> statement-breakpoint
UPDATE "upload_operations"
SET "manifest_hash" = "skill_snapshots"."manifest_hash"
FROM "skill_snapshots"
WHERE "skill_snapshots"."id" = "upload_operations"."snapshot_id";--> statement-breakpoint
ALTER TABLE "skill_drafts" ALTER COLUMN "working_storage_locator" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_drafts" ALTER COLUMN "file_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_drafts" ALTER COLUMN "total_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_versions" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_draft_files" ADD CONSTRAINT "skill_draft_files_draft_id_skill_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."skill_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_draft_files_path_unique" ON "skill_draft_files" USING btree ("draft_id","relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_draft_files_casefold_path_unique" ON "skill_draft_files" USING btree ("draft_id",lower("relative_path"));--> statement-breakpoint
CREATE INDEX "skill_draft_files_draft_path_idx" ON "skill_draft_files" USING btree ("draft_id","relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_workspace_name_unique" ON "skill_versions" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_file_count_check" CHECK ("skill_drafts"."file_count" >= 1);--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_total_bytes_check" CHECK ("skill_drafts"."total_bytes" >= 0);
