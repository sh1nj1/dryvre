import { useMemo, useState } from 'react';
import type { Block, BlockStatus } from '@dryvre/shared';
import { BlockEditor, Composer, StatusPill } from './components';
import { ROOT_ID, useTree } from './use-tree';
import './styles.css';

type View = 'document' | 'board' | 'stream';
const columns: { status: BlockStatus; label: string }[] = [
  { status: 'todo', label: 'To do' }, { status: 'in_progress', label: 'In progress' }, { status: 'blocked', label: 'Blocked' }, { status: 'done', label: 'Done' },
];

function titleOf(block: Block) { return block.bodyMd.replace(/^#+\s*/, '').split('\n')[0] || 'Untitled'; }

export default function App() {
  const [view, setView] = useState<View>('document');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(ROOT_ID);
  const { blocks, byId, loading, error, online, refresh } = useTree(ROOT_ID, query);
  const root = byId.get(ROOT_ID) ?? blocks[0];
  const canonical = useMemo(() => blocks.filter((block) => block.rank !== null && block.id !== ROOT_ID), [blocks]);
  const stream = useMemo(() => [...blocks].filter((block) => block.rank === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [blocks]);
  const tasks = useMemo(() => blocks.filter((block) => block.status !== null), [blocks]);

  return <div className="shell">
    <header><a className="brand" href="/"><span>D</span>dryvre</a><div className="breadcrumb">Workspace <b>/</b> {root ? titleOf(root) : 'Tree'}</div><div className={`presence ${online ? 'online' : ''}`}><i />{online ? 'Live' : 'Offline'}</div></header>
    <aside>
      <div className="workspace"><span>DV</span><div><b>Build Week</b><small>One shared tree</small></div></div>
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this tree" /></label>
      <div className="section-label">TREE <button>+</button></div>
      <nav>{blocks.filter((block) => block.rank !== null).map((block) => {
        const depth = Math.max(0, block.path.split('/').filter(Boolean).length - 1);
        return <button key={block.id} className={selected === block.id ? 'active' : ''} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => setSelected(block.id)}><span>{block.status ? '□' : '◇'}</span>{titleOf(block)}</button>;
      })}</nav>
      <footer><span>3 concepts</span><b>Block · Tree · Reference</b></footer>
    </aside>
    <main>
      <div className="main-head"><div><small>SHARED BLOCK TREE</small><h1>{root ? titleOf(root) : 'Dryvre'}</h1><p>One source of truth, rendered for the work at hand.</p></div><div className="switcher">{(['document', 'board', 'stream'] as View[]).map((item) => <button className={view === item ? 'active' : ''} onClick={() => setView(item)} key={item}>{item === 'document' ? 'Document' : item === 'board' ? 'Board' : 'Stream'}</button>)}</div></div>
      <section className="canvas">
        {loading && <div className="notice">Loading tree…</div>}
        {error && <div className="notice error">{error}<small>Start Postgres, run migrations, then start the server.</small></div>}
        {!loading && !error && view === 'document' && <div className="document">{canonical.map((block) => <div className="doc-row" key={block.id}><span className="drag">⋮⋮</span><div><BlockEditor block={block} onSaved={refresh} />{block.status && <StatusPill block={block} onSaved={refresh} />}</div></div>)}<Composer parentId={selected} onSent={refresh} /></div>}
        {!loading && !error && view === 'board' && <div className="board">{columns.map((column) => <div className="column" key={column.status}><h2><i className={`dot ${column.status}`} />{column.label}<span>{tasks.filter((task) => task.status === column.status).length}</span></h2>{tasks.filter((task) => task.status === column.status).map((task) => <article className="card" key={task.id}><BlockEditor block={task} onSaved={refresh} /><StatusPill block={task} onSaved={refresh} /></article>)}</div>)}</div>}
        {!loading && !error && view === 'stream' && <div className="stream">{stream.map((message) => <article key={message.id}><div className="avatar">{message.authorId.slice(-2).toUpperCase()}</div><div><header><b>{message.authorId === '00000000-0000-4000-8000-000000000001' ? 'You' : 'Collaborator'}</b><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><BlockEditor block={message} onSaved={refresh} /></div></article>)}<Composer parentId={selected} onSent={refresh} /></div>}
      </section>
    </main>
    <section className="context"><div className="context-head"><small>FOCUS</small><h2>{titleOf(byId.get(selected) ?? root ?? ({ bodyMd: 'Block' } as Block))}</h2></div><div className="context-body"><h3>AI collaborator</h3><p>AI reads the focused subtree and references. Its answer returns as a block.</p><Composer parentId={selected} ai onSent={refresh} /><h3>References</h3><button className="add-ref">+ Add a block reference</button><h3>Details</h3><dl><dt>View</dt><dd>{view}</dd><dt>Blocks</dt><dd>{blocks.length}</dd><dt>Tasks</dt><dd>{tasks.length}</dd></dl></div></section>
  </div>;
}
