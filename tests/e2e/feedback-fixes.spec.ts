import { test, expect, type Page } from '@playwright/test';
async function skip(page: Page) {
  const b = page.getByRole('button', { name: '跳过教程', exact: true });
  await b
    .first()
    .waitFor({ state: 'visible', timeout: 1800 })
    .catch(() => {});
  if (await b.first().isVisible()) {
    await b.first().click();
    await expect(page.locator('.interactive-guide-card')).toHaveCount(0);
  }
}
test('角色设计规划展示具体能力；折叠证据教程定位到真实可见控件', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await page.getByRole('button', { name: '开始规划', exact: true }).click();
  const tour = page.getByRole('complementary', { name: '研究交互教程' }),
    main = page.getByRole('main', { name: 'AI帮我规划' });
  await expect(tour).toContainText('操作教程');
  await expect(tour.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  await main
    .getByLabel('规划产品目标')
    .fill('我想做一个游戏角色设计，还不确定需要2D原画还是3D角色。');
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution')).toHaveCount(2);
  await expect(main.locator('.planning-capabilities').first()).toContainText('Photoshop');
  await expect(main.locator('.planning-capabilities').first()).toContainText('绘画与造型基本功');
  await expect(main.locator('.planning-capabilities').first()).toContainText('3D辅助');
  await expect(main.locator('.planning-analysis-mode')).toContainText('不是本次真实AI');
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(tour.getByRole('heading')).toContainText('结论来自哪里');
  const source = main.locator('[data-tour="lab-evidence"]').first();
  await expect(source).toBeVisible();
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  const box = await source.boundingBox(),
    highlight = await page.getByTestId('tutorial-highlight').boundingBox();
  expect(Math.abs(box!.x - highlight!.x - 5)).toBeLessThan(3);
  expect(Math.abs(box!.y - highlight!.y - 5)).toBeLessThan(3);
  await main.locator('.planning-proof summary').first().click();
  await expect(source).not.toBeVisible();
  await expect(page.getByTestId('tutorial-highlight')).toHaveCount(0);
  await expect(tour.getByRole('button', { name: '定位本步控件', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: '定位本步控件', exact: true }).click();
  await expect(source).toBeVisible();
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/feedback/character-tutorial.png',
    fullPage: true,
  });
});
test('新岗位遵循本机真实配置；手动模式清楚解释，不再发送订单预置请求', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '创建岗位', exact: true }).first().click();
  await page.getByLabel('岗位名称', { exact: true }).fill('自定义软件工程师');
  await page.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  const tour = page.getByRole('complementary', { name: '岗位交互教程' });
  await expect(tour).toContainText('操作教程');
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(tour.getByRole('heading')).toContainText('确认实际工作');
  await skip(page);
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByLabel('资料标题', { exact: true }).fill('软件交付说明');
  await page
    .getByLabel('原文（保存后通过新版本修订）', { exact: true })
    .fill('负责问题列表与状态流转页面的实现、接口联调和测试。');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/workbench')) requests++;
  });
  await page.getByRole('button', { name: '从资料整理', exact: true }).click();
  await expect(page.locator('.center-ai-error')).toContainText('没有这份岗位的预置AI答案');
  expect(requests).toBe(0);
  await page.getByRole('button', { name: '切换为真实AI', exact: true }).click();
  expect(requests).toBe(0);
  await expect(page.getByRole('button', { name: '切换AI协作方式' })).toContainText('真实AI模式');
  await page.route('**/api/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'real' }),
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '创建岗位', exact: true }).first().click();
  await page.getByLabel('岗位名称', { exact: true }).fill('按真实配置创建的新岗位');
  await page.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换AI协作方式' })).toContainText('真实AI模式');
  expect(requests).toBe(0);
});
test('深色工作区文字对比度、动作按钮边框、全页动效与减少动态效果', async ({ page }) => {
  await page.goto('/examples');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.demo-hub')).toHaveCSS('animation-name', 'task-surface-enter');
  await page
    .locator('.demo-module-grid section')
    .filter({ has: page.getByRole('heading', { name: '岗位共创与JD', exact: true }) })
    .getByRole('button', { name: '查看完成版', exact: true })
    .click();
  await skip(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const colors = await page.locator('.workspace-topbar').evaluate((header) => {
    const parse = (s: string) =>
        s
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number),
      lum = (c: number[]) =>
        c
          .map((x) => {
            const n = x / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          })
          .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0),
      background = (element: HTMLElement) => {
        for (let p: HTMLElement | null = element; p; p = p.parentElement) {
          const color = getComputedStyle(p).backgroundColor,
            channels = color.match(/[\d.]+/g)!.map(Number);
          if (channels.length === 3 || channels[3] > 0) return lum(parse(color));
        }
        return 1;
      };
    return Array.from(
      header.querySelectorAll<HTMLElement>(
        '.workspace-title,.save-indicator,.top-action,.mode-pill,[data-slot="button"]',
      ),
    )
      .filter((e) => e.getClientRects().length)
      .map((e) => ({
        text: e.innerText,
        color: getComputedStyle(e).color,
        contrast:
          (Math.max(lum(parse(getComputedStyle(e).color)), background(e)) + 0.05) /
          (Math.min(lum(parse(getComputedStyle(e).color)), background(e)) + 0.05),
      }));
  });
  for (const c of colors) expect(c.contrast, `${c.text}: ${c.color}`).toBeGreaterThan(4.5);
  await expect(page.locator('.workspace-topbar .top-action').first()).toHaveCSS(
    'border-top-width',
    '1px',
  );
  await page.screenshot({
    path: 'docs/screenshots/feedback/workbench-dark-1280.png',
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/examples');
  await expect(page.locator('.demo-hub')).toHaveCSS('animation-name', 'none');
});
