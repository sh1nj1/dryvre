import { expect, test } from '@playwright/test';

test('keeps view navigation in the topbar and removes redundant chrome', async ({ page }) => {
  await page.goto('/app');

  const topbar = page.locator('.topbar');
  await expect(topbar.getByRole('tablist', { name: 'View mode' })).toBeVisible();
  await expect(topbar.getByRole('tab', { name: /Document/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.view-header')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create block' })).toHaveCount(0);
  await expect(page.locator('.section-label')).toHaveText('Tree');

  await topbar.getByRole('tab', { name: /Stream/ }).click();
  await expect(page.locator('.stream-focus')).toHaveCount(0);
  await expect(page.locator('.message')).toHaveCount(3);
  await expect(page.locator('.context-chip')).toContainText('Three views, one tree');
});

test('keeps the newest stream message at the bottom after sending', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const olderId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const newerId = '00000000-0000-4000-8000-000000000001';
  const authorId = '00000000-0000-4000-8000-000000000001';
  const block = (id: string, parentId: string | null, rank: string | null, bodyMd: string, createdAt: string) => ({
    id,
    parentId,
    path: parentId ? `/${rootId}/${id}/` : `/${rootId}/`,
    rank,
    bodyMd,
    status: null,
    authorId,
    version: 0,
    createdAt,
    updatedAt: createdAt,
  });
  const root = block(rootId, null, 'a', '# Stream test', '2026-07-22T00:00:00.000Z');
  const older = block(olderId, rootId, null, 'Older message', '2026-07-22T01:00:00.000Z');
  const newer = block(newerId, rootId, null, 'Newest message', '2026-07-22T02:00:00.000Z');
  let sent = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) {
      return route.fulfill({ json: { blocks: sent ? [newer, root, older] : [older, root] } });
    }
    if (url.pathname === '/api/ops' && request.method() === 'POST') {
      sent = true;
      return route.fulfill({ json: { sequence: 1 } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/app');
  await page.getByRole('tab', { name: /Stream/ }).click();
  await expect(page.locator('.message')).toHaveCount(1);
  await page.getByPlaceholder('Write to this block').fill('Newest message');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.locator('.message')).toHaveCount(2);
  await expect(page.locator('.message').nth(0)).toContainText('Older message');
  await expect(page.locator('.message').nth(1)).toContainText('Newest message');
});

test('inserts and edits a block from the hover affordance', async ({ page }) => {
  await page.goto('/app');

  const blocks = page.locator('.doc-block');
  const initialCount = await blocks.count();
  const insert = page.getByRole('button', { name: 'Insert block after Board status interactions' });
  await expect(insert).toHaveCSS('opacity', '0');
  await insert.hover();
  await expect(insert).toHaveCSS('opacity', '1');
  await insert.click();

  const editor = page.getByRole('textbox', { name: 'Block Markdown' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('');
  await expect(blocks).toHaveCount(initialCount + 1);
  await editor.fill('A block inserted between its siblings.');
  await editor.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.doc-sheet').getByText('A block inserted between its siblings.', { exact: true })).toBeVisible();
});

test('Alt+Enter creates an empty sibling without splitting the current body', async ({ page }) => {
  await page.goto('/app');

  const originalBody = 'Document for knowledge, board for execution, stream for discussion. Switching views never changes the underlying structure.';
  const blocks = page.locator('.doc-block');
  const initialCount = await blocks.count();
  await page.locator('.doc-block').filter({ hasText: 'Three views, one tree' }).first().click();

  const editor = page.getByRole('textbox', { name: 'Block Markdown' });
  await expect(editor).toHaveValue(originalBody);
  await editor.press('Alt+Enter');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('');
  await expect(blocks).toHaveCount(initialCount + 1);
  await expect(page.getByText(originalBody, { exact: true })).toBeVisible();
});

test('uses a compact view selector and tree drawer on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');

  await expect(page.locator('.topbar .view-switcher')).toBeHidden();
  const viewSelect = page.getByRole('combobox', { name: 'View mode' });
  await expect(viewSelect).toBeVisible();
  await viewSelect.selectOption('board');
  await expect(page.locator('.board')).toBeVisible();

  const treeButton = page.getByRole('button', { name: '☰' });
  await treeButton.click();
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  await expect(page.locator('.mobile-backdrop')).toHaveClass(/show/);
});

