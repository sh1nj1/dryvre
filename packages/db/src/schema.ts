import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const subjectKind = pgEnum('subject_kind', ['human', 'agent']);
export const grantLevel = pgEnum('grant_level', ['read', 'write', 'manage']);
export const blockStatus = pgEnum('block_status', ['todo', 'in_progress', 'blocked', 'done']);

export const subjects = pgTable('subject', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: subjectKind('kind').notNull().default('human'),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [uniqueIndex('subject_handle_uq').on(table.handle)]);

export const blocks = pgTable('block', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').references((): AnyPgColumn => blocks.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  rank: text('rank'),
  bodyMd: text('body_md').notNull().default(''),
  status: blockStatus('status'),
  authorId: uuid('author_id').notNull().references(() => subjects.id),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('block_parent_rank_idx').on(table.parentId, table.rank, table.createdAt),
  index('block_path_prefix_idx').using('btree', table.path.asc().op('text_pattern_ops')),
  index('block_status_idx').on(table.status),
]);

export const grants = pgTable('grant', {
  blockId: uuid('block_id').notNull().references(() => blocks.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
  level: grantLevel('level').notNull(),
}, (table) => [primaryKey({ columns: [table.blockId, table.subjectId] })]);

export const refs = pgTable('ref', {
  fromBlockId: uuid('from_block_id').notNull().references(() => blocks.id, { onDelete: 'cascade' }),
  toBlockId: uuid('to_block_id').notNull().references(() => blocks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.fromBlockId, table.toBlockId] }),
  index('ref_to_block_idx').on(table.toBlockId),
]);

export const opLog = pgTable('op_log', {
  sequence: integer('sequence').primaryKey().generatedAlwaysAsIdentity(),
  id: uuid('id').notNull().defaultRandom(),
  clientOpId: uuid('client_op_id').notNull(),
  actorId: uuid('actor_id').notNull().references(() => subjects.id),
  op: text('op').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [uniqueIndex('op_log_id_uq').on(table.id), uniqueIndex('op_log_client_actor_uq').on(table.clientOpId, table.actorId)]);

export const sessions = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [uniqueIndex('session_token_hash_uq').on(table.tokenHash), index('session_subject_idx').on(table.subjectId)]);

export type BlockRow = typeof blocks.$inferSelect;
export type NewBlockRow = typeof blocks.$inferInsert;
