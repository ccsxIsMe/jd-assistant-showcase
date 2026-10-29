import { test, expect } from '@playwright/test';
test('渐进浮现首页、交互场景、工作台入口及三种宽度', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('先说清楚工作');
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({ path: 'docs/screenshots/landing-1440.png' });
  await page.getByRole('tab', { name: /03 · 人决定边界/ }).click();
  await expect(page.locator('.hero-product')).toHaveClass(/scene-2/);
  await expect(page.locator('.story-stage')).toContainText('最终决定留给你');
  await expect(page.locator('.hero-product')).toContainText('仅管理员改状态');
  for (const size of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `docs/screenshots/landing-${size.width}.png` });
  }
  await page.getByRole('link', { name: '已有岗位，完善JD' }).click();
  await expect(page.getByRole('heading', { name: '我的岗位', exact: false })).toBeVisible();
  await page.getByRole('button', { name: '从头体验' }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  expect(errors).toEqual([]);
});
test('AI配置入口不暴露密钥，固定连接测试可显示认证错误', async ({ page, request }) => {
  const config = await request.get('/api/ai/connection');
  const safe = await config.json();
  expect(safe).not.toHaveProperty('apiKey');
  expect(safe).not.toHaveProperty('DEEPSEEK_API_KEY');
  expect((await request.post('/api/ai/connection', { data: { confirm: false } })).status()).toBe(
    422,
  );
  await page.goto('/settings/ai');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('密钥留在本机');
  await expect(page.locator('.config-path')).toContainText('.env.local');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.route('**/api/ai/connection', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'AUTHENTICATION',
        message: 'DeepSeek认证失败，请检查本机配置。',
        requestId: 'test-public-id',
      }),
    }),
  );
  await page.getByRole('button', { name: '测试DeepSeek连接' }).click();
  await expect(page.locator('.connection-result')).toContainText('AUTHENTICATION');
  await expect(page.locator('.connection-result')).toContainText('认证失败');
});
test('减少动效时内容可见，不依赖动画才能操作', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    await page
      .locator('.reveal')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe('1');
  await expect(page.getByRole('link', { name: '开始规划', exact: true })).toBeEnabled();
});
