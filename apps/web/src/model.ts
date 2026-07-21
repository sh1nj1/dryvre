import type { BlockStatus } from '@dryvre/shared';

export type ViewMode = 'document' | 'board' | 'stream';
export type TaskStatus = BlockStatus;

export interface DryvreBlock {
  id: string;
  parentId: string | null;
  title: string;
  bodyMd?: string;
  icon?: string;
  status?: TaskStatus;
  author: string;
  updatedLabel: string;
  canonical: boolean;
  version?: number;
}

export interface BlockReference {
  fromId: string;
  toId: string;
  summary: string;
}

export interface BlockMessage {
  id: string;
  parentId: string;
  author: string;
  initials: string;
  body: string;
  timeLabel: string;
  agent?: boolean;
  createdBlocks?: string[];
}

export interface DryvreSnapshot {
  rootId: string;
  focusedRootId: string;
  blocks: DryvreBlock[];
  references: BlockReference[];
  messages: BlockMessage[];
}

export interface SearchFilters {
  text: string;
  referenceId: string;
  status: TaskStatus | 'not_task' | '';
  author: string;
  updated: 'today' | 'week' | 'month' | '';
}

export interface DryvreDataSource {
  load(): Promise<DryvreSnapshot>;
  setStatus(blockId: string, status: TaskStatus): Promise<void>;
  createMessage(parentId: string, body: string): Promise<BlockMessage>;
  search(filters: SearchFilters): Promise<string[]>;
  editBlock(blockId: string, bodyMd: string, version: number): Promise<DryvreBlock>;
  createBlockAfter(blockId: string, bodyMd: string): Promise<DryvreBlock>;
  deleteBlock(blockId: string): Promise<void>;
}

// A Markdown ATX heading, per CommonMark: up to 3 leading spaces (4+ is an
// indented code block, which ReactMarkdown renders as code, not a heading);
// 1-6 hashes; then *horizontal* whitespace (`[ \t]`, never a newline, so an
// empty heading like `#` cannot consume the following line); the title text;
// and an optional whitespace-separated closing hash sequence. `blockTitle` and
// `blockSummary` share this single detector so their projections never drift.
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/;

// Isolate the first non-blank line without collapsing its indentation — leading
// blank lines are skipped, but a 4-space indent on the first content line must
// survive so the ATX rule above can reject it as code.
function firstContentLine(bodyMd: string) {
  const lines = bodyMd.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;
  return { line: (lines[i] ?? '').replace(/\r$/, ''), rest: lines.slice(i + 1).join('\n') };
}

export function blockTitle(block: Pick<DryvreBlock, 'title' | 'bodyMd'>) {
  const heading = firstContentLine(block.bodyMd ?? '').line.match(ATX_HEADING);
  return heading?.[1]?.trim() || block.title;
}

export function blockSummary(block: Pick<DryvreBlock, 'bodyMd'>) {
  const bodyMd = block.bodyMd ?? '';
  const { line, rest } = firstContentLine(bodyMd);
  // Drop only the blank separator lines between the heading and the body, not
  // the indentation of the first content line — a 4-space indent there is an
  // indented code block that must survive so ReactMarkdown still renders it as
  // code rather than plain text.
  return ATX_HEADING.test(line) ? rest.replace(/^(?:[ \t]*\r?\n)+/, '') : bodyMd;
}

// A single-line CommonMark link reference definition (`[label]: dest "title"`),
// with up to 3 leading spaces (4+ is indented code). These render to nothing but
// supply targets for reference-style links.
const REF_DEFINITION = /^ {0,3}\[[^\]]+\]:\s+\S.*$/gm;

// Markdown for a block's projected heading. When the body starts with an ATX
// heading, return that original line verbatim so its level (# vs ###) and inline
// formatting (code, links, emphasis) are preserved; otherwise synthesize a
// level-2 heading from the fallback title. Rendering the result in heading
// context keeps inline formatting while stopping a title like `1. Foo` from
// being reparsed as a list. The heading is projected in isolation, so a
// reference-style link (`# [Spec][spec]`) would lose its definition living
// elsewhere in the body; carry the body's reference definitions along so those
// links still resolve. Unused definitions render to nothing, so this can never
// add visible output.
export function headingMarkdown(block: Pick<DryvreBlock, 'title' | 'bodyMd'>) {
  const bodyMd = block.bodyMd ?? '';
  const { line } = firstContentLine(bodyMd);
  const heading = ATX_HEADING.test(line) ? line : `## ${blockTitle(block)}`;
  const defs = bodyMd.match(REF_DEFINITION);
  return defs ? `${heading}\n\n${defs.join('\n')}` : heading;
}

export function blockPath(blockId: string, blocks: DryvreBlock[]) {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const path: DryvreBlock[] = [];
  let current = byId.get(blockId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function descendantsOf(blockId: string, blocks: DryvreBlock[]) {
  const children = new Map<string, DryvreBlock[]>();
  blocks.forEach((block) => {
    if (!block.parentId) return;
    const siblings = children.get(block.parentId) ?? [];
    siblings.push(block);
    children.set(block.parentId, siblings);
  });
  const result: DryvreBlock[] = [];
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      result.push(child);
      visit(child.id);
    }
  };
  visit(blockId);
  return result;
}