test('renders blocked as a first-class board and search status', async ({ page }) => {
  await page.goto('/app');

  await page.getByRole('tab', { name: /Board/ }).click();
  await expect(page.locator('.column')).toHaveCount(4);
  const blockedColumn = page.locator('.column').filter({ has: page.getByText('Blocked', { exact: true }) });
  await expect(blockedColumn.getByText('Record the three-minute product story')).toBeVisible();

  await page.getByRole('button', { name: /Search & filter/ }).click();
  const statusFilter = page.getByRole('dialog').locator('.filter-field').filter({ hasText: 'Status' }).locator('select');
  await expect(statusFilter).toContainText('Blocked');
});

test('runs a ready Local Agent, focuses its result, and can cancel another run', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    const counters = window as unknown as { __dryvreActiveLiveSockets: number; __dryvreMaxLiveSockets: number };
    counters.__dryvreActiveLiveSockets = 0;
    counters.__dryvreMaxLiveSockets = 0;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) super(url);
        else super(url, protocols);
        if (String(url).includes('/api/live')) {
          counters.__dryvreActiveLiveSockets += 1;
          counters.__dryvreMaxLiveSockets = Math.max(counters.__dryvreMaxLiveSockets, counters.__dryvreActiveLiveSockets);
          let counted = true;
          const decrement = () => {
            if (!counted) return;
            counted = false;
            counters.__dryvreActiveLiveSockets -= 1;
          };
          const close = this.close.bind(this);
          this.close = (code?: number, reason?: string) => { decrement(); close(code, reason); };
          this.addEventListener('close', decrement, { once: true });
        }
      }
    };
  });
  const rootId = '00000000-0000-4000-8000-000000000010';
  const targetId = '00000000-0000-4000-8000-000000000011';
  const productId = '00000000-0000-4000-8000-000000000020';
  const qaId = '00000000-0000-4000-8000-000000000030';
  const researcherId = '00000000-0000-4000-8000-000000000050';
  const resultId = '00000000-0000-4000-8000-000000000090';
  const runId = '00000000-0000-4000-8000-000000000080';
  const createdAt = new Date('2026-07-21T00:00:00.000Z').toISOString();
  const block = (id: string, parentId: string | null, path: string, rank: string | null, bodyMd: string, authorId = '00000000-0000-4000-8000-000000000001') => ({ id, parentId, path, rank, bodyMd, status: null, authorId, version: 0, createdAt, updatedAt: createdAt });
  const blocks = [
    block(rootId, null, `/${rootId}/`, 'a', '# Dryvre'),
    block(targetId, rootId, `/${rootId}/${targetId}/`, 'a', '# Demo target'),
    block(productId, rootId, `/${rootId}/${productId}/`, 'b', '# @agent product-engineer\nImplement focused changes.'),
    block('00000000-0000-4000-8000-000000000021', productId, `/${rootId}/${productId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
    block(qaId, rootId, `/${rootId}/${qaId}/`, 'c', '# @agent qa\nVerify focused changes.'),
    block('00000000-0000-4000-8000-000000000031', qaId, `/${rootId}/${qaId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
    block(researcherId, rootId, `/${rootId}/${researcherId}/`, 'd', '# @agent researcher\nCollect evidence.'),
    block('00000000-0000-4000-8000-000000000051', researcherId, `/${rootId}/${researcherId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
  ];
  let pollCount = 0;
  let includeResult = false;
  let secondRun = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) {
      const result = includeResult ? [block(resultId, targetId, `/${rootId}/${targetId}/${resultId}/`, null, '## Demo Agent Result\n\nImplemented and verified.', '00000000-0000-4000-8000-000000000099')] : [];
      return route.fulfill({ json: { blocks: [...blocks, ...result] } });
    }
    if (url.pathname === '/api/agents/readiness') return route.fulfill({ json: { ready: true, mode: 'fake', version: 'fake' } });
    if (/^\/api\/agents\/.+\/validate$/.test(url.pathname)) return route.fulfill({ json: { valid: true, agent: { slug: 'demo' }, skills: [{ slug: 'verify-dryvre', files: 1 }, { slug: 'release-check', files: 1 }] } });
    if (url.pathname === '/api/agent-runs' && request.method() === 'POST') {
      secondRun = pollCount > 0;
      return route.fulfill({ status: 202, json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'queued', codexSessionId: null, startedAt: null, finishedAt: null, errorCode: null } });
    }
    if (url.pathname === `/api/agent-runs/${runId}` && request.method() === 'GET') {
      pollCount += 1;
      const status = secondRun ? 'running' : pollCount > 1 ? 'succeeded' : 'running';
      if (status === 'succeeded') includeResult = true;
      return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status, codexSessionId: status === 'succeeded' ? 'fake-thread' : null, startedAt: createdAt, finishedAt: status === 'succeeded' ? createdAt : null, errorCode: null } });
    }
    if (url.pathname === `/api/agent-runs/${runId}/cancel`) return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'cancelled', codexSessionId: null, startedAt: createdAt, finishedAt: createdAt, errorCode: 'cancelled' } });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/app');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dryvreMaxLiveSockets: number }).__dryvreMaxLiveSockets)).toBe(1);
  await expect(page.locator('.context-rail textarea')).toHaveCount(0);
  await page.locator('.tree-row').filter({ hasText: 'Demo target' }).click();
  await page.getByRole('tab', { name: /Stream/ }).click();
  await page.getByLabel('Send as').selectOption(productId);
  await expect(page.locator('.agent-readiness')).toContainText('Demo runner · deterministic');
  await expect(page.getByLabel('Send as').locator('option')).toHaveCount(4);
  await expect(page.locator('.agent-readiness')).toContainText('2 skills');
  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('Implement the demo flow.');
  await page.getByRole('button', { name: 'Run Agent' }).click();
  await expect(page.locator('.run-state')).toContainText('Complete');
  await expect(page.getByText('Implemented and verified.')).toBeVisible();
  await expect(page.locator('.message.result-focus')).toBeVisible();

  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('Run a cancellable check.');
  await page.getByRole('button', { name: 'Run Agent' }).click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.run-state')).toContainText('Cancelled');
});

test('recovers to Message mode when navigating from an agent to a non-target block', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const targetId = '00000000-0000-4000-8000-000000000011';
  const productId = '00000000-0000-4000-8000-000000000020';
  const createdAt = new Date('2026-07-21T00:00:00.000Z').toISOString();
  const block = (id: string, parentId: string | null, path: string, rank: string | null, bodyMd: string) => ({ id, parentId, path, rank, bodyMd, status: null, authorId: '00000000-0000-4000-8000-000000000001', version: 0, createdAt, updatedAt: createdAt });
  const blocks = [
    block(rootId, null, `/${rootId}/`, 'a', '# Dryvre'),
    block(targetId, rootId, `/${rootId}/${targetId}/`, 'a', '# Demo target'),
    block(productId, rootId, `/${rootId}/${productId}/`, 'b', '# @agent product-engineer\nImplement focused changes.'),
    block('00000000-0000-4000-8000-000000000021', productId, `/${rootId}/${productId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
  ];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/trees/${rootId}`) return route.fulfill({ json: { blocks } });
    if (url.pathname === '/api/agents/readiness') return route.fulfill({ json: { ready: true, mode: 'fake', version: 'fake' } });
    if (/^\/api\/agents\/.+\/validate$/.test(url.pathname)) return route.fulfill({ json: { valid: true, agent: { slug: 'demo' }, skills: [] } });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/');
  await page.locator('.tree-row').filter({ hasText: 'Demo target' }).click();
  await page.getByRole('tab', { name: /Stream/ }).click();
  await page.getByLabel('Send as').selectOption(productId);
  await expect(page.getByRole('button', { name: 'Run Agent' })).toBeVisible();

  // Navigating to the @agent block (not a valid agent target) must not trap the composer in Agent mode.
  await page.locator('.tree-row').filter({ hasText: '@agent product-engineer' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Agent' })).toHaveCount(0);
});

test('keeps observing an agent run after leaving the Stream view', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const targetId = '00000000-0000-4000-8000-000000000011';
  const productId = '00000000-0000-4000-8000-000000000020';
  const resultId = '00000000-0000-4000-8000-000000000090';
  const runId = '00000000-0000-4000-8000-000000000080';
  const createdAt = new Date('2026-07-21T00:00:00.000Z').toISOString();
  const block = (id: string, parentId: string | null, path: string, rank: string | null, bodyMd: string, authorId = '00000000-0000-4000-8000-000000000001') => ({ id, parentId, path, rank, bodyMd, status: null, authorId, version: 0, createdAt, updatedAt: createdAt });
  const blocks = [
    block(rootId, null, `/${rootId}/`, 'a', '# Dryvre'),
    block(targetId, rootId, `/${rootId}/${targetId}/`, 'a', '# Demo target'),
    block(productId, rootId, `/${rootId}/${productId}/`, 'b', '# @agent product-engineer\nImplement focused changes.'),
    block('00000000-0000-4000-8000-000000000021', productId, `/${rootId}/${productId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
  ];
  let pollCount = 0;
  let includeResult = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) {
      const result = includeResult ? [block(resultId, targetId, `/${rootId}/${targetId}/${resultId}/`, null, '## Demo Agent Result\n\nImplemented and verified.', '00000000-0000-4000-8000-000000000099')] : [];
      return route.fulfill({ json: { blocks: [...blocks, ...result] } });
    }
    if (url.pathname === '/api/agents/readiness') return route.fulfill({ json: { ready: true, mode: 'fake', version: 'fake' } });
    if (/^\/api\/agents\/.+\/validate$/.test(url.pathname)) return route.fulfill({ json: { valid: true, agent: { slug: 'demo' }, skills: [] } });
    if (url.pathname === '/api/agent-runs' && request.method() === 'POST') return route.fulfill({ status: 202, json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'queued', codexSessionId: null, startedAt: null, finishedAt: null, errorCode: null } });
    if (url.pathname === `/api/agent-runs/${runId}` && request.method() === 'GET') {
      pollCount += 1;
      const status = pollCount > 1 ? 'succeeded' : 'running';
      if (status === 'succeeded') includeResult = true;
      return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status, codexSessionId: status === 'succeeded' ? 'fake-thread' : null, startedAt: createdAt, finishedAt: status === 'succeeded' ? createdAt : null, errorCode: null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/');
  await page.locator('.tree-row').filter({ hasText: 'Demo target' }).click();
  await page.getByRole('tab', { name: /Stream/ }).click();
  await page.getByLabel('Send as').selectOption(productId);
  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('Implement the demo flow.');
  await page.getByRole('button', { name: 'Run Agent' }).click();

  // Leave the Stream view before the run finishes; the observer must stay mounted and still complete it.
  await page.getByRole('tab', { name: /Board/ }).click();
  await expect(page.getByText('Implemented and verified.')).toBeVisible();
  await expect(page.locator('.message.result-focus')).toBeVisible();
});

test('keeps message send and cancel available for an in-flight run off its target', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const targetId = '00000000-0000-4000-8000-000000000011';
  const productId = '00000000-0000-4000-8000-000000000020';
  const runId = '00000000-0000-4000-8000-000000000080';
  const createdAt = new Date('2026-07-21T00:00:00.000Z').toISOString();
  const block = (id: string, parentId: string | null, path: string, rank: string | null, bodyMd: string) => ({ id, parentId, path, rank, bodyMd, status: null, authorId: '00000000-0000-4000-8000-000000000001', version: 0, createdAt, updatedAt: createdAt });
  const blocks = [
    block(rootId, null, `/${rootId}/`, 'a', '# Dryvre'),
    block(targetId, rootId, `/${rootId}/${targetId}/`, 'a', '# Demo target'),
    block(productId, rootId, `/${rootId}/${productId}/`, 'b', '# @agent product-engineer\nImplement focused changes.'),
    block('00000000-0000-4000-8000-000000000021', productId, `/${rootId}/${productId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
  ];
  let cancelled = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) return route.fulfill({ json: { blocks } });
    if (url.pathname === '/api/agents/readiness') return route.fulfill({ json: { ready: true, mode: 'fake', version: 'fake' } });
    if (/^\/api\/agents\/.+\/validate$/.test(url.pathname)) return route.fulfill({ json: { valid: true, agent: { slug: 'demo' }, skills: [] } });
    if (url.pathname === '/api/agent-runs' && request.method() === 'POST') return route.fulfill({ status: 202, json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'queued', codexSessionId: null, startedAt: null, finishedAt: null, errorCode: null } });
    if (url.pathname === `/api/agent-runs/${runId}/cancel`) { cancelled = true; return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'cancelled', codexSessionId: null, startedAt: createdAt, finishedAt: createdAt, errorCode: 'cancelled' } }); }
    if (url.pathname === `/api/agent-runs/${runId}` && request.method() === 'GET') {
      const status = cancelled ? 'cancelled' : 'running';
      return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status, codexSessionId: null, startedAt: createdAt, finishedAt: cancelled ? createdAt : null, errorCode: cancelled ? 'cancelled' : null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/');
  await page.locator('.tree-row').filter({ hasText: 'Demo target' }).click();
  await page.getByRole('tab', { name: /Stream/ }).click();
  await page.getByLabel('Send as').selectOption(productId);
  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('Long running task.');
  await page.getByRole('button', { name: 'Run Agent' }).click();
  await expect(page.locator('.run-state')).toBeVisible();

  // Navigate to the @agent block (a non-target) while the run is still in flight.
  await page.locator('.tree-row').filter({ hasText: '@agent product-engineer' }).click();

  // The composer recovers to Message mode, but the in-flight run stays observable:
  // a normal message can still be sent, and the run can still be cancelled.
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await expect(sendButton).toBeVisible();
  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('A normal message.');
  await expect(sendButton).toBeEnabled();
  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  await expect(cancelButton).toHaveCount(0);
});

test('keeps the mode picker selectable during an in-flight run on a valid target', async ({ page }) => {
  const rootId = '00000000-0000-4000-8000-000000000010';
  const targetId = '00000000-0000-4000-8000-000000000011';
  const productId = '00000000-0000-4000-8000-000000000020';
  const runId = '00000000-0000-4000-8000-000000000081';
  const createdAt = new Date('2026-07-21T00:00:00.000Z').toISOString();
  const block = (id: string, parentId: string | null, path: string, rank: string | null, bodyMd: string) => ({ id, parentId, path, rank, bodyMd, status: null, authorId: '00000000-0000-4000-8000-000000000001', version: 0, createdAt, updatedAt: createdAt });
  const blocks = [
    block(rootId, null, `/${rootId}/`, 'a', '# Dryvre'),
    block(targetId, rootId, `/${rootId}/${targetId}/`, 'a', '# Demo target'),
    block(productId, rootId, `/${rootId}/${productId}/`, 'b', '# @agent product-engineer\nImplement focused changes.'),
    block('00000000-0000-4000-8000-000000000021', productId, `/${rootId}/${productId}/config/`, 'a', '```agent-config\n{"workspace":"dryvre"}\n```'),
  ];
  let cancelled = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/trees/${rootId}`) return route.fulfill({ json: { blocks } });
    if (url.pathname === '/api/agents/readiness') return route.fulfill({ json: { ready: true, mode: 'fake', version: 'fake' } });
    if (/^\/api\/agents\/.+\/validate$/.test(url.pathname)) return route.fulfill({ json: { valid: true, agent: { slug: 'demo' }, skills: [] } });
    if (url.pathname === '/api/agent-runs' && request.method() === 'POST') return route.fulfill({ status: 202, json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'queued', codexSessionId: null, startedAt: null, finishedAt: null, errorCode: null } });
    if (url.pathname === `/api/agent-runs/${runId}/cancel`) { cancelled = true; return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status: 'cancelled', codexSessionId: null, startedAt: createdAt, finishedAt: createdAt, errorCode: 'cancelled' } }); }
    if (url.pathname === `/api/agent-runs/${runId}` && request.method() === 'GET') {
      const status = cancelled ? 'cancelled' : 'running';
      return route.fulfill({ json: { id: runId, agentBlockId: productId, targetBlockId: targetId, requestedBy: '00000000-0000-4000-8000-000000000001', status, codexSessionId: null, startedAt: createdAt, finishedAt: cancelled ? createdAt : null, errorCode: cancelled ? 'cancelled' : null } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/');
  await page.locator('.tree-row').filter({ hasText: 'Demo target' }).click();
  await page.getByRole('tab', { name: /Stream/ }).click();
  await page.getByLabel('Send as').selectOption(productId);
  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('Long running task.');
  await page.getByRole('button', { name: 'Run Agent' }).click();
  await expect(page.locator('.run-state')).toBeVisible();

  // Still on the valid target: the mode picker must stay enabled so the user can drop
  // back to Message mode and send a normal stream message without cancelling the run.
  const modePicker = page.getByLabel('Send as');
  await expect(modePicker).toBeEnabled();
  await modePicker.selectOption('');
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await expect(sendButton).toBeVisible();
  await page.getByPlaceholder('Write to this block… Use @ to mention people, agents, or blocks').fill('A normal message mid-run.');
  await expect(sendButton).toBeEnabled();
  // The in-flight run stays observable and cancellable throughout.
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
});
