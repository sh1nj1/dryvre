import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { AgentRun, Block, WsServerMessage } from '@dryvre/shared';
import type { BlockMessage, BlockReference, DryvreBlock, SearchFilters, TaskStatus, ViewMode } from './model';
import { blockSummary, blockTitle, descendantsOf } from './model';
import { BlockEditor, type EditorSaveResult } from './block-editor';
import { api } from './api';

const statusLabels: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };

// Render a projected heading title inline via Markdown. Reconstructing `## ${title}`
// keeps parsing in heading context (inline-only — a title like `1. Foo` can't be
// reinterpreted as a list), while unwrapping the h2 keeps the formatted title inline
// where it sits next to sibling controls (e.g. a task line's checkbox and status chip).
const inlineHeading: Components = { h2: ({ children }) => <>{children}</> };
const titleMarkdown = (block: Pick<DryvreBlock, 'title' | 'bodyMd'>) => `## ${blockTitle(block)}`;

export function Brand() {
  return <a className="brand" href="/" aria-label="Dryvre home"><span className="brand-mark">D</span><span className="brand-name">dryvre</span></a>;
}

export function Topbar({ path, view, mobileTreeOpen, onView, onToggleMobileTree }: { path: DryvreBlock[]; view: ViewMode; mobileTreeOpen: boolean; onView: (view: ViewMode) => void; onToggleMobileTree: () => void }) {
  return <header className="topbar">
    <Brand />
    <div className="topbar-main">
      <div className="crumbs" aria-label="Current block path">{path.map((block, index) => <span className="crumb-part" key={block.id}>{index > 0 && <span className="crumb-sep">/</span>}<strong>{blockTitle(block)}</strong></span>)}</div>
      <ViewSwitcher view={view} onView={onView} />
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
      <span className="chev">{nested.length ? '⌄' : ''}</span><span className="node-icon">{block.icon ?? '◇'}</span><span className="node-label">{blockTitle(block)}</span>
      </button>
      {nested.map((child) => renderNode(child, depth + 1))}
    </div>;
  };

  const root = blocks.find((block) => block.id === rootId);
  return <>
    <div className={`mobile-backdrop ${mobileOpen ? 'show' : ''}`} onClick={onClose} />
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="side-tools"><button className="search-trigger" onClick={onOpenSearch}><span>⌕</span><span>Search &amp; filter</span><kbd>⌘K</kbd></button></div>
      <nav className="tree-wrap" aria-label="Block tree"><div className="section-label"><span>Tree</span></div>{root && renderNode(root, 0)}</nav>
    </aside>
  </>;
}

function ViewSwitcher({ view, onView }: { view: ViewMode; onView: (view: ViewMode) => void }) {
  const items: { id: ViewMode; icon: string; label: string }[] = [
    { id: 'document', icon: '▤', label: 'Document' }, { id: 'board', icon: '▦', label: 'Board' }, { id: 'stream', icon: '◉', label: 'Stream' },
  ];
  return <>
    <div className="view-switcher" role="tablist" aria-label="View mode">{items.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)}><span aria-hidden="true">{item.icon}</span>&nbsp; {item.label}</button>)}</div>
    <select className="mobile-view-select" aria-label="View mode" value={view} onChange={(event) => onView(event.target.value as ViewMode)}>{items.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
  </>;
}

