import type { BlockMessage, DryvreBlock, DryvreSnapshot } from './model';

export const mockBlocks: DryvreBlock[] = [
  { id: 'studio', parentId: null, title: 'Product Studio', icon: '◈', author: 'Soonoh', updatedLabel: 'Today', canonical: true },
  { id: 'launch', parentId: 'studio', title: 'Build Week Launch', icon: '◫', author: 'Soonoh', updatedLabel: '2 minutes ago', canonical: true },
  { id: 'thesis', parentId: 'launch', title: 'Product thesis', bodyMd: '## A calmer place to move work forward.\n\nDryvre keeps documents, tasks, and conversations in one shared tree. Nothing needs to be copied, converted, or synced—each view is simply another way to see the same blocks.', icon: '¶', author: 'Soonoh', updatedLabel: '12 minutes ago', canonical: true },
  { id: 'core', parentId: 'launch', title: 'Core experience', bodyMd: '### Core experience', icon: '◎', author: 'Soonoh', updatedLabel: '4 minutes ago', canonical: true },
  { id: 'three-views', parentId: 'core', title: 'Three views, one tree', bodyMd: 'Document for knowledge, board for execution, stream for discussion. Switching views never changes the underlying structure.', icon: '□', status: 'in_progress', author: 'Soonoh', updatedLabel: '2 minutes ago', canonical: true },
  { id: 'document-renderer', parentId: 'three-views', title: 'Document tree renderer', bodyMd: 'Nested blocks render as a calm, readable living document.', icon: '□', status: 'done', author: 'Soonoh', updatedLabel: '32 minutes ago', canonical: true },
  { id: 'board-interactions', parentId: 'three-views', title: 'Board status interactions', bodyMd: 'Move a block between states without creating a separate task record.', icon: '□', status: 'todo', author: 'Soonoh', updatedLabel: '18 minutes ago', canonical: true },
  { id: 'ai-tree', parentId: 'core', title: 'AI writes back into the tree', bodyMd: 'Mentioning an agent automatically gathers this subtree and explicit references. Its answer arrives as editable child blocks, not a sealed chat response.', icon: '✦', status: 'in_progress', author: 'Dryvre AI', updatedLabel: '8 minutes ago', canonical: true },
  { id: 'launch-checklist', parentId: 'launch', title: 'Launch checklist', bodyMd: '### Launch checklist', icon: '☑', author: 'Mina Kim', updatedLabel: '21 minutes ago', canonical: true },
  { id: 'seed-demo', parentId: 'launch-checklist', title: 'Seed demo workspace', bodyMd: 'A coherent product story, ready when the app opens.', icon: '□', status: 'done', author: 'Mina Kim', updatedLabel: '1 hour ago', canonical: true },
  { id: 'record-story', parentId: 'launch-checklist', title: 'Record the three-minute product story', bodyMd: 'Show one idea moving naturally across all three views.', icon: '□', status: 'todo', author: 'Mina Kim', updatedLabel: '14 minutes ago', canonical: true },
  { id: 'research', parentId: 'studio', title: 'User research', bodyMd: 'Four interviews synthesized around context switching and duplicated work.', icon: '◌', author: 'Mina Kim', updatedLabel: 'Yesterday', canonical: true },
  { id: 'design', parentId: 'studio', title: 'Design system', bodyMd: 'Calm, editorial surfaces for shared work.', icon: '◐', author: 'Soonoh', updatedLabel: 'Yesterday', canonical: true },
  { id: 'decisions', parentId: 'studio', title: 'Decision log', bodyMd: 'Product and architecture decisions.', icon: '↳', author: 'Soonoh', updatedLabel: 'Yesterday', canonical: true },
  { id: 'build-week', parentId: 'studio', title: 'OpenAI Build Week', bodyMd: 'Judging criteria and submission requirements.', icon: '↗', author: 'Soonoh', updatedLabel: 'Yesterday', canonical: true },
];

export const mockMessages: BlockMessage[] = [
  { id: 'message-1', parentId: 'three-views', author: 'Soonoh', initials: 'SO', timeLabel: 'Today, 14:22', body: 'The demo should make the ontology obvious without explaining our database. Can we use one launch brief and watch it become work?' },
  { id: 'message-2', parentId: 'three-views', author: 'Mina Kim', initials: 'MK', timeLabel: '14:28', body: 'Yes. Keep the selected block fixed while switching views. That makes “same object, different lens” immediately visible.' },
  { id: 'message-3', parentId: 'three-views', author: 'Dryvre AI', initials: '✦', timeLabel: '14:31 · GPT-5.6', body: 'I read this subtree and the referenced Build Week criteria. Here is a concise demo sequence written back as child blocks:', agent: true, createdBlocks: ['Open in Document and establish the product thesis.', 'Switch to Board; move “Three views, one tree” to Done.', 'Return here and mention Dryvre AI to create the launch checklist.'] },
];

export const initialSnapshot: DryvreSnapshot = {
  rootId: 'studio',
  focusedRootId: 'launch',
  blocks: mockBlocks,
  messages: mockMessages,
  references: [
    { fromId: 'three-views', toId: 'build-week', summary: 'Judging criteria · submission requirements' },
    { fromId: 'three-views', toId: 'research', summary: '4 interviews · synthesized yesterday' },
  ],
};
