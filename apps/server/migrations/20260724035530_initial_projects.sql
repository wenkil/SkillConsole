CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_length_check" CHECK (char_length(trim("projects"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_name_unique" ON "projects" USING btree (lower("name"));