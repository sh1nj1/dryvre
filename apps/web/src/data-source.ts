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
