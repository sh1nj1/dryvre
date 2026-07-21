import { wsServerMessageSchema, type AgentRun, type Block, type BlockOp, type CreateAgentRun, type OpEnvelope, type WsServerMessage } from '@dryvre/shared';

const apiBase = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { credentials: 'include', headers: { 'content-type': 'application/json', ...init?.headers }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const api = {
  tree: (id: string, query = '') => request<{ blocks: Block[] }>(`/api/trees/${id}${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  apply: (op: BlockOp) => request('/api/ops', { method: 'POST', body: JSON.stringify({ clientOpId: crypto.randomUUID(), op } satisfies OpEnvelope) }),
  askAi: (blockId: string, prompt: string) => request('/api/ai/respond', { method: 'POST', body: JSON.stringify({ blockId, prompt }) }),
  validateAgent: (blockId: string) => request<{ valid: true; agent: { slug: string }; skills: Array<{ slug: string; files: number }> }>(`/api/agents/${blockId}/validate`, { method: 'POST', body: '{}' }),
  startAgentRun: (input: CreateAgentRun) => request<AgentRun>('/api/agent-runs', { method: 'POST', body: JSON.stringify(input) }),
  agentRun: (id: string) => request<AgentRun>(`/api/agent-runs/${id}`),
  cancelAgentRun: (id: string) => request<AgentRun>(`/api/agent-runs/${id}/cancel`, { method: 'POST' }),
  agentReadiness: () => request<{ ready: boolean; mode: 'fake' | 'codex'; version?: string; error?: string; mcp?: 'ready' }>('/api/agents/readiness'),
};

export function connectLive(onChange: () => void, onStatus: (online: boolean) => void, onMessage: (message: WsServerMessage) => void = () => undefined) {
  const liveUrl = new URL(`${apiBase.replace(/\/$/, '')}/api/live`, location.origin);
  liveUrl.protocol = liveUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(liveUrl);
  socket.onopen = () => onStatus(true);
  socket.onclose = () => onStatus(false);
  socket.onmessage = (event) => {
    const parsed = wsServerMessageSchema.safeParse(JSON.parse(event.data as string));
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'applied') onChange();
    onMessage(message);
  };
  return () => socket.close();
}
