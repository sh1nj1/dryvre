import { useCallback, useEffect, useMemo, useState } from 'react';
import { dryvreDataSource } from './data-source';
import { BoardView, ContextRail, DocumentView, SearchDialog, Sidebar, StreamView, Topbar, ViewHeader } from './components';
import type { DryvreSnapshot, SearchFilters, TaskStatus, ViewMode } from './model';
import { blockPath, descendantsOf } from './model';
import './styles.css';

export default function App() {
  const [snapshot, setSnapshot] = useState<DryvreSnapshot>();
  const [view, setView] = useState<ViewMode>('document');
  const [scopeId, setScopeId] = useState('launch');
  const [selectedId, setSelectedId] = useState('three-views');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Set<string> | null>(null);

  useEffect(() => { void dryvreDataSource.load().then(setSnapshot); }, []);

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
  const scopeBlocks = [scope, ...descendantsOf(scope.id, snapshot.blocks)];
  const selectedMessages = snapshot.messages.filter((message) => message.parentId === selected.id);

  const selectFromTree = (id: string) => { setScopeId(id); setSelectedId(id); };
  const setStatus = async (id: string, status: TaskStatus) => {
    await dryvreDataSource.setStatus(id, status);
    setSnapshot((current) => current && ({ ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, status } : block) }));
  };
  const sendMessage = async (body: string) => {
    const message = await dryvreDataSource.createMessage(selected.id, body);
    setSnapshot((current) => current && ({ ...current, messages: [...current.messages, message] }));
  };
  const applySearch = async (filters: SearchFilters) => {
    const empty = !filters.text && !filters.referenceId && !filters.status && !filters.author && !filters.updated;
    setSearchMatches(empty ? null : new Set(await dryvreDataSource.search(filters)));
  };

  return <div className="app-shell">
    <Topbar path={scopePath} mobileTreeOpen={mobileTreeOpen} onToggleMobileTree={() => setMobileTreeOpen((open) => !open)} />
    <Sidebar blocks={snapshot.blocks} rootId={snapshot.rootId} selectedId={scope.id} visibleIds={visibleIds} mobileOpen={mobileTreeOpen} onSelect={selectFromTree} onOpenSearch={() => setSearchOpen(true)} onClose={() => setMobileTreeOpen(false)} />
    <main><ViewHeader title={scope.title} view={view} onView={setView} /><div className="canvas">
      {view === 'document' && <DocumentView scopeId={scope.id} selectedId={selected.id} blocks={snapshot.blocks} references={snapshot.references} onSelect={setSelectedId} onStatus={(id, status) => void setStatus(id, status)} />}
      {view === 'board' && <BoardView blocks={scopeBlocks} selectedId={selected.id} onSelect={setSelectedId} onStatus={(id, status) => void setStatus(id, status)} />}
      {view === 'stream' && <StreamView selected={selected} path={selectedPath} messages={selectedMessages} onSend={(body) => void sendMessage(body)} onOpenDocument={() => setView('document')} />}
    </div></main>
    <ContextRail selected={selected} path={selectedPath} blocks={snapshot.blocks} references={snapshot.references} messages={selectedMessages} onOpenStream={() => setView('stream')} />
    <SearchDialog open={searchOpen} blocks={snapshot.blocks} scopePath={scopePath} onClose={closeSearch} onApply={(filters) => void applySearch(filters)} />
  </div>;
}
