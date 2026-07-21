import { expect, test } from '@playwright/test';

test('moves document blocks structurally and drops tree blocks into board statuses', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const firstId = '00000000-0000-4000-8000-000000000011';
  const secondId = '00000000-0000-4000-8000-000000000012';
  const childId = '00000000-0000-4000-8000-000000000013';
  const authorId = '00000000-0000-4000-8000-000000000001';
  const timestamp = '2026-07-22T00:00:00.000Z';
  const makeBlock = (id: string, parentId: string | null, rank: string, bodyMd: string, path: string) => ({
    id, parentId, path, rank, bodyMd, status: null, authorId, version: 0, createdAt: timestamp, updatedAt: timestamp,
  });
  const blocks = [
    makeBlock(rootId, null, 'a0', '# Drag test', `/${rootId}/`),
    makeBlock(firstId, rootId, 'a1', '# First block', `/${rootId}/${firstId}/`),
    makeBlock(secondId, rootId, 'a2', '# Second block', `/${rootId}/${secondId}/`),
    makeBlock(childId, secondId, 'a1', 'Existing child', `/${rootId}/${secondId}/${childId}/`),
  ];
  const operations: Array<Record<string, unknown>> = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) return route.fulfill({ json: { blocks } });
    if (url.pathname === '/api/ops' && request.method() === 'POST') {
      operations.push((request.postDataJSON() as { op: Record<string, unknown> }).op);
      return route.fulfill({ json: { type: 'applied', sequence: operations.length } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/app');
  const first = page.locator('.doc-block').filter({ hasText: 'First block' }).first();
  const second = page.locator('.doc-block').filter({ hasText: 'Second block' }).first();
  const targetBox = (await second.boundingBox())!;
  await first.dragTo(second, { targetPosition: { x: targetBox.width / 2, y: targetBox.height / 2 } });
  await expect.poll(() => operations).toContainEqual(expect.objectContaining({
    type: 'move', id: firstId, parentId: secondId, afterId: childId,
  }));

  await page.getByRole('tab', { name: /Board/ }).click();
  const treeBlock = page.locator('.tree-row').filter({ hasText: 'First block' });
  await treeBlock.dragTo(page.locator('.column').nth(1));
  await expect.poll(() => operations).toContainEqual(expect.objectContaining({
    type: 'setStatus', id: firstId, status: 'in_progress',
  }));
});

test('rejects board drops for tree blocks outside the current scope', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const alphaId = '00000000-0000-4000-8000-000000000011';
  const betaId = '00000000-0000-4000-8000-000000000012';
  const authorId = '00000000-0000-4000-8000-000000000001';
  const timestamp = '2026-07-22T00:00:00.000Z';
  const makeBlock = (id: string, parentId: string | null, rank: string, bodyMd: string, path: string) => ({
    id, parentId, path, rank, bodyMd, status: null, authorId, version: 0, createdAt: timestamp, updatedAt: timestamp,
  });
  const blocks = [
    makeBlock(rootId, null, 'a0', '# Scope test', `/${rootId}/`),
    makeBlock(alphaId, rootId, 'a1', '# Alpha block', `/${rootId}/${alphaId}/`),
    makeBlock(betaId, rootId, 'a2', '# Beta block', `/${rootId}/${betaId}/`),
  ];
  const operations: Array<Record<string, unknown>> = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) return route.fulfill({ json: { blocks } });
    if (url.pathname === '/api/ops' && request.method() === 'POST') {
      operations.push((request.postDataJSON() as { op: Record<string, unknown> }).op);
      return route.fulfill({ json: { type: 'applied', sequence: operations.length } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/app');
  // Narrow the board scope to the Alpha subtree; Beta stays visible in the tree
  // but is outside that scope.
  await page.locator('.tree-row').filter({ hasText: 'Alpha block' }).click();
  await page.getByRole('tab', { name: /Board/ }).click();

  const column = page.locator('.column').nth(1);
  // Out-of-scope drop must be ignored: no setStatus is written for Beta.
  await page.locator('.tree-row').filter({ hasText: 'Beta block' }).dragTo(column);
  // In-scope drop still works, giving a positive control that ordering is right.
  await page.locator('.tree-row').filter({ hasText: 'Alpha block' }).dragTo(column);
  await expect.poll(() => operations).toContainEqual(expect.objectContaining({
    type: 'setStatus', id: alphaId, status: 'in_progress',
  }));
  expect(operations.filter((op) => op.type === 'setStatus' && op.id === betaId)).toHaveLength(0);
});
