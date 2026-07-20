import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Block, BlockStatus } from '@dryvre/shared';
import { api } from './api';

export function BlockEditor({ block, onSaved }: { block: Block; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(block.bodyMd);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(block.bodyMd), [block.bodyMd]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);

  async function save() {
    setEditing(false);
    if (value === block.bodyMd) return;
    await api.apply({ type: 'edit', id: block.id, bodyMd: value, version: block.version });
    onSaved();
  }

  if (editing) return <textarea ref={input} className="block-editor" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void save();
    if (event.key === 'Escape') { setValue(block.bodyMd); setEditing(false); }
  }} />;
  return <article className="block-content" onDoubleClick={() => setEditing(true)}><ReactMarkdown>{block.bodyMd}</ReactMarkdown></article>;
}

export function StatusPill({ block, onSaved }: { block: Block; onSaved: () => void }) {
  const statuses: { value: BlockStatus; label: string }[] = [
    { value: 'todo', label: 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' },
  ];
  return <select className={`status status-${block.status ?? 'none'}`} value={block.status ?? ''} onChange={async (event) => {
    await api.apply({ type: 'setStatus', id: block.id, status: (event.target.value || null) as BlockStatus | null, version: block.version });
    onSaved();
  }}><option value="">Not a task</option>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select>;
}

export function Composer({ parentId, ai = false, onSent }: { parentId: string; ai?: boolean; onSent: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      if (ai) await api.askAi(parentId, value);
      else await api.apply({ type: 'create', parentId, bodyMd: value, stream: true });
      setValue('');
      onSent();
    } finally { setBusy(false); }
  }
  return <div className="composer"><textarea value={value} placeholder={ai ? 'Ask AI using this subtree + references…' : 'Write to this block…'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
  }} /><button disabled={busy || !value.trim()} onClick={() => void send()}>{busy ? '…' : ai ? 'Ask AI' : 'Send'}</button></div>;
}
