#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import type { BlockOp, OpEnvelope } from '@dryvre/shared';

const baseUrl = process.env.DRYVRE_URL ?? 'http://localhost:3000';
const cookie = process.env.DRYVRE_SESSION;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `dryvre_session=${cookie}` } : {}), ...init?.headers },
  });
  if (!response.ok) throw new Error(`Dryvre API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function apply(op: BlockOp) {
  return call('/api/ops', { method: 'POST', body: JSON.stringify({ clientOpId: crypto.randomUUID(), op } satisfies OpEnvelope) });
}

const server = new McpServer({ name: 'dryvre', version: '0.1.0' });

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};
type RegisterTool = (name: string, config: { title: string; description: string; inputSchema: z.ZodTypeAny; annotations: ToolAnnotations }, callback: (args: Record<string, unknown>) => Promise<ToolResult>) => void;
const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;

const readTreeInput = z.object({ rootId: z.string().uuid(), query: z.string().optional() });
registerTool('dryvre_read_tree', {
  title: 'Read a Dryvre block tree',
  description: 'Reads one block and its descendants. This is the canonical AI context boundary.',
  inputSchema: readTreeInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  const { rootId, query } = readTreeInput.parse(args);
  const data = await call(`/api/trees/${rootId}${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
});

const createBlockInput = z.object({ parentId: z.string().uuid().nullable(), bodyMd: z.string().min(1), stream: z.boolean().default(false) });
registerTool('dryvre_create_block', {
  title: 'Create a Dryvre block',
  description: 'Creates a canonical document block or appends a stream block below a parent.',
  inputSchema: createBlockInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async (args) => {
  const { parentId, bodyMd, stream } = createBlockInput.parse(args);
  const data = await apply({ type: 'create', parentId, bodyMd, stream });
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
});

const editBlockInput = z.object({ id: z.string().uuid(), bodyMd: z.string(), version: z.number().int().nonnegative().optional() });
registerTool('dryvre_edit_block', {
  title: 'Edit a Dryvre block',
  description: 'Replaces the canonical Markdown body. Pass version to detect concurrent edits.',
  inputSchema: editBlockInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
}, async (args) => {
  const { id, bodyMd, version } = editBlockInput.parse(args);
  const data = await apply({ type: 'edit', id, bodyMd, ...(version === undefined ? {} : { version }) });
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
});

await server.connect(new StdioServerTransport());
