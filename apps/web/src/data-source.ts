import { initialSnapshot } from './mock-data';
import type { BlockMessage, DryvreDataSource, DryvreSnapshot, SearchFilters, TaskStatus } from './model';

function copySnapshot(snapshot: DryvreSnapshot): DryvreSnapshot {
  return {
    ...snapshot,
    blocks: snapshot.blocks.map((block) => ({ ...block })),
    references: snapshot.references.map((reference) => ({ ...reference })),
    messages: snapshot.messages.map(({ createdBlocks, ...message }) => createdBlocks ? { ...message, createdBlocks: [...createdBlocks] } : { ...message }),
  };
}

export class MockDryvreDataSource implements DryvreDataSource {
  private snapshot = copySnapshot(initialSnapshot);

  async load() {
    return copySnapshot(this.snapshot);
  }

  async setStatus(blockId: string, status: TaskStatus) {
    const block = this.snapshot.blocks.find((item) => item.id === blockId);
    if (block) block.status = status;
  }

  async createMessage(parentId: string, body: string) {
    const message: BlockMessage = {
      id: crypto.randomUUID(),
      parentId,
      author: 'Soonoh',
      initials: 'SO',
      body,
      timeLabel: 'Just now',
    };
    this.snapshot.messages.push(message);
    return { ...message };
  }

  async editBlock(blockId: string, bodyMd: string, version: number) {
    const block = this.snapshot.blocks.find((item) => item.id === blockId);
    if (!block) throw new Error('Block not found');
    if ((block.version ?? 0) !== version) throw new Error('Block changed on the server');
    block.bodyMd = bodyMd;
    block.version = version + 1;
    return { ...block };
  }

  async createBlockAfter(blockId: string, bodyMd: string) {
    const index = this.snapshot.blocks.findIndex((item) => item.id === blockId);
    const current = this.snapshot.blocks[index];
    if (!current) throw new Error('Block not found');
    const currentWithoutStatus = { ...current };
    delete currentWithoutStatus.status;
    const block = {
      ...currentWithoutStatus,
      id: crypto.randomUUID(),
      title: bodyMd.split('\n', 1)[0]?.replace(/^#{1,6}\s+/, '') || 'Untitled',
      bodyMd,
      updatedLabel: 'Just now',
      version: 0,
    };
    this.snapshot.blocks.splice(index + 1, 0, block);
    return { ...block };
  }

  async deleteBlock(blockId: string) {
    const removed = new Set([blockId]);
    let parents = [blockId];
    while (parents.length) {
      const children = this.snapshot.blocks.filter((block) => block.parentId && parents.includes(block.parentId));
      children.forEach((block) => removed.add(block.id));
      parents = children.map((block) => block.id);
    }
    this.snapshot.blocks = this.snapshot.blocks.filter((block) => !removed.has(block.id));
    this.snapshot.messages = this.snapshot.messages.filter((message) => !removed.has(message.parentId));
    this.snapshot.references = this.snapshot.references.filter((reference) => !removed.has(reference.fromId) && !removed.has(reference.toId));
  }

  async search(filters: SearchFilters) {
    const text = filters.text.trim().toLocaleLowerCase();
    return this.snapshot.blocks.filter((block) => {
      if (text && !`${block.title} ${block.bodyMd ?? ''}`.toLocaleLowerCase().includes(text)) return false;
      if (filters.status === 'not_task' && block.status) return false;
      if (filters.status && filters.status !== 'not_task' && block.status !== filters.status) return false;
      if (filters.author && block.author !== filters.author) return false;
      if (filters.referenceId && !this.snapshot.references.some((reference) => reference.fromId === block.id && reference.toId === filters.referenceId)) return false;
      return true;
    }).map((block) => block.id);
  }
}

export const dryvreDataSource: DryvreDataSource = new MockDryvreDataSource();
