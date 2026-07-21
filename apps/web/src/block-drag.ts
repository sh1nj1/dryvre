import type { DryvreBlock } from './model';

export type TreeDropPosition = 'before' | 'inside' | 'after';
export type BlockMove = { parentId: string | null; afterId: string | null };

export function dropPositionFromPointer(top: number, height: number, clientY: number): TreeDropPosition {
  const ratio = height > 0 ? (clientY - top) / height : 0.5;
  if (ratio < 1 / 3) return 'before';
  if (ratio > 2 / 3) return 'after';
  return 'inside';
}

function descendantIds(blockId: string, blocks: DryvreBlock[]) {
  const result = new Set<string>();
  let parents = new Set([blockId]);
  while (parents.size) {
    const children = blocks.filter((block) => block.parentId && parents.has(block.parentId));
    parents = new Set(children.map((block) => block.id));
    children.forEach((block) => result.add(block.id));
  }
  return result;
}

export function planBlockMove(blockId: string, targetId: string, position: TreeDropPosition, blocks: DryvreBlock[], rootId: string): BlockMove | null {
  const moving = blocks.find((block) => block.id === blockId);
  const target = blocks.find((block) => block.id === targetId);
  if (!moving || !target || blockId === rootId || blockId === targetId || descendantIds(blockId, blocks).has(targetId)) return null;
  if (targetId === rootId && position !== 'inside') return null;
  if (position === 'inside') {
    const children = blocks.filter((block) => block.canonical && block.parentId === targetId && block.id !== blockId);
    return { parentId: targetId, afterId: children.at(-1)?.id ?? null };
  }
  const siblings = blocks.filter((block) => block.canonical && block.parentId === target.parentId && block.id !== blockId);
  const targetIndex = siblings.findIndex((block) => block.id === targetId);
  if (targetIndex < 0) return null;
  return { parentId: target.parentId, afterId: position === 'after' ? targetId : siblings[targetIndex - 1]?.id ?? null };
}

export function moveMockBlock(blocks: DryvreBlock[], blockId: string, move: BlockMove) {
  const movingIds = new Set([blockId, ...descendantIds(blockId, blocks)]);
  const moving = blocks.filter((block) => movingIds.has(block.id));
  const remaining = blocks.filter((block) => !movingIds.has(block.id));
  const root = moving.find((block) => block.id === blockId);
  if (!root) return blocks;
  root.parentId = move.parentId;
  let insertion = 0;
  if (move.afterId) {
    const afterIds = new Set([move.afterId, ...descendantIds(move.afterId, remaining)]);
    insertion = Math.max(...remaining.map((block, index) => afterIds.has(block.id) ? index + 1 : 0));
  } else if (move.parentId) {
    insertion = remaining.findIndex((block) => block.id === move.parentId) + 1;
  }
  const result = [...remaining];
  result.splice(Math.max(0, insertion), 0, ...moving);
  return result;
}
