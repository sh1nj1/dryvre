CREATE TYPE "public"."agent_loop_state" AS ENUM('checking', 'waiting_input', 'ready', 'running', 'verifying', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_trigger_delivery_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "agent_loop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_block_id" uuid NOT NULL,
	"trigger_version" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"agent_block_id" uuid NOT NULL,
	"state" "agent_loop_state" DEFAULT 'checking' NOT NULL,
	"request_block_id" uuid,
	"agent_run_id" uuid,
	"resume_status" "block_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_trigger_delivery" (
	"trigger_block_id" uuid NOT NULL,
	"op_sequence" integer NOT NULL,
	"status" "agent_trigger_delivery_status" DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_trigger_delivery_trigger_block_id_op_sequence_pk" PRIMARY KEY("trigger_block_id","op_sequence")
);
--> statement-breakpoint
CREATE TABLE "subject_inbox" (
	"subject_id" uuid PRIMARY KEY NOT NULL,
	"block_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_task_block_id_block_id_fk" FOREIGN KEY ("task_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_requested_by_subject_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_agent_block_id_block_id_fk" FOREIGN KEY ("agent_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_request_block_id_block_id_fk" FOREIGN KEY ("request_block_id") REFERENCES "public"."block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop" ADD CONSTRAINT "agent_loop_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trigger_delivery" ADD CONSTRAINT "agent_trigger_delivery_trigger_block_id_block_id_fk" FOREIGN KEY ("trigger_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trigger_delivery" ADD CONSTRAINT "agent_trigger_delivery_op_sequence_op_log_sequence_fk" FOREIGN KEY ("op_sequence") REFERENCES "public"."op_log"("sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_inbox" ADD CONSTRAINT "subject_inbox_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_inbox" ADD CONSTRAINT "subject_inbox_block_id_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."block"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_loop_task_trigger_uq" ON "agent_loop" USING btree ("task_block_id","trigger_version");--> statement-breakpoint
CREATE INDEX "agent_loop_request_idx" ON "agent_loop" USING btree ("request_block_id");--> statement-breakpoint
CREATE INDEX "agent_loop_state_idx" ON "agent_loop" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_inbox_block_uq" ON "subject_inbox" USING btree ("block_id");--> statement-breakpoint
INSERT INTO "subject" ("id", "kind", "handle", "display_name") VALUES
('00000000-0000-4000-8000-000000000230', 'agent', 'agent-pm', 'PM Agent'),
('00000000-0000-4000-8000-000000000240', 'agent', 'agent-developer', 'Developer Agent');--> statement-breakpoint
INSERT INTO "block" ("id", "parent_id", "path", "rank", "body_md", "status", "author_id") VALUES
('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000110/', 'a1', '# Inbox', NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000120', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000120/', 'a2', '# Launch Dryvre', NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000120', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000120/00000000-0000-4000-8000-000000000121/', 'a1', $$## Launch requirements

Publish a stable public demo URL, keep the complete story under three minutes, and preserve one canonical block across Document, Board, and Stream views.$$, NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000120', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000120/00000000-0000-4000-8000-000000000122/', 'a2', $$## Prepare deterministic demo environment

The seeded workspace and fake runner are ready for recording.$$, 'done', '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000130', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000130/', 'e0', $$# @agent pm-agent
Turn the focused launch context into one editable execution contract. Leave decisions that only the user can make explicit instead of guessing.$$, NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000130', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000130/00000000-0000-4000-8000-000000000131/', 'e1', $$```agent-config
{"workspace":"dryvre","reasoningEffort":"low"}
```$$, NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000132', '00000000-0000-4000-8000-000000000130', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000130/00000000-0000-4000-8000-000000000132/', 'e2', $$```agent-trigger
{"event":"block_created","mention":"PM Agent","workflow":"draft_task","streamOnly":true,"actorKind":"human"}
```$$, NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000140', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000140/', 'f0', $$# @agent developer-agent
Validate the complete task contract before acting. Ask for missing decisions, then execute, verify, and record concise evidence under the same task.$$, NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000140', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000140/00000000-0000-4000-8000-000000000141/', 'f1', $$```agent-config
{"workspace":"dryvre","reasoningEffort":"low"}
```$$, NULL, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000140', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000140/00000000-0000-4000-8000-000000000142/', 'f2', $$```agent-trigger
{"event":"status_changed","toStatus":"todo","mention":"Developer Agent","workflow":"task_loop","actorKind":"human"}
```$$, NULL, '00000000-0000-4000-8000-000000000001');--> statement-breakpoint
INSERT INTO "subject_inbox" ("subject_id", "block_id") VALUES
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000110');--> statement-breakpoint
INSERT INTO "agent_binding" ("agent_block_id", "subject_id") VALUES
('00000000-0000-4000-8000-000000000130', '00000000-0000-4000-8000-000000000230'),
('00000000-0000-4000-8000-000000000140', '00000000-0000-4000-8000-000000000240');
