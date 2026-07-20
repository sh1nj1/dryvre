import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Block } from '@dryvre/shared';
import { api, connectLive } from './api';

export const ROOT_ID = '00000000-0000-4000-8000-000000000010';

export function useTree(rootId = ROOT_ID, query = '') {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [online, setOnline] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const data = await api.tree(rootId, query);
      setBlocks(data.blocks);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load tree');
    } finally {
      setLoading(false);
    }
  }, [query, rootId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => connectLive(refresh, setOnline), [refresh]);
  const byId = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  return { blocks, byId, loading, error, online, refresh };
}
