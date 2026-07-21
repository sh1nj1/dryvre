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

export function blockTitle(block: Pick<DryvreBlock, 'title' | 'bodyMd'>) {
  const firstLine = block.bodyMd?.trimStart().split('\n', 1)[0] ?? '';
  const heading = firstLine.match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
  return heading?.[1]?.trim() || block.title;
}

export function blockSummary(block: Pick<DryvreBlock, 'bodyMd'>) {
  const bodyMd = block.bodyMd ?? '';
  const trimmed = bodyMd.trimStart();
  // Accept CRLF line endings: `.` stops before `\r`, so the terminator must allow `\r?\n`.
  const heading = /^#{1,6}\s+.*(?:\r?\n|$)/;
  return heading.test(trimmed) ? trimmed.replace(heading, '').trimStart() : bodyMd;
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
