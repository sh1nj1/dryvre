CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_binding" (
	"agent_block_id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_block_id" uuid NOT NULL,
	"target_block_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"codex_session_id" text,
	"pid" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_binding" ADD CONSTRAINT "agent_binding_agent_block_id_block_id_fk" FOREIGN KEY ("agent_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_binding" ADD CONSTRAINT "agent_binding_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_block_id_block_id_fk" FOREIGN KEY ("agent_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_target_block_id_block_id_fk" FOREIGN KEY ("target_block_id") REFERENCES "public"."block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_requested_by_subject_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_binding_subject_uq" ON "agent_binding" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "agent_run_agent_created_idx" ON "agent_run" USING btree ("agent_block_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_status_idx" ON "agent_run" USING btree ("status");--> statement-breakpoint
INSERT INTO "block" ("id", "parent_id", "path", "rank", "body_md", "author_id") VALUES
('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000020/', 'b0', $$# @agent product-engineer
Implement the smallest complete change, preserve existing behavior, and verify it before reporting.$$,
'00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000020/00000000-0000-4000-8000-000000000021/', 'b1', $$```agent-config
{"workspace":"dryvre","reasoningEffort":"medium"}
```$$, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000030/', 'c0', $$# @agent qa
Review the focused change, run relevant checks, and report concrete failures with reproduction steps.$$,
'00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000030', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000030/00000000-0000-4000-8000-000000000031/', 'c1', $$```agent-config
{"workspace":"dryvre","reasoningEffort":"low"}
```$$, '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000040/', 'd0', '# Shared Skills', '00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000040', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000040/00000000-0000-4000-8000-000000000041/', 'd1', $$# @skill verify-dryvre
Use when changing Dryvre. Run targeted tests first, then typecheck and build before reporting completion.$$,
'00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000041', '/00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000040/00000000-0000-4000-8000-000000000041/00000000-0000-4000-8000-000000000042/', 'd2', $$```file:scripts/verify.sh
#!/usr/bin/env bash
set -euo pipefail
npm test
npm run typecheck
npm run build
```$$, '00000000-0000-4000-8000-000000000001');--> statement-breakpoint
INSERT INTO "ref" ("from_block_id", "to_block_id") VALUES
('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000041'),
('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000041');
