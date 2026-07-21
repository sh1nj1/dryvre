import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { blocks, opLog, refs, type DryvreDatabase } from '@dryvre/db';
import { sortBlocksInDocumentOrder, type Block, type BlockOp, type OpEnvelope } from '@dryvre/shared';

export type DryvreTransaction = Parameters<Parameters<DryvreDatabase['transaction']>[0]>[0];

function serializeBlock(row: typeof blocks.$inferSelect): Block {
  return {
    id: row.id,
    parentId: row.parentId,
    path: row.path,
    rank: row.rank,
    bodyMd: row.bodyMd,
    status: row.status,
    authorId: row.authorId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSubtree(db: DryvreDatabase, rootId: string, query?: string) {
  const root = await db.query.blocks.findFirst({ where: eq(blocks.id, rootId) });
  if (!root) return null;
  const search = query?.trim();
  const rows = await db.select().from(blocks).where(and(
    like(blocks.path, `${root.path}%`),
    search ? sql`to_tsvector('simple', ${blocks.bodyMd}) @@ plainto_tsquery('simple', ${search})` : undefined,
  ));
  return sortBlocksInDocumentOrder(rows.map(serializeBlock));
}

export async function getReferences(db: DryvreDatabase, blockIds: string[]) {
  if (!blockIds.length) return [];
  return db.select({ fromId: refs.fromBlockId, toId: refs.toBlockId }).from(refs).where(or(
    inArray(refs.fromBlockId, blockIds),
    inArray(refs.toBlockId, blockIds),
  ));
}

async function assertVersion(tx: DryvreTransaction, id: string, version?: number) {
  if (version === undefined) return;
  const current = await tx.select({ version: blocks.version }).from(blocks).where(eq(blocks.id, id)).limit(1);
  if (current[0]?.version !== version) throw new Error(`Block ${id} changed on the server`);
}

async function applyMutation(tx: DryvreTransaction, op: BlockOp, actorId: string) {
  const now = new Date();
  switch (op.type) {
    case 'create': {
      const blockId = op.id;
      if (!blockId) throw new Error('Create operation requires a normalized block id');
      const parent = op.parentId ? await tx.query.blocks.findFirst({ where: eq(blocks.id, op.parentId) }) : null;
      if (op.parentId && !parent) throw new Error('Parent block not found');
      const rank = op.stream ? null : `${Date.now().toString(36)}:${blockId}`;
      await tx.insert(blocks).values({ id: blockId, parentId: op.parentId, path: `${parent?.path ?? '/'}${blockId}/`, rank, bodyMd: op.bodyMd, authorId: actorId });
      break;
    }
    case 'edit':
      await assertVersion(tx, op.id, op.version);
      await tx.update(blocks).set({ bodyMd: op.bodyMd, version: sql`${blocks.version} + 1`, updatedAt: now }).where(eq(blocks.id, op.id));
      break;
    case 'setStatus':
      await assertVersion(tx, op.id, op.version);
      await tx.update(blocks).set({ status: op.status, version: sql`${blocks.version} + 1`, updatedAt: now }).where(eq(blocks.id, op.id));
      break;
    case 'move': {
      await assertVersion(tx, op.id, op.version);
      const moving = await tx.query.blocks.findFirst({ where: eq(blocks.id, op.id) });
      const parent = op.parentId ? await tx.query.blocks.findFirst({ where: eq(blocks.id, op.parentId) }) : null;
      if (!moving || (op.parentId && !parent)) throw new Error('Block or destination not found');
      if (parent?.path.startsWith(moving.path)) throw new Error('Cannot move a block inside its own subtree');
      const newPath = `${parent?.path ?? '/'}${moving.id}/`;
      await tx.execute(sql`update ${blocks} set path = ${newPath} || substring(path from ${moving.path.length + 1}) where path like ${`${moving.path}%`}`);
      await tx.update(blocks).set({ parentId: op.parentId, rank: op.rank, version: sql`${blocks.version} + 1`, updatedAt: now }).where(eq(blocks.id, op.id));
      break;
    }
    case 'ref':
      if (op.fromId === op.toId) throw new Error('A block cannot reference itself');
      await tx.insert(refs).values({ fromBlockId: op.fromId, toBlockId: op.toId }).onConflictDoNothing();
      break;
    case 'unref':
      await tx.delete(refs).where(and(eq(refs.fromBlockId, op.fromId), eq(refs.toBlockId, op.toId)));
      break;
    case 'delete':
      await assertVersion(tx, op.id, op.version);
      await tx.delete(blocks).where(eq(blocks.id, op.id));
      break;
  }
}

export async function applyOperationInTransaction(tx: DryvreTransaction, envelope: OpEnvelope, actorId: string) {
  const existing = await tx.query.opLog.findFirst({ where: and(eq(opLog.clientOpId, envelope.clientOpId), eq(opLog.actorId, actorId)) });
  if (existing) return { sequence: existing.sequence, op: existing.payload as BlockOp };
  const op: BlockOp = envelope.op.type === 'create' && !envelope.op.id
    ? { ...envelope.op, id: randomUUID() }
    : envelope.op;
  const [logged] = await tx.insert(opLog).values({ clientOpId: envelope.clientOpId, actorId, op: op.type, payload: op }).returning({ sequence: opLog.sequence });
  await applyMutation(tx, op, actorId);
  if (!logged) throw new Error('Could not append operation log');
  await tx.execute(sql`select pg_notify('dryvre_ops', ${JSON.stringify({ sequence: logged.sequence, actorId })})`);
  return { sequence: logged.sequence, op };
}

export async function applyOperation(db: DryvreDatabase, envelope: OpEnvelope, actorId: string) {
  return db.transaction((tx) => applyOperationInTransaction(tx, envelope, actorId));
}

export async function getAiContext(db: DryvreDatabase, blockId: string) {
  const root = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!root) throw new Error('Block not found');
  const referenced = db.select({ block: blocks }).from(refs).innerJoin(blocks, eq(refs.toBlockId, blocks.id)).where(eq(refs.fromBlockId, blockId));
  const subtree = db.select().from(blocks).where(or(eq(blocks.id, blockId), like(blocks.path, `${root.path}%`))).orderBy(asc(blocks.path));
  const [treeRows, refRows] = await Promise.all([subtree, referenced]);
  return [...treeRows.map((row) => row.bodyMd), ...refRows.map((row) => row.block.bodyMd)].join('\n\n');
}
