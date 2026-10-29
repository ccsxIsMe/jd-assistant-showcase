import { test, expect } from '@playwright/test';
test('模式选择和实际证据详情四种视口截图', async ({ page }) => {
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '你希望如何探索产品需求？', exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `docs/screenshots/polish-after/mode-chooser-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/examples');
  await page
    .locator('.demo-module-grid section')
    .filter({ has: page.getByRole('heading', { name: '完整证据板', exact: true }) })
    .getByRole('button', { name: '查看完成版', exact: true })
    .click();
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await page.getByRole('button', { name: '更多研究操作', exact: true }).click();
  await page
    .getByRole('navigation', { name: '研究操作' })
    .getByRole('button', { name: '资料与关系列表', exact: true })
    .click();
  const source = page
    .getByRole('dialog', { name: '资料与关系列表' })
    .locator('article')
    .filter({ hasText: '权限说明A · 当前首版' });
  await source.getByRole('button', { name: '查看原文', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '原始资料与证据定位', exact: true })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `docs/screenshots/polish-after/evidence-detail-${width}.png`,
      fullPage: true,
    });
  }
});
