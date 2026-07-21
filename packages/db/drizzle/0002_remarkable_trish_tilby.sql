DROP INDEX "agent_run_agent_created_idx";--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "workspace" text;--> statement-breakpoint
CREATE INDEX "agent_run_agent_workspace_created_idx" ON "agent_run" USING btree ("agent_block_id","workspace","created_at");