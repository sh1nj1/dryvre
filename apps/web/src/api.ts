import type { Block, BlockOp, OpEnvelope } from '@dryvre/shared';

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
};

export function connectLive(onChange: () => void, onStatus: (online: boolean) => void) {
  const liveUrl = new URL(`${apiBase.replace(/\/$/, '')}/api/live`, location.origin);
  liveUrl.protocol = liveUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(liveUrl);
  socket.onopen = () => onStatus(true);
  socket.onclose = () => onStatus(false);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as { type?: string };
    if (message.type === 'applied') onChange();
  };
  return () => socket.close();
}
