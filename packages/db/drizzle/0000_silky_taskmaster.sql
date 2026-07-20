CREATE TYPE "public"."block_status" AS ENUM('todo', 'in_progress', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."grant_level" AS ENUM('read', 'write', 'manage');--> statement-breakpoint
CREATE TYPE "public"."subject_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TABLE "block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"rank" text,
	"body_md" text DEFAULT '' NOT NULL,
	"status" "block_status",
	"author_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant" (
	"block_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"level" "grant_level" NOT NULL,
	CONSTRAINT "grant_block_id_subject_id_pk" PRIMARY KEY("block_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "op_log" (
	"sequence" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "op_log_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client_op_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref" (
	"from_block_id" uuid NOT NULL,
	"to_block_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ref_from_block_id_to_block_id_pk" PRIMARY KEY("from_block_id","to_block_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "subject_kind" DEFAULT 'human' NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_parent_id_block_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_author_id_subject_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_log" ADD CONSTRAINT "op_log_actor_id_subject_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref" ADD CONSTRAINT "ref_from_block_id_block_id_fk" FOREIGN KEY ("from_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref" ADD CONSTRAINT "ref_to_block_id_block_id_fk" FOREIGN KEY ("to_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_parent_rank_idx" ON "block" USING btree ("parent_id","rank","created_at");--> statement-breakpoint
CREATE INDEX "block_path_prefix_idx" ON "block" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "block_status_idx" ON "block" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "op_log_id_uq" ON "op_log" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "op_log_client_actor_uq" ON "op_log" USING btree ("client_op_id","actor_id");--> statement-breakpoint
CREATE INDEX "ref_to_block_idx" ON "ref" USING btree ("to_block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_uq" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_subject_idx" ON "session" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_handle_uq" ON "subject" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "block_fts_idx" ON "block" USING gin (to_tsvector('simple', "body_md"));--> statement-breakpoint
INSERT INTO "subject" ("id", "handle", "display_name")
VALUES ('00000000-0000-4000-8000-000000000001', 'builder', 'Dryvre Builder');--> statement-breakpoint
INSERT INTO "block" ("id", "parent_id", "path", "rank", "body_md", "author_id")
VALUES (
	'00000000-0000-4000-8000-000000000010', NULL,
	'/00000000-0000-4000-8000-000000000010/', 'a0', '# Dryvre',
	'00000000-0000-4000-8000-000000000001'
);
