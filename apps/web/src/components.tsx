import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { BlockMessage, BlockReference, DryvreBlock, SearchFilters, TaskStatus, ViewMode } from './model';
import { descendantsOf } from './model';
import { BlockEditor, type EditorSaveResult } from './block-editor';

const statusLabels: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

export function Brand() {
  return <a className="brand" href="/" aria-label="Dryvre home"><span className="brand-mark">D</span><span className="brand-name">dryvre</span></a>;
}

export function Topbar({ path, mobileTreeOpen, onToggleMobileTree }: { path: DryvreBlock[]; mobileTreeOpen: boolean; onToggleMobileTree: () => void }) {
  return <header className="topbar">
    <Brand />
    <div className="crumbs" aria-label="Current block path">
      {path.map((block, index) => <span className="crumb-part" key={block.id}>{index > 0 && <span className="crumb-sep">/</span>}<strong>{block.title}</strong></span>)}
    </div>
    <div className="top-actions"><button className="icon-btn mobile-tree-btn" aria-expanded={mobileTreeOpen} onClick={onToggleMobileTree}>☰</button><div className="avatar">SO</div></div>
  </header>;
}

export function Sidebar({ blocks, rootId, selectedId, visibleIds, mobileOpen, onSelect, onOpenSearch, onClose }: {
  blocks: DryvreBlock[];
  rootId: string;
  selectedId: string;
  visibleIds: Set<string> | null;
  mobileOpen: boolean;
  onSelect: (id: string) => void;
  onOpenSearch: () => void;
  onClose: () => void;
}) {
  const children = useMemo(() => {
    const map = new Map<string | null, DryvreBlock[]>();
    blocks.filter((block) => block.canonical).forEach((block) => {
      const siblings = map.get(block.parentId) ?? [];
      siblings.push(block);
      map.set(block.parentId, siblings);
    });
    return map;
  }, [blocks]);

  const renderNode = (block: DryvreBlock, depth: number): React.ReactNode => {
    if (visibleIds && !visibleIds.has(block.id)) return null;
    const nested = children.get(block.id) ?? [];
    return <div key={block.id}>
      <button className={`tree-row ${selectedId === block.id ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 20 }} onClick={() => { onSelect(block.id); onClose(); }}>
      <span className="chev">{nested.length ? '⌄' : ''}</span><span className="node-icon">{block.icon ?? '◇'}</span><span className="node-label">{block.title}</span>
      </button>
      {nested.map((child) => renderNode(child, depth + 1))}
    </div>;
  };

  const root = blocks.find((block) => block.id === rootId);
  return <>
    <div className={`mobile-backdrop ${mobileOpen ? 'show' : ''}`} onClick={onClose} />
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="side-tools"><button className="search-trigger" onClick={onOpenSearch}><span>⌕</span><span>Search &amp; filter</span><kbd>⌘K</kbd></button><button className="icon-btn" aria-label="Create block">＋</button></div>
      <nav className="tree-wrap" aria-label="Block tree"><div className="section-label"><span>Tree</span><span aria-hidden="true">•••</span></div>{root && renderNode(root, 0)}</nav>
    </aside>
  </>;
}

export function ViewHeader({ title, view, onView }: { title: string; view: ViewMode; onView: (view: ViewMode) => void }) {
  const items: { id: ViewMode; icon: string; label: string }[] = [
    { id: 'document', icon: '▤', label: 'Document' }, { id: 'board', icon: '▦', label: 'Board' }, { id: 'stream', icon: '◉', label: 'Stream' },
  ];
  return <section className="view-header"><h1>{title}</h1><div className="view-switcher" role="tablist">{items.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)}>{item.icon}&nbsp; {item.label}</button>)}</div></section>;
}

function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`status-chip ${status}`}>{status === 'in_progress' && '● '}{statusLabels[status]}</span>;
}

export function DocumentView({ scopeId, selectedId, editingId, blocks, references, onSelect, onEditStart, onEditEnd, onEdit, onCreateAfter, onDelete, onStatus }: {
  scopeId: string;
  selectedId: string;
  editingId: string | null;
  blocks: DryvreBlock[];
  references: BlockReference[];
  onSelect: (id: string) => void;
  onEditStart: (id: string) => void;
  onEditEnd: (id: string) => void;
  onEdit: (id: string, bodyMd: string, version: number) => Promise<EditorSaveResult>;
  onCreateAfter: (id: string, bodyMd: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onStatus: (id: string, status: TaskStatus) => void;
}) {
  const children = useMemo(() => {
    const map = new Map<string, DryvreBlock[]>();
    blocks.filter((block) => block.canonical).forEach((block) => {
      if (!block.parentId) return;
      const siblings = map.get(block.parentId) ?? [];
      siblings.push(block);
      map.set(block.parentId, siblings);
    });
    return map;
  }, [blocks]);

  const refTargets = new Map(references.map((reference) => [reference.toId, blocks.find((block) => block.id === reference.toId)]));
  const referenceSentence = <div className="doc-block reference-sentence" key="reference-sentence"><span className="drag-handle">⠿</span><p>Launch criteria are informed by {[...refTargets.values()].filter(Boolean).map((target) => <button className="ref-chip" key={target!.id} onClick={() => onSelect(target!.id)}>↗ {target!.title}</button>)}</p></div>;
  const editor = (block: DryvreBlock) => <BlockEditor bodyMd={block.bodyMd ?? ''} version={block.version ?? 0} onEdit={(bodyMd, version) => onEdit(block.id, bodyMd, version)} onCreateAfter={(bodyMd) => onCreateAfter(block.id, bodyMd)} onDelete={() => onDelete(block.id)} onExit={() => onEditEnd(block.id)} />;
  const renderBlock = (block: DryvreBlock, depth = 0): React.ReactNode => {
    const nested = children.get(block.id) ?? [];
    const isTask = Boolean(block.status);
    return <div className={depth ? 'doc-children' : ''} key={block.id}>
      <div className={`doc-block ${selectedId === block.id ? 'selected' : ''}`} tabIndex={0} onClick={() => { onSelect(block.id); onEditStart(block.id); }} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); onEditStart(block.id); } }}>
      <span className="drag-handle">⠿</span>
      {isTask ? <><div className="task-line"><button className={`check ${block.status === 'done' ? 'done' : ''}`} onClick={(event) => { event.stopPropagation(); onStatus(block.id, block.status === 'done' ? 'todo' : 'done'); }}>{block.status === 'done' ? '✓' : ''}</button><span className={block.status === 'done' ? 'done-copy' : ''}>{block.title}</span><StatusChip status={block.status!} /></div>{editingId === block.id ? editor(block) : block.bodyMd && <div className="doc-copy"><ReactMarkdown>{block.bodyMd}</ReactMarkdown></div>}</> : editingId === block.id ? editor(block) : block.bodyMd ? <div className="doc-copy"><ReactMarkdown>{block.bodyMd}</ReactMarkdown></div> : <h3>{block.title}</h3>}
      </div>
      {nested.map((child) => renderBlock(child, depth + 1))}
    </div>;
  };
  const scope = blocks.find((block) => block.id === scopeId);
  const scopeChildren = children.get(scopeId) ?? [];
  return <article className="doc-sheet">
    {scope && scopeId !== 'launch' && <div className={`doc-block ${selectedId === scope.id ? 'selected' : ''}`} onClick={() => { onSelect(scope.id); onEditStart(scope.id); }}><span className="drag-handle">⠿</span><h2>{scope.title}</h2>{editingId === scope.id ? editor(scope) : scope.bodyMd && <div className="doc-copy"><ReactMarkdown>{scope.bodyMd}</ReactMarkdown></div>}</div>}
    {scopeChildren.flatMap((block) => block.id === 'thesis' && scopeId === 'launch' ? [renderBlock(block), referenceSentence] : [renderBlock(block)])}
  </article>;
}

export function BoardView({ blocks, messages, selectedId, onSelect, onStatus }: { blocks: DryvreBlock[]; messages: BlockMessage[]; selectedId: string; onSelect: (id: string) => void; onStatus: (id: string, status: TaskStatus) => void }) {
  const columns: { status: TaskStatus; label: string }[] = [{ status: 'todo', label: 'To do' }, { status: 'in_progress', label: 'In progress' }, { status: 'done', label: 'Done' }];
  return <div className="board">{columns.map((column) => {
    const cards = blocks.filter((block) => block.status === column.status);
    return <section className="column" key={column.status}><header className="column-head"><span className="column-dot" />{column.label}<span>{cards.length}</span></header><div className="cards">{cards.map((block) => <article className={`card ${selectedId === block.id ? 'selected' : ''}`} key={block.id} onClick={() => onSelect(block.id)}><div className="card-meta"><span>{block.parentId ? blocks.find((item) => item.id === block.parentId)?.title : 'Root'}</span><code>#{block.id.slice(0, 4).toUpperCase()}</code></div><h3>{block.title}</h3><p>{block.bodyMd}</p><div className="card-footer"><span className={`mini-avatar ${block.author === 'Dryvre AI' ? 'agent' : ''}`}>{block.author === 'Dryvre AI' ? 'AI' : block.author.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span className="comment-count">◉ {messages.filter((message) => message.parentId === block.id).length}</span><select aria-label={`Change status for ${block.title}`} value={block.status} onClick={(event) => event.stopPropagation()} onChange={(event) => onStatus(block.id, event.target.value as TaskStatus)}>{columns.map((item) => <option value={item.status} key={item.status}>{item.label}</option>)}</select></div></article>)}<button className="add-card">＋ Add block</button></div></section>;
  })}</div>;
}

export function StreamView({ selected, path, messages, onSend, onOpenDocument }: { selected: DryvreBlock; path: DryvreBlock[]; messages: BlockMessage[]; onSend: (body: string) => void; onOpenDocument: () => void }) {
  const [value, setValue] = useState('');
  const send = () => { if (!value.trim()) return; onSend(value.trim()); setValue(''); };
  return <div className="stream-layout"><div className="stream-focus"><div className="focus-glyph">◎</div><div className="focus-copy"><span>Conversation attached to</span><strong>{path.map((block) => block.title).join(' / ')}</strong></div><button className="tool-pill" onClick={onOpenDocument}>Open block ↗</button></div>
    {messages.length ? messages.map((message) => <article className={`message ${message.agent ? 'agent' : ''}`} key={message.id}><div className="avatar">{message.initials}</div><div><div className="message-head"><strong>{message.author}</strong><span>{message.timeLabel}</span></div><div className="message-body"><p>{message.body}</p>{message.createdBlocks && <div className="agent-output">{message.createdBlocks.map((body) => <div className="agent-block" key={body}>{body}</div>)}</div>}</div><div className="message-actions">Reply · Reference · •••</div></div></article>) : <div className="empty-stream"><strong>No messages yet</strong><span>Start a conversation in this block.</span></div>}
    <div className="composer"><textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send(); }} placeholder="Write to this block… Use @ to mention people, agents, or blocks" /><div className="composer-actions"><span className="context-chip">◎ {selected.title}</span><button className="tool-pill">@ Reference</button><button className="send-btn" aria-label="Send message" disabled={!value.trim()} onClick={send}>↑</button></div></div>
  </div>;
}

export function ContextRail({ selected, path, blocks, references, messages, onOpenStream }: { selected: DryvreBlock; path: DryvreBlock[]; blocks: DryvreBlock[]; references: BlockReference[]; messages: BlockMessage[]; onOpenStream: () => void }) {
  const relevantRefs = references.filter((reference) => reference.fromId === selected.id);
  const descendants = descendantsOf(selected.id, blocks);
  return <aside className="context-rail"><header className="rail-head"><strong>Block context</strong><span>Auto-built</span></header><div className="rail-scroll"><div className="inspector-label">Selected block</div><div className="selected-card"><span className="path">{path.slice(0, -1).map((block) => block.title).join(' / ') || 'Root'}</span><h3>{selected.title}</h3><p>{selected.bodyMd ?? 'A first-class block in the shared tree.'}</p><div className="selected-meta">Updated {selected.updatedLabel} · {selected.author}</div></div>
    {messages.length > 0 && <button className="messages-card" onClick={onOpenStream}><span className="messages-icon">◉</span><span className="messages-copy"><strong>{messages.length} messages</strong><span>{[...new Set(messages.map((message) => message.author))].join(', ')}</span></span><span className="messages-arrow">→</span></button>}
    <div className="inspector-label section-gap">AI reads</div><ul className="context-list">{path.map((block, index) => <li className={`context-item ${block.id === selected.id ? 'current' : ''}`} key={block.id}>{block.title}<small>{block.id === selected.id ? `current block · ${descendants.length} descendants` : index === 0 ? `root · ${descendantsOf(block.id, blocks).length} descendant blocks` : 'parent block'}</small></li>)}</ul>
    <div className="inspector-label section-gap">References</div>{relevantRefs.length ? relevantRefs.map((reference) => { const target = blocks.find((block) => block.id === reference.toId); return target && <div className="reference-card" key={reference.toId}><strong>↗ {target.title}</strong><span>{reference.summary}</span></div>; }) : <p className="empty-copy">No explicit references.</p>}
  </div></aside>;
}

const emptyFilters: SearchFilters = { text: '', referenceId: '', status: '', author: '', updated: '' };

export function SearchDialog({ open, blocks, scopePath, onClose, onApply }: { open: boolean; blocks: DryvreBlock[]; scopePath: DryvreBlock[]; onClose: () => void; onApply: (filters: SearchFilters) => void }) {
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  if (!open) return null;
  const patch = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  return <div className="search-overlay open" role="dialog" aria-modal="true" aria-labelledby="search-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="search-dialog"><header className="search-dialog-head"><span>⌕</span><input ref={input} value={filters.text} onChange={(event) => patch('text', event.target.value)} placeholder="Search blocks in this tree…" /><kbd>ESC</kbd></header><div className="filter-area"><div className="filter-title"><span id="search-title">Filter conditions</span><button onClick={() => setFilters(emptyFilters)}>Clear all</button></div><div className="filter-grid">
    <FilterField label="References" value={filters.referenceId} onChange={(value) => patch('referenceId', value)} options={[['', 'Any reference'], ...blocks.filter((block) => ['build-week', 'research'].includes(block.id)).map((block) => [block.id, block.title])]} />
    <FilterField label="Status" value={filters.status} onChange={(value) => patch('status', value as SearchFilters['status'])} options={[['', 'Any status'], ['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done'], ['not_task', 'Not a task']]} />
    <FilterField label="Author" value={filters.author} onChange={(value) => patch('author', value)} options={[['', 'Anyone'], ...[...new Set(blocks.map((block) => block.author))].map((author) => [author, author])]} />
    <FilterField label="Updated" value={filters.updated} onChange={(value) => patch('updated', value as SearchFilters['updated'])} options={[['', 'Any time'], ['today', 'Today'], ['week', 'Past 7 days'], ['month', 'Past 30 days']]} />
  </div><div className="search-scope">◎ Searching within <strong>{scopePath.map((block) => block.title).join(' / ')}</strong></div></div><footer className="search-dialog-foot"><span>Results keep their tree structure and remain editable.</span><button className="primary-btn" onClick={() => { onApply(filters); onClose(); }}>Apply to tree</button></footer></section></div>;
}

function FilterField({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option value={optionValue} key={`${label}-${optionValue}`}>{optionLabel}</option>)}</select></label>;
}