function StatusChip({ status }: { status: TaskStatus }) {
  const marker = status === 'in_progress' ? '● ' : status === 'blocked' ? '⏸ ' : '';
  return <span className={`status-chip ${status}`}>{marker}{statusLabels[status]}</span>;
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
  const referenceSentence = <div className="doc-block reference-sentence" key="reference-sentence"><span className="drag-handle">⠿</span><p>Launch criteria are informed by {[...refTargets.values()].filter(Boolean).map((target) => <button className="ref-chip" key={target!.id} onClick={() => onSelect(target!.id)}>↗ {blockTitle(target!)}</button>)}</p></div>;
  const editor = (block: DryvreBlock) => <BlockEditor bodyMd={block.bodyMd ?? ''} version={block.version ?? 0} onEdit={(bodyMd, version) => onEdit(block.id, bodyMd, version)} onCreateAfter={(bodyMd) => onCreateAfter(block.id, bodyMd)} onDelete={() => onDelete(block.id)} onExit={() => onEditEnd(block.id)} />;
  const insertAfter = (block: DryvreBlock) => <button className="block-insert" key={`insert-${block.id}`} aria-label={`Insert block after ${blockTitle(block)}`} onClick={() => void onCreateAfter(block.id, '')}><span aria-hidden="true">＋</span></button>;
  const renderBlock = (block: DryvreBlock, depth = 0, showInsert = true): React.ReactNode => {
    const nested = children.get(block.id) ?? [];
    const isTask = Boolean(block.status);
    return <div className={depth ? 'doc-children' : ''} key={block.id}>
      <div className={`doc-block ${selectedId === block.id ? 'selected' : ''}`} tabIndex={0} onClick={() => { onSelect(block.id); onEditStart(block.id); }} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); onEditStart(block.id); } }}>
      <span className="drag-handle">⠿</span>
      {isTask ? <><div className="task-line"><button className={`check ${block.status === 'done' ? 'done' : ''}`} onClick={(event) => { event.stopPropagation(); onStatus(block.id, block.status === 'done' ? 'todo' : 'done'); }}>{block.status === 'done' ? '✓' : ''}</button><span className={block.status === 'done' ? 'done-copy' : ''}><ReactMarkdown components={inlineHeading}>{titleMarkdown(block)}</ReactMarkdown></span><StatusChip status={block.status!} /></div>{editingId === block.id ? editor(block) : blockSummary(block) && <div className="doc-copy"><ReactMarkdown>{blockSummary(block)}</ReactMarkdown></div>}</> : editingId === block.id ? editor(block) : block.bodyMd ? <div className="doc-copy"><ReactMarkdown>{block.bodyMd}</ReactMarkdown></div> : <h3>{blockTitle(block)}</h3>}
      </div>
      {nested.map((child) => renderBlock(child, depth + 1))}
      {showInsert && insertAfter(block)}
    </div>;
  };
  const scope = blocks.find((block) => block.id === scopeId);
  const scopeSummary = scope ? blockSummary(scope) : '';
  // Render the scope heading through Markdown so inline formatting (code, links,
  // emphasis) in the title renders instead of showing raw source — read mode
  // renders Markdown, and non-scope blocks already render their heading via the
  // full-body ReactMarkdown below. Reconstructing `## ${title}` keeps this in
  // heading context, whose content is inline-only, so a title like `1. Foo`
  // can't be reinterpreted as a list.
  const scopeHeading = scope ? titleMarkdown(scope) : '';
  const scopeChildren = children.get(scopeId) ?? [];
  return <article className="doc-sheet">
    {scope && scopeId !== 'launch' && <div className={`doc-block ${selectedId === scope.id ? 'selected' : ''}`} onClick={() => { onSelect(scope.id); onEditStart(scope.id); }}><span className="drag-handle">⠿</span>{editingId === scope.id ? editor(scope) : <><ReactMarkdown>{scopeHeading}</ReactMarkdown>{scopeSummary && <div className="doc-copy"><ReactMarkdown>{scopeSummary}</ReactMarkdown></div>}</>}</div>}
    {scopeChildren.flatMap((block) => block.id === 'thesis' && scopeId === 'launch' ? [renderBlock(block, 0, false), referenceSentence, insertAfter(block)] : [renderBlock(block)])}
  </article>;
}

