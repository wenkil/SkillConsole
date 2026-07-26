CREATE TYPE "public"."skill_draft_status" AS ENUM('OPEN', 'FINALIZING', 'CLOSED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."skill_improvement_cycle_status" AS ENUM('DRAFTING', 'VERSION_PUBLISHED', 'VALIDATING', 'COMPLETED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."skill_snapshot_kind" AS ENUM('DRAFT_WORKING', 'DRAFT_FROZEN', 'VERSION');--> statement-breakpoint
CREATE TYPE "public"."skill_snapshot_state" AS ENUM('STAGING', 'READY', 'CORRUPTED');--> statement-breakpoint
CREATE TYPE "public"."skill_source_type" AS ENUM('single_file', 'folder', 'zip');--> statement-breakpoint
CREATE TYPE "public"."upload_operation_state" AS ENUM('RECEIVING', 'VALIDATING', 'COMMITTING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "skill_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"base_version_id" uuid,
	"base_snapshot_id" uuid NOT NULL,
	"current_snapshot_id" uuid NOT NULL,
	"status" "skill_draft_status" NOT NULL,
	"content_revision" integer DEFAULT 1 NOT NULL,
	"source_type" "skill_source_type" NOT NULL,
	"source_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_drafts_content_revision_check" CHECK ("skill_drafts"."content_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "skill_improvement_cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"base_version_id" uuid,
	"draft_id" uuid NOT NULL,
	"released_version_id" uuid,
	"status" "skill_improvement_cycle_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_published_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skill_snapshot_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"media_type_hint" text NOT NULL,
	"content_kind" text NOT NULL,
	CONSTRAINT "skill_snapshot_files_path_check" CHECK (char_length("skill_snapshot_files"."relative_path") between 1 and 512),
	CONSTRAINT "skill_snapshot_files_sha256_check" CHECK ("skill_snapshot_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_snapshot_files_byte_size_check" CHECK ("skill_snapshot_files"."byte_size" >= 0),
	CONSTRAINT "skill_snapshot_files_content_kind_check" CHECK ("skill_snapshot_files"."content_kind" in ('text', 'binary'))
);
--> statement-breakpoint
CREATE TABLE "skill_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "skill_snapshot_kind" NOT NULL,
	"state" "skill_snapshot_state" NOT NULL,
	"manifest_hash" text NOT NULL,
	"storage_locator" text NOT NULL,
	"file_count" integer NOT NULL,
	"total_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_snapshots_manifest_hash_check" CHECK ("skill_snapshots"."manifest_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_snapshots_file_count_check" CHECK ("skill_snapshots"."file_count" >= 1),
	CONSTRAINT "skill_snapshots_total_bytes_check" CHECK ("skill_snapshots"."total_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_type" "skill_source_type" NOT NULL,
	"source_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_version_number_check" CHECK ("skill_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "skill_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"current_version_id" uuid,
	"default_baseline_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_workspaces_name_length_check" CHECK (char_length(trim("skill_workspaces"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "upload_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"snapshot_id" uuid,
	"draft_id" uuid,
	"improvement_cycle_id" uuid,
	"workspace_name" text NOT NULL,
	"source_type" "skill_source_type" NOT NULL,
	"source_name" text,
	"ignored_file_count" integer DEFAULT 0 NOT NULL,
	"stripped_root" text,
	"state" "upload_operation_state" NOT NULL,
	"error_code" text,
	"error_message" text,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "upload_operations_workspace_name_check" CHECK (char_length(trim("upload_operations"."workspace_name")) between 1 and 120),
	CONSTRAINT "upload_operations_ignored_count_check" CHECK ("upload_operations"."ignored_file_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_base_version_id_skill_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_base_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_current_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("current_snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_improvement_cycles" ADD CONSTRAINT "skill_improvement_cycles_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_improvement_cycles" ADD CONSTRAINT "skill_improvement_cycles_base_version_id_skill_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_improvement_cycles" ADD CONSTRAINT "skill_improvement_cycles_draft_id_skill_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."skill_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_improvement_cycles" ADD CONSTRAINT "skill_improvement_cycles_released_version_id_skill_versions_id_fk" FOREIGN KEY ("released_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_snapshot_files" ADD CONSTRAINT "skill_snapshot_files_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_snapshots" ADD CONSTRAINT "skill_snapshots_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_workspaces" ADD CONSTRAINT "skill_workspaces_current_version_id_skill_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_workspaces" ADD CONSTRAINT "skill_workspaces_default_baseline_version_id_skill_versions_id_fk" FOREIGN KEY ("default_baseline_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_operations" ADD CONSTRAINT "upload_operations_workspace_id_skill_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."skill_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_operations" ADD CONSTRAINT "upload_operations_snapshot_id_skill_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."skill_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_operations" ADD CONSTRAINT "upload_operations_draft_id_skill_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."skill_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_operations" ADD CONSTRAINT "upload_operations_improvement_cycle_id_skill_improvement_cycles_id_fk" FOREIGN KEY ("improvement_cycle_id") REFERENCES "public"."skill_improvement_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_drafts_active_workspace_unique" ON "skill_drafts" USING btree ("workspace_id") WHERE "skill_drafts"."status" in ('OPEN', 'FINALIZING');--> statement-breakpoint
CREATE INDEX "skill_drafts_workspace_updated_idx" ON "skill_drafts" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_improvement_cycles_draft_unique" ON "skill_improvement_cycles" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "skill_improvement_cycles_workspace_updated_idx" ON "skill_improvement_cycles" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_snapshot_files_path_unique" ON "skill_snapshot_files" USING btree ("snapshot_id","relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_snapshot_files_casefold_path_unique" ON "skill_snapshot_files" USING btree ("snapshot_id",lower("relative_path"));--> statement-breakpoint
CREATE UNIQUE INDEX "skill_snapshots_storage_locator_unique" ON "skill_snapshots" USING btree ("storage_locator");--> statement-breakpoint
CREATE INDEX "skill_snapshots_workspace_created_idx" ON "skill_snapshots" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_workspace_number_unique" ON "skill_versions" USING btree ("workspace_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_snapshot_unique" ON "skill_versions" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "skill_versions_workspace_published_idx" ON "skill_versions" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_workspaces_name_unique" ON "skill_workspaces" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "upload_operations_state_updated_idx" ON "upload_operations" USING btree ("state","updated_at");