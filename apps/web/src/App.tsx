import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseBlockDirective, sortBlocksInDocumentOrder, type Block, type WsServerMessage } from '@dryvre/shared';
import { api, connectLive } from './api';
import { dryvreDataSource } from './data-source';
import { BoardView, ContextRail, DocumentView, SearchDialog, Sidebar, StreamView, Topbar } from './components';
import type { DryvreSnapshot, SearchFilters, TaskStatus, ViewMode } from './model';
import { blockPath, descendantsOf } from './model';
import { ROOT_ID } from './use-tree';
import './styles.css';

const HUMAN_ID = '00000000-0000-4000-8000-000000000001';

function titleOf(block: Block) {
  return block.bodyMd.replace(/^#+\s*/, '').split('\n')[0] || 'Untitled';
}

function toServerSnapshot(blocks: Block[]): DryvreSnapshot {
  return {
    rootId: ROOT_ID,
    focusedRootId: ROOT_ID,
    blocks: blocks.filter((block) => block.rank !== null).map((block) => {
      return {
        id: block.id,
        parentId: block.parentId,
        title: titleOf(block),
        bodyMd: block.bodyMd,
        ...(block.status ? { status: block.status } : {}),
        author: block.authorId === HUMAN_ID ? 'Soonoh' : 'Dryvre Agent',
        updatedLabel: new Date(block.updatedAt).toLocaleString(),
        canonical: true,
        version: block.version,
      };
    }),
    messages: blocks.filter((block) => block.rank === null).map((block) => ({
      id: block.id,
      parentId: block.parentId ?? ROOT_ID,
      author: block.authorId === HUMAN_ID ? 'Soonoh' : 'Dryvre Agent',
      initials: block.authorId === HUMAN_ID ? 'SO' : 'AI',
      body: block.bodyMd,
      timeLabel: new Date(block.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      agent: block.authorId !== HUMAN_ID,
    })),
    references: [],
  };
}

export default function App() {
  const [snapshot, setSnapshot] = useState<DryvreSnapshot>();
  const [view, setView] = useState<ViewMode>('document');
  const [scopeId, setScopeId] = useState('launch');
  const [selectedId, setSelectedId] = useState('three-views');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Set<string> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [serverBlocks, setServerBlocks] = useState<Block[]>([]);
  const [serverBacked, setServerBacked] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<string>();
  const [liveOnline, setLiveOnline] = useState(false);
  const [liveMessage, setLiveMessage] = useState<WsServerMessage>();

  const syncServerTree = useCallback(async () => {
    const next = sortBlocksInDocumentOrder((await api.tree(ROOT_ID)).blocks);
    setServerBlocks(next);
    setSnapshot(toServerSnapshot(next));
    setServerBacked(true);
    return next;
  }, []);

  const refreshServerTree = useCallback(async (focusId?: string, revealStream = false) => {
    try {
      const next = await syncServerTree();
      const focus = focusId && next.some((block) => block.id === focusId) ? focusId : ROOT_ID;
      setScopeId(focus);
      setSelectedId(focus);
      if (revealStream) setView('stream');
      return next;
    } catch { /* The mock snapshot remains available for standalone UI demos. */ }
  }, [syncServerTree]);
  useEffect(() => {
    void dryvreDataSource.load().then((initial) => {
      setSnapshot(initial);
      if (import.meta.env.VITE_MOCK_DATA_ONLY !== 'true') return refreshServerTree();
    });
  }, [refreshServerTree]);
  useEffect(() => {
    if (import.meta.env.VITE_MOCK_DATA_ONLY === 'true') return;
    return connectLive(() => { void syncServerTree(); }, setLiveOnline, setLiveMessage);
  }, [syncServerTree]);

  const closeSearch = useCallback(() => setSearchOpen(false), []);
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
    };
    document.addEventListener('keydown', open);
    return () => document.removeEventListener('keydown', open);
  }, []);

  const visibleIds = useMemo(() => {
    if (!snapshot || !searchMatches) return null;
    const result = new Set(searchMatches);
    for (const id of searchMatches) blockPath(id, snapshot.blocks).forEach((block) => result.add(block.id));
    return result;
  }, [searchMatches, snapshot]);

  if (!snapshot) return <div className="app-loading"><span className="brand-mark">D</span><p>Opening the tree…</p></div>;

  const byId = new Map(snapshot.blocks.map((block) => [block.id, block]));
  const scope = byId.get(scopeId) ?? byId.get(snapshot.focusedRootId)!;
  const selected = byId.get(selectedId) ?? scope;
  const scopePath = blockPath(scope.id, snapshot.blocks);
  const selectedPath = blockPath(selected.id, snapshot.blocks);
  const selectedScopePath = selectedPath.slice(Math.max(0, selectedPath.findIndex((block) => block.id === scope.id)));
  const scopeBlocks = [scope, ...descendantsOf(scope.id, snapshot.blocks)];
  const selectedMessages = snapshot.messages.filter((message) => message.parentId === selected.id);
  const agents = serverBlocks.filter((block) => parseBlockDirective(block.bodyMd)?.kind === 'agent');
  const agentTargets = serverBlocks.filter((block) => {
    const directive = parseBlockDirective(block.bodyMd);
    return block.rank !== null && !directive && !/^```agent-config\b/.test(block.bodyMd);
  });
  const agentTarget = agentTargets.find((block) => block.id === selected.id);
  const handleAgentSent = (targetId: string, resultBlockId?: string) => {
    void refreshServerTree(targetId, true).then((next) => {
      const fallback = next?.filter((block) => block.parentId === targetId && block.rank === null).at(-1)?.id;
      setFocusedMessageId(resultBlockId ?? fallback);
    });
  };

  const selectFromTree = (id: string) => { setFocusedMessageId(undefined); setScopeId(id); setSelectedId(id); };
  const setStatus = async (id: string, status: TaskStatus) => {
    if (serverBacked) {
      const block = serverBlocks.find((item) => item.id === id);
      if (!block) return;
      await api.apply({ type: 'setStatus', id, status, version: block.version });
      await refreshServerTree(id);
      return;
    }
    await dryvreDataSource.setStatus(id, status);
    setSnapshot((current) => current && ({ ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, status } : block) }));
  };
  const sendMessage = async (body: string) => {
    if (serverBacked) {
      await api.apply({ type: 'create', parentId: selected.id, bodyMd: body, stream: true });
      await refreshServerTree(selected.id, true);
      return;
    }
    const message = await dryvreDataSource.createMessage(selected.id, body);
    setSnapshot((current) => current && ({ ...current, messages: [...current.messages, message] }));
  };
  const applySearch = async (filters: SearchFilters) => {
    const empty = !filters.text && !filters.referenceId && !filters.status && !filters.author && !filters.updated;
    if (serverBacked) {
      const matches = empty ? serverBlocks : (await api.tree(ROOT_ID, filters.text)).blocks;
      setSearchMatches(empty ? null : new Set(matches.map((block) => block.id)));
      return;
    }
    setSearchMatches(empty ? null : new Set(await dryvreDataSource.search(filters)));
  };
  const editBlock = async (id: string, bodyMd: string, version: number) => {
    if (serverBacked) {
      await api.apply({ type: 'edit', id, bodyMd, version });
      await refreshServerTree(id);
      return { version: version + 1 };
    }
    const saved = await dryvreDataSource.editBlock(id, bodyMd, version);
    setSnapshot((current) => current && ({ ...current, blocks: current.blocks.map((block) => block.id === id ? saved : block) }));
    return { version: saved.version ?? version + 1 };
  };
  const createBlockAfter = async (id: string, bodyMd: string) => {
    if (serverBacked) {
      const current = serverBlocks.find((item) => item.id === id);
      if (!current) return;
      const blockId = crypto.randomUUID();
      await api.apply({ type: 'create', id: blockId, parentId: current.parentId, afterId: id, bodyMd, stream: false });
      await refreshServerTree(blockId);
      setEditingId(blockId);
      return;
    }
    const block = await dryvreDataSource.createBlockAfter(id, bodyMd);
    setSnapshot((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((item) => item.id === id);
      const blocks = [...current.blocks];
      blocks.splice(index + 1, 0, block);
      return { ...current, blocks };
    });
    setSelectedId(block.id);
    setEditingId(block.id);
  };
  const deleteBlock = async (id: string) => {
    if (serverBacked) {
      const current = serverBlocks.find((item) => item.id === id);
      if (!current) return;
      await api.apply({ type: 'delete', id, version: current.version });
      setEditingId(null);
      await refreshServerTree(current.parentId ?? ROOT_ID);
      return;
    }
    await dryvreDataSource.deleteBlock(id);
    setSnapshot((current) => {
      if (!current) return current;
      const removed = new Set([id, ...descendantsOf(id, current.blocks).map((block) => block.id)]);
      return { ...current, blocks: current.blocks.filter((block) => !removed.has(block.id)), messages: current.messages.filter((message) => !removed.has(message.parentId)), references: current.references.filter((reference) => !removed.has(reference.fromId) && !removed.has(reference.toId)) };
    });
    setEditingId(null);
    setSelectedId(scope.id);
  };

  return <div className="app-shell">
    <Topbar path={scopePath} view={view} mobileTreeOpen={mobileTreeOpen} onView={setView} onToggleMobileTree={() => setMobileTreeOpen((open) => !open)} />
    <Sidebar blocks={snapshot.blocks} rootId={snapshot.rootId} selectedId={scope.id} visibleIds={visibleIds} mobileOpen={mobileTreeOpen} onSelect={selectFromTree} onOpenSearch={() => setSearchOpen(true)} onClose={() => setMobileTreeOpen(false)} />
    <main><div className="canvas">
      {view === 'document' && <DocumentView scopeId={scope.id} selectedId={selected.id} editingId={editingId} blocks={snapshot.blocks} references={snapshot.references} onSelect={setSelectedId} onEditStart={setEditingId} onEditEnd={(id) => setEditingId((current) => current === id ? null : current)} onEdit={editBlock} onCreateAfter={createBlockAfter} onDelete={deleteBlock} onStatus={(id, status) => void setStatus(id, status)} />}
      {view === 'board' && <BoardView blocks={scopeBlocks} messages={snapshot.messages} selectedId={selected.id} onSelect={setSelectedId} onStatus={(id, status) => void setStatus(id, status)} />}
      {view === 'stream' && <StreamView selected={selected} messages={selectedMessages} focusedMessageId={focusedMessageId} agents={agents} agentTarget={agentTarget} live={liveOnline} liveMessage={liveMessage} onSend={(body) => void sendMessage(body)} onAgentSent={handleAgentSent} />}
    </div></main>
    <ContextRail selected={selected} path={selectedScopePath} blocks={snapshot.blocks} references={snapshot.references} messages={selectedMessages} onOpenStream={() => setView('stream')} />
    <SearchDialog open={searchOpen} blocks={snapshot.blocks} scopePath={scopePath} onClose={closeSearch} onApply={(filters) => void applySearch(filters)} />
  </div>;
}