export function BoardView({ blocks, messages, selectedId, onSelect, onStatus }: { blocks: DryvreBlock[]; messages: BlockMessage[]; selectedId: string; onSelect: (id: string) => void; onStatus: (id: string, status: TaskStatus) => void }) {
  const columns: { status: TaskStatus; label: string }[] = [{ status: 'todo', label: 'To do' }, { status: 'in_progress', label: 'In progress' }, { status: 'blocked', label: 'Blocked' }, { status: 'done', label: 'Done' }];
  return <div className="board">{columns.map((column) => {
    const cards = blocks.filter((block) => block.status === column.status);
    return <section className="column" key={column.status}><header className="column-head"><span className="column-dot" />{column.label}<span>{cards.length}</span></header><div className="cards">{cards.map((block) => { const parent = block.parentId ? blocks.find((item) => item.id === block.parentId) : undefined; const summary = blockSummary(block); return <article className={`card ${selectedId === block.id ? 'selected' : ''}`} key={block.id} onClick={() => onSelect(block.id)}><div className="card-meta"><span>{parent ? blockTitle(parent) : 'Root'}</span><code>#{block.id.slice(0, 4).toUpperCase()}</code></div><h3>{blockTitle(block)}</h3>{summary && <p>{summary}</p>}<div className="card-footer"><span className={`mini-avatar ${block.author === 'Dryvre AI' ? 'agent' : ''}`}>{block.author === 'Dryvre AI' ? 'AI' : block.author.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span className="comment-count">◉ {messages.filter((message) => message.parentId === block.id).length}</span><select aria-label={`Change status for ${blockTitle(block)}`} value={block.status} onClick={(event) => event.stopPropagation()} onChange={(event) => onStatus(block.id, event.target.value as TaskStatus)}>{columns.map((item) => <option value={item.status} key={item.status}>{item.label}</option>)}</select></div></article>; })}</div></section>;
  })}</div>;
}

export function StreamView({ selected, messages, focusedMessageId, agents, agentTarget, live, liveMessage, contextSummary, onSend, onAgentSent }: { selected: DryvreBlock; messages: BlockMessage[]; focusedMessageId: string | undefined; agents: Block[]; agentTarget: Block | undefined; live: boolean; liveMessage: WsServerMessage | undefined; contextSummary: string; onSend: (body: string) => void; onAgentSent: (targetId: string, resultBlockId?: string) => void }) {
  const focusedMessage = useRef<HTMLElement>(null);
  useEffect(() => { focusedMessage.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [focusedMessageId, messages]);
  return <div className="stream-layout">
    {messages.length ? messages.map((message) => <article ref={message.id === focusedMessageId ? focusedMessage : undefined} className={`message ${message.agent ? 'agent' : ''} ${message.id === focusedMessageId ? 'result-focus' : ''}`} key={message.id}><div className="avatar">{message.initials}</div><div><div className="message-head"><strong>{message.author}</strong><span>{message.timeLabel}</span></div><div className="message-body"><p>{message.body}</p>{message.createdBlocks && <div className="agent-output">{message.createdBlocks.map((body) => <div className="agent-block" key={body}>{body}</div>)}</div>}</div><div className="message-actions">Reply · Reference · •••</div></div></article>) : <div className="empty-stream"><strong>No messages yet</strong><span>Start a conversation in this block.</span></div>}
    <StreamComposer selected={selected} agents={agents} target={agentTarget} live={live} liveMessage={liveMessage} contextSummary={contextSummary} onSend={onSend} onSent={onAgentSent} />
  </div>;
}
export function ContextRail({ selected, path, blocks, references }: { selected: DryvreBlock; path: DryvreBlock[]; blocks: DryvreBlock[]; references: BlockReference[] }) {
  const relevantRefs = references.filter((reference) => reference.fromId === selected.id);
  const descendants = descendantsOf(selected.id, blocks);
  const selectedSummary = blockSummary(selected);
  return <aside className="context-rail"><header className="rail-head"><strong>Block context</strong><span>Auto-built</span></header><div className="rail-scroll"><div className="inspector-label">Selected block</div><div className="selected-card"><span className="path">{path.slice(0, -1).map(blockTitle).join(' / ') || 'Root'}</span><h3>{blockTitle(selected)}</h3><p>{selectedSummary || 'A first-class block in the shared tree.'}</p><div className="selected-meta">Updated {selected.updatedLabel} · {selected.author}</div></div>
    <div className="inspector-label section-gap">AI reads</div><ul className="context-list">{path.map((block, index) => <li className={`context-item ${block.id === selected.id ? 'current' : ''}`} key={block.id}>{blockTitle(block)}<small>{block.id === selected.id ? `current block · ${descendants.length} descendants` : index === 0 ? `root · ${descendantsOf(block.id, blocks).length} descendant blocks` : 'parent block'}</small></li>)}</ul>
    <div className="inspector-label section-gap">References</div>{relevantRefs.length ? relevantRefs.map((reference) => { const target = blocks.find((block) => block.id === reference.toId); return target && <div className="reference-card" key={reference.toId}><strong>↗ {blockTitle(target)}</strong><span>{reference.summary}</span></div>; }) : <p className="empty-copy">No explicit references.</p>}
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
    <FilterField label="References" value={filters.referenceId} onChange={(value) => patch('referenceId', value)} options={[['', 'Any reference'], ...blocks.filter((block) => ['build-week', 'research'].includes(block.id)).map((block) => [block.id, blockTitle(block)])]} />
    <FilterField label="Status" value={filters.status} onChange={(value) => patch('status', value as SearchFilters['status'])} options={[['', 'Any status'], ['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done'], ['not_task', 'Not a task']]} />
    <FilterField label="Author" value={filters.author} onChange={(value) => patch('author', value)} options={[['', 'Anyone'], ...[...new Set(blocks.map((block) => block.author))].map((author) => [author, author])]} />
    <FilterField label="Updated" value={filters.updated} onChange={(value) => patch('updated', value as SearchFilters['updated'])} options={[['', 'Any time'], ['today', 'Today'], ['week', 'Past 7 days'], ['month', 'Past 30 days']]} />
  </div><div className="search-scope">◎ Searching within <strong>{scopePath.map(blockTitle).join(' / ')}</strong></div></div><footer className="search-dialog-foot"><span>Results keep their tree structure and remain editable.</span><button className="primary-btn" onClick={() => { onApply(filters); onClose(); }}>Apply to tree</button></footer></section></div>;
}

function FilterField({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option value={optionValue} key={`${label}-${optionValue}`}>{optionLabel}</option>)}</select></label>;
}

const runLabels: Record<AgentRun['status'], string> = {
  queued: 'Queued', running: 'Codex is working…', succeeded: 'Complete', failed: 'Failed', cancelled: 'Cancelled',
};

const agentErrors: Record<string, string> = {
  auth_required: 'Run codex login, then refresh readiness.',
  codex_not_found: 'Install Codex CLI or enable fake mode.',
  dryvre_mcp_not_built: 'Build the Dryvre MCP entrypoint before running Codex.',
  invalid_definition: 'Fix this Agent or Skill definition.',
  invalid_workspace: 'Configure this named Agent workspace on the server.',
  agent_busy: 'This Agent already has an active run.',
  runner_busy: 'Two Local Agents are already running.',
  timeout: 'The Agent timed out before producing a result.',
};

function agentError(value: string) {
  return agentErrors[value] ?? value.replaceAll('_', ' ');
}

export function StreamComposer({ selected, agents, target, live, liveMessage, contextSummary, onSend, onSent }: { selected: DryvreBlock; agents: Block[]; target: Block | undefined; live: boolean; liveMessage: WsServerMessage | undefined; contextSummary: string; onSend: (body: string) => void; onSent: (targetId: string, resultBlockId?: string) => void }) {
  const [agentId, setAgentId] = useState('');
  const [value, setValue] = useState('');
  const [run, setRun] = useState<AgentRun>();
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof api.agentReadiness>>>();
  const runRef = useRef<AgentRun | undefined>(undefined);
  const targetRef = useRef<string | undefined>(undefined);
  const onSentRef = useRef(onSent);
  const completedRuns = useRef(new Set<string>());
  runRef.current = run;
  onSentRef.current = onSent;

  useEffect(() => {
    if (!agents.length || !target) { setReadiness(undefined); return; }
    let active = true;
    void api.agentReadiness().then((next) => {
      if (active) setReadiness(next);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not check Codex readiness');
    });
    return () => { active = false; };
  }, [agents.length, target]);

  useEffect(() => {
    const message = liveMessage;
    const current = runRef.current;
    if (!message || !current || !('runId' in message) || message.runId !== current.id) return;
    if (message.type === 'agent_run_status') {
      setRun({ ...current, status: message.status });
      return;
    }
    if (message.type !== 'agent_run_finished' || completedRuns.current.has(current.id)) return;
    completedRuns.current.add(current.id);
    void api.agentRun(current.id).then((next) => {
      setRun(next);
      if (targetRef.current) onSentRef.current(targetRef.current, message.resultBlockId);
    }).catch(() => { if (targetRef.current) onSentRef.current(targetRef.current, message.resultBlockId); });
  }, [liveMessage]);

  useEffect(() => {
    // Fall back to Message mode when the target is gone or the agent left the list,
    // otherwise the mode <select> disappears and the composer stays stuck in Agent mode.
    if (agentId && (!target || !agents.some((agent) => agent.id === agentId))) setAgentId('');
  }, [agentId, agents, target]);

  useEffect(() => {
    if (!agentId) return;
    let active = true;
    api.validateAgent(agentId).then((result) => {
      if (active) { setSkillNames(result.skills.map((skill) => skill.slug)); setError(undefined); }
    }).catch((reason: unknown) => {
      if (active) { setSkillNames([]); setError(reason instanceof Error ? reason.message : 'Invalid Agent'); }
    });
    return () => { active = false; };
  }, [agentId]);

  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return;
    const timer = window.setInterval(() => {
      void api.agentRun(run.id).then((next) => {
        setRun(next);
        if (!['queued', 'running'].includes(next.status) && !completedRuns.current.has(next.id)) {
	  completedRuns.current.add(next.id);
	  if (targetRef.current) onSent(targetRef.current);
        }
      }).catch(() => undefined);
    }, live ? 2_000 : 800);
    return () => window.clearInterval(timer);
  }, [live, onSent, run, target]);

  async function send() {
    if (!value.trim()) return;
    if (!agentId) {
      onSend(value.trim());
      setValue('');
      return;
    }
    if (!target || run && ['queued', 'running'].includes(run.status)) return;
    setError(undefined);
    try {
      targetRef.current = target.id;
      const next = await api.startAgentRun({ agentBlockId: agentId, targetBlockId: target.id, prompt: value, resume: true });
      completedRuns.current.delete(next.id);
      setRun(next);
      setValue('');
    } catch (reason) { setError(agentError(reason instanceof Error ? reason.message : 'Could not start Agent')); }
  }

  async function cancel() {
    if (!run) return;
    try { setRun(await api.cancelAgentRun(run.id)); }
    catch (reason) { setError(agentError(reason instanceof Error ? reason.message : 'Could not cancel Agent')); }
  }

  const busy = run && ['queued', 'running'].includes(run.status);
  const readinessLabel = !readiness
    ? 'Checking Local Agent…'
    : readiness.ready
      ? `${readiness.mode === 'fake' ? 'Demo runner' : readiness.version ?? 'Codex'} · ${readiness.mode === 'fake' ? 'deterministic' : 'Dryvre MCP ready'}`
      : 'Local Agent unavailable';
  const agentSelected = Boolean(agentId);
  return <div className="composer stream-composer">
    <textarea value={value} placeholder="Write to this block… Use @ to mention people, agents, or blocks" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send(); }} />
    {(agentSelected || busy) && <div className="agent-composer-status">
      {agentSelected && <div className={`agent-readiness ${readiness?.ready ? 'ready' : 'not-ready'}`}><i />{readinessLabel}<span>{skillNames.length ? `${skillNames.length} skills` : 'No skills'}</span>{readiness?.error && <small>{agentError(readiness.error)}</small>}</div>}
      {run && <div className={`run-state run-${run.status}`}><i />{runLabels[run.status]}{run.errorCode && <small>{agentError(run.errorCode)}</small>}{busy && <button onClick={() => void cancel()}>Cancel</button>}</div>}
      {error && <div className="agent-error">{error}</div>}
    </div>}
    <div className="composer-context"><span className="context-chip">◎ {blockTitle(selected)}</span><span>{contextSummary}</span></div>
    <div className="composer-actions"><button className="tool-pill">@ Reference</button>{agents.length > 0 && target && <select className="composer-mode" aria-label="Send as" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Message</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{(agent.bodyMd ?? '').match(/^#\s+@agent\s+([^\n]+)/)?.[1] ?? 'Agent'}</option>)}</select>}<button className={agentSelected ? 'agent-run-btn' : 'send-btn'} aria-label={agentSelected ? 'Run Agent' : 'Send message'} disabled={!value.trim() || (agentSelected && (Boolean(busy) || !readiness?.ready || !target))} onClick={() => void send()}>{agentSelected ? (busy ? 'Running' : 'Run') : '↑'}</button></div>
  </div>;
}
