import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32).default('development-only-secret-change-me!'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6'),
  CODEX_COMMAND: z.string().default('codex'),
  DRYVRE_AGENT_WORKSPACES: z.string().optional(),
  DRYVRE_AGENT_DATA_DIR: z.string().default('.dryvre-data/agent-runtime'),
  DRYVRE_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  DRYVRE_AGENT_FAKE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export type AppConfig = z.infer<typeof configSchema>;
export const loadConfig = () => configSchema.parse(process.env);
