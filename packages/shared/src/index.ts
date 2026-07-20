import { z } from 'zod';

export const blockStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done']);
export type BlockStatus = z.infer<typeof blockStatusSchema>;

export const blockSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  path: z.string(),
  rank: z.string().nullable(),
  bodyMd: z.string(),
  status: blockStatusSchema.nullable(),
  authorId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Block = z.infer<typeof blockSchema>;

const id = z.string().uuid();
const version = z.number().int().nonnegative().optional();

export const blockOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), id: id.optional(), parentId: id.nullable(), afterId: id.optional(), bodyMd: z.string().max(100_000), stream: z.boolean().default(false) }),
  z.object({ type: z.literal('move'), id, parentId: id.nullable(), rank: z.string().nullable(), version }),
  z.object({ type: z.literal('edit'), id, bodyMd: z.string().max(100_000), version }),
  z.object({ type: z.literal('setStatus'), id, status: blockStatusSchema.nullable(), version }),
  z.object({ type: z.literal('ref'), fromId: id, toId: id }),
  z.object({ type: z.literal('unref'), fromId: id, toId: id }),
  z.object({ type: z.literal('delete'), id, version }),
]);
export type BlockOp = z.infer<typeof blockOpSchema>;

export const opEnvelopeSchema = z.object({
  clientOpId: z.string().uuid(),
  op: blockOpSchema,
});
export type OpEnvelope = z.infer<typeof opEnvelopeSchema>;

export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), actorId: id }),
  z.object({ type: z.literal('applied'), clientOpId: id, sequence: z.number().int(), op: blockOpSchema }),
  z.object({ type: z.literal('rejected'), clientOpId: id, reason: z.string() }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

export type TreeNode = Block & { children: TreeNode[] };

export function deriveBlockKind(bodyMd: string) {
  if (/^```/.test(bodyMd)) return 'code';
  if (/^#{1,6}\s/.test(bodyMd)) return 'heading';
  if (/^(?:[-*+] |\d+\. )/.test(bodyMd)) return 'list';
  return 'paragraph';
}
