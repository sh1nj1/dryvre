import { expect, test } from '@playwright/test';

test('keeps view navigation in the topbar and removes redundant chrome', async ({ page }) => {
  await page.goto('/');

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

test('inserts and edits a block from the hover affordance', async ({ page }) => {
  await page.goto('/');

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
  await page.goto('/');

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
  await page.goto('/');

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
