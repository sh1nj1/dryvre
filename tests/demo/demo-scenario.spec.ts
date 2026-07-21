import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const ROOT_ID = '00000000-0000-4000-8000-000000000010';

test('completes the PM approval Inbox Developer demo on the real server', async ({ page }) => {
  await page.goto('/app');

  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name: /Inbox/ })).toBeVisible();
  await expect(sidebar.getByText('Launch Dryvre', { exact: true })).toBeVisible();
  await sidebar.getByText('Launch Dryvre', { exact: true }).click();

  await page.getByRole('tab', { name: /Stream/ }).click();
  await page.getByPlaceholder('Write to this block').fill('@PM Agent, turn this into an executable launch task');
  await page.getByRole('button', { name: 'Send message' }).click();

  await page.getByRole('tab', { name: /Document/ }).click();
  const taskTitle = page.locator('.doc-sheet').getByText('Publish and verify the Dryvre launch demo', { exact: true });
  await expect(taskTitle).toBeVisible();
  await page.getByRole('button', { name: 'Move to To do' }).click();

  await page.getByRole('tab', { name: /Board/ }).click();
  const blockedColumn = page.locator('.column').filter({ has: page.getByText('Blocked', { exact: true }) });
  await expect(blockedColumn.getByText('Publish and verify the Dryvre launch demo', { exact: true })).toBeVisible();

  await sidebar.getByRole('button', { name: /Inbox/ }).click();
  const approval = page.locator('.message').filter({ hasText: 'Approval required' });
  await expect(approval).toBeVisible();
  const currentTree = await page.request.get(`/api/trees/${ROOT_ID}`).then((response) => response.json()) as { blocks: Array<{ id: string; bodyMd: string }> };
  const approvalBlock = currentTree.blocks.find((block) => block.bodyMd.includes('Approval required'))!;
  const approvalResponse = await page.request.post('/api/ops', { data: { clientOpId: randomUUID(), op: { type: 'create', id: randomUUID(), parentId: approvalBlock.id, bodyMd: 'Approved. Publish the final demo URL publicly.', stream: true } } });
  expect(approvalResponse.ok()).toBe(true);

  await sidebar.getByText('Launch Dryvre', { exact: true }).click();
  await page.getByRole('tab', { name: /Document/ }).click();
  await expect(page.locator('.doc-sheet').getByText('Verification evidence', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Board/ }).click();
  const doneColumn = page.locator('.column').filter({ has: page.getByText('Done', { exact: true }) });
  await expect(doneColumn.getByText('Publish and verify the Dryvre launch demo', { exact: true })).toBeVisible();

  const response = await page.request.get(`/api/trees/${ROOT_ID}`);
  expect(response.ok()).toBe(true);
  const tree = await response.json() as {
    blocks: Array<{ id: string; parentId: string | null; rank: string | null; bodyMd: string; status: string | null }>;
    references: Array<{ fromId: string; toId: string }>;
  };
  const tasks = tree.blocks.filter((block) => block.rank !== null && block.bodyMd.includes('Publish and verify the Dryvre launch demo'));
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.status).toBe('done');
  const request = tree.blocks.find((block) => block.bodyMd.includes('Approval required'));
  expect(request).toBeDefined();
  expect(tree.references).toContainEqual({ fromId: request!.id, toId: tasks[0]!.id });
  expect(tree.blocks).toContainEqual(expect.objectContaining({ parentId: tasks[0]!.id, bodyMd: expect.stringContaining('Verification evidence') }));
});
