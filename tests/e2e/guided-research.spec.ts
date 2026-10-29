import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { Exploration } from '../../src/lib/exploration/model';
async function read(page: Page): Promise<Exploration> {
  return page.evaluate(async () => {
    const id = location.pathname.split('/').at(-1)!;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<Exploration>((resolve) => {
      const r = db.transaction('explorations').objectStore('explorations').get(id);
      r.onsuccess = () => resolve(r.result);
    });
  });
}
async function saved(page: Page) {
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
}
async function captureStage(page: Page, path: string) {
  await saved(page);
  await page.locator('.guided-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path, fullPage: true });
}
async function create(page: Page) {
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await page.getByRole('button', { name: '开始研究', exact: true }).click();
  await page.getByLabel('探索名称', { exact: true }).fill('五阶段协作工具研究 · 演示验收');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(page.getByRole('main', { name: '五阶段引导式研究' })).toBeVisible();
}
async function step(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: '研究阶段' })
    .getByRole('button', { name: new RegExp(label) })
    .click();
}
async function board(page: Page) {
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '查看完整证据板', exact: true })
    .click();
  await expect(page.getByTestId('evidence-board')).toBeVisible();
}
async function back(page: Page) {
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '返回引导式研究', exact: true })
    .click();
}
async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: '更多研究操作', exact: true }).click();
  await page
    .getByRole('navigation', { name: '研究操作' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function textSource(page: Page, title: string, text: string) {
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '添加资料', exact: true })
    .click();
  await page.getByLabel('资料或产品名称').fill(title);
  await page.getByLabel('想法与上下文').fill(text);
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('五阶段完整研究：真实页面资料、证据、功能编辑合并、方案选择、证据板、快照与部分导入', async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await create(page);
  await expect(page.getByTestId('evidence-board')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '整理资料', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '确认资料集合，检查证据', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('产品构想', { exact: true })
    .fill('我想做在线设计工具，用户可以一起编辑并导出成果，还不知道是否必须实时同步或招聘什么人。');
  await page.getByRole('button', { name: '保存产品构想', exact: true }).click();
  await expect(page.getByTestId('guided-source')).toHaveCount(1);
  await page.route('**/api/exploration/fetch-url', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: '演示产品页面 · 固定验收网页',
        text: 'Design Together 是本地验收资料。\n多人协作：成员可以一起编辑设计。\n文件导出：将当前作品导出为文件。\n项目列表：保存并打开设计项目。\n实时预览：查看编辑结果。\n权限边界尚需讨论。',
        normalizedUrl: 'https://example.com/guided-design',
        fetchedAt: new Date().toISOString(),
        description: '固定无敏感测试夹具，非真实在线抓取。',
        status: 'ready',
      }),
    }),
  );
  await page.getByRole('button', { name: '公开产品链接', exact: false }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/guided-design');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 500;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e1e9db';
    ctx.fillRect(0, 0, 500, 300);
    ctx.fillStyle = '#294b36';
    ctx.font = '24px sans-serif';
    ctx.fillText('Collaborate    Export', 40, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: '图片、文档或视频', exact: false }).click();
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: '参考设计界面.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await textSource(page, '当前首版说明', '第一阶段先做单人编辑和文件导出，多人实时同步尚未决定。');
  await textSource(page, '旧版范围模板', '首版必须支持多人协作；旧模板是否有效仍待确认。');
  await expect(page.getByTestId('guided-source')).toHaveCount(5);
  await expect(page.getByTestId('guided-source').filter({ hasText: '演示产品页面' })).toContainText(
    '解析完成',
  );
  await mkdir('docs/screenshots/guided', { recursive: true });
  await saved(page);
  await captureStage(page, 'docs/screenshots/guided/01-materials-1440.png');
  await page.getByRole('button', { name: '确认资料集合，检查证据', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认证据', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.guided-scroll').evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByTestId('guided-evidence')).toHaveCount(4);
  await page.getByRole('button', { name: /另外\d+组证据/ }).click();
  expect(await page.getByTestId('guided-evidence').count()).toBeGreaterThan(4);
  await page.getByRole('button', { name: '收起次要证据', exact: true }).click();
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/lab/')) calls.push(r.url().split('/').at(-1)!);
  });
  await page.getByRole('button', { name: '辅助检查跨资料关联', exact: true }).click();
  await expect(page.locator('.guided-analysis-status')).toContainText('关联证据 · 已完成');
  expect(calls).toEqual(['derive_features', 'link_evidence']);
  await expect(page.locator('.guided-conflict').first()).toContainText('一方依据');
  await expect(page.locator('.guided-conflict').first()).toContainText('另一方依据');
  await page
    .getByTestId('guided-evidence')
    .first()
    .getByRole('button', { name: '查看来源', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '原始资料与证据定位' })).toBeVisible();
  await page.keyboard.press('Escape');
  const deferredTitle = await page.getByTestId('guided-question').first().locator('h3').innerText();
  const deferredQuestion = page
    .getByTestId('guided-question')
    .filter({ has: page.getByRole('heading', { name: deferredTitle, exact: true }) });
  await deferredQuestion.getByText('依据与处理说明', { exact: true }).click();
  if (await deferredQuestion.locator('.decision-incomplete').count())
    await deferredQuestion.getByRole('button', { name: '暂缓此问题', exact: true }).click();
  else {
    await deferredQuestion.getByText('其他处理方式', { exact: true }).click();
    await deferredQuestion.getByRole('radio', { name: '暂时跳过', exact: true }).check();
    await deferredQuestion.getByRole('button', { name: '保存这个决定' }).click();
  }
  // Settled questions sort below active ones; locate the actual question rather than the new first row.
  const extraQuestions = page.locator('.guided-questions>details');
  if (await extraQuestions.count()) await extraQuestions.locator(':scope>summary').click();
  await expect(deferredQuestion).toContainText('已暂缓');
  await captureStage(page, 'docs/screenshots/guided/02-evidence-1440.png');
  await page.getByRole('button', { name: '已查看核心证据，继续整理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '整理产品需求', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.guided-scroll').evaluate((el) => el.scrollTop)).toBe(0);
  const goal = page.getByLabel('引导产品目标');
  await page.getByText('修改当前产品目标', { exact: true }).click();
  await goal.fill('先交付单人编辑与文件导出，实时协作范围留待确认');
  await board(page);
  await back(page);
  await expect(goal).toHaveValue('先交付单人编辑与文件导出，实时协作范围留待确认');
  await page.getByRole('button', { name: '保存产品目标', exact: true }).click();
  const feature = page.getByTestId('guided-feature').first();
  await feature.getByRole('button', { name: '编辑与排除', exact: true }).click();
  await page.getByLabel('节点完整描述').fill('人工编辑：先核实导出格式和交付验收，不预设技术栈。');
  await page.getByRole('button', { name: '保存节点修改', exact: true }).click();
  await expect(feature).toContainText('人工编辑');
  await feature.getByRole('button', { name: '合并', exact: true }).click();
  await page.getByLabel('被合并功能').selectOption({ index: 1 });
  await page.getByRole('button', { name: '确认合并并保留来源', exact: true }).click();
  await expect(page.getByTestId('guided-feature')).toHaveCount(2);
  await page
    .getByTestId('guided-feature')
    .last()
    .getByRole('button', { name: '编辑与排除', exact: true })
    .click();
  await page.getByRole('button', { name: '排除 / 移除这个节点…', exact: true }).click();
  await page.getByRole('button', { name: '确认排除并保留引用历史', exact: true }).click();
  await expect(page.getByTestId('guided-feature')).toHaveCount(1);
  await page
    .getByTestId('guided-feature')
    .first()
    .getByRole('button', { name: '确认功能', exact: true })
    .click();
  await captureStage(page, 'docs/screenshots/guided/03-requirements-1440.png');
  await page.getByRole('button', { name: '带着功能集合比较方案', exact: true }).click();
  await page.getByRole('button', { name: '比较岗位方案', exact: true }).click();
  await expect(page.getByTestId('guided-role-solution')).toHaveCount(2);
  await expect(page.locator('.guided-analysis-status')).toContainText('提出岗位方案 · 已完成');
  for (const plan of await page.getByTestId('guided-role-solution').all()) {
    await plan.getByRole('button', { name: '依据、假设与取舍', exact: true }).click();
    await expect(plan).toContainText('成立条件');
    await expect(plan).toContainText('优势');
    await expect(plan).toContainText('代价');
    await plan.getByRole('checkbox').check();
    await plan.getByRole('button', { name: '确认方案', exact: true }).click();
  }
  const req = page.getByTestId('guided-role-requirement').first();
  await req.getByRole('button', { name: '确认要求', exact: true }).click();
  await req.locator('.lab-requirement-title').click();
  await expect(page.locator('.lab-focus-banner')).toBeVisible();
  await expect(page.getByRole('region', { name: '当前岗位要求的证据支持' })).toBeVisible();
  await back(page);
  await expect(
    page
      .getByRole('navigation', { name: '研究阶段' })
      .getByRole('button', { name: /比较岗位方案/ }),
  ).toHaveAttribute('aria-current', 'step');
  await page
    .locator('.guided-stage:not([hidden]) .guided-import-selection')
    .getByRole('checkbox')
    .first()
    .check();
  await captureStage(page, 'docs/screenshots/guided/04-roles-1440.png');
  await page.getByRole('button', { name: '预览导出与岗位共创', exact: true }).click();
  await page.getByRole('button', { name: '仅保存研究快照', exact: true }).click();
  await expect(page.locator('.lab-message')).toContainText('快照 V1 已保存');
  await saved(page);
  let p = await read(page);
  const v1 = p.snapshots[0],
    old = JSON.stringify(v1);
  const labUrl = page.url();
  await board(page);
  await page
    .locator('.lab-focus-banner')
    .getByRole('button', { name: '显示全部', exact: true })
    .click();
  await page.getByRole('button', { name: '显示全部节点', exact: true }).click();
  await saved(page);
  p = await read(page);
  const dataBefore = JSON.stringify([p.lab!.nodes, p.lab!.edges]);
  for (let i = 0; i < 5; i++)
    await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await expect(page.locator('.lab-node.compact').first()).toBeVisible();
  await saved(page);
  expect(JSON.stringify([(await read(page)).lab!.nodes, (await read(page)).lab!.edges])).toBe(
    dataBefore,
  );
  for (let i = 0; i < 5; i++)
    await page.getByRole('button', { name: '放大画布', exact: true }).click();
  await page.getByRole('button', { name: '恢复完整视图', exact: true }).click();
  const path = page.locator('.react-flow__edge-interaction').first();
  const point = await path.evaluate((el) => {
    const line = el as SVGPathElement,
      q = line.getPointAtLength(line.getTotalLength() / 2),
      m = line.getScreenCTM()!;
    return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('dialog', { name: /关系详情/ })).toBeVisible();
  await expect
    .poll(() => page.locator('.react-flow__node.selected').count())
    .toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Escape');
  await page
    .locator('.lab-focus-banner')
    .getByRole('button', { name: '显示全部', exact: true })
    .click();
  const first = page.getByTestId('lab-node-source').first();
  await first.click();
  await page.getByRole('button', { name: '聚焦节点', exact: true }).click();
  const handle = await first.locator('.lab-node-drag-handle').boundingBox();
  await page.mouse.move(handle!.x + 40, handle!.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 90, handle!.y + 70, { steps: 6 });
  await page.mouse.up();
  await saved(page);
  const beforeAdd = await read(page);
  await textSource(page, '增量补充资料', '补充说明：先验证导出质量，再决定协作边界。');
  await saved(page);
  const afterAdd = await read(page);
  for (const n of beforeAdd.lab!.nodes)
    expect(afterAdd.lab!.nodes.find((v) => v.id === n.id)!.layoutPosition).toEqual(
      n.layoutPosition,
    );
  await menu(page, '资料与关系列表');
  await page
    .getByRole('dialog', { name: '资料与关系列表' })
    .getByRole('button', { name: /^冲突待核实/ })
    .first()
    .click();
  await page.getByRole('button', { name: '删除此关系（可撤销）', exact: true }).click();
  await page.getByRole('button', { name: '撤销上一步操作', exact: true }).click();
  await back(page);
  await expect(page.getByRole('heading', { name: '导出并继续共创', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '仅保存研究快照', exact: true }).click();
  await expect(page.locator('.lab-message')).toContainText('快照 V2 已保存');
  await saved(page);
  expect(
    JSON.stringify((await read(page)).snapshots.find((s) => s.snapshotId === v1.snapshotId)),
  ).toBe(old);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出最近快照的产品需求JSON', exact: true }).click();
  await expect(await downloaded).toBeTruthy();
  await page.getByRole('button', { name: '保存快照并预览导入', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '导入预览 · 岗位共创工作台' });
  await expect(preview.getByRole('checkbox')).toHaveCount(1);
  await expect(preview).toContainText('约束与依赖');
  await preview.getByRole('button', { name: '确认导入为待确认任务与要求', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  await expect(page.getByTestId('item-task').first()).toContainText('待确认');
  await expect(page.getByRole('region', { name: '岗位状态与下一步' })).toContainText(
    '无需重新填写',
  );
  await expect(page.getByRole('button', { name: '岗位使用引导' })).toBeVisible();
  await page.getByRole('button', { name: '岗位使用引导' }).click();
  await expect(page.getByRole('complementary', { name: '岗位六步入门' })).toContainText(
    '资料 → 任务 → 能力',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: '岗位六步入门' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '岗位使用引导' })).toBeFocused();
  await page.screenshot({ path: 'docs/screenshots/guided/06-workbench-1440.png', fullPage: true });
  await page.goto(`/lab/snapshots/${v1.snapshotId}`);
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('不可变快照 V1');
  await page.goto(labUrl);
  await expect(page.getByRole('heading', { name: '导出并继续共创', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await captureStage(page, `docs/screenshots/guided/05-handoff-${size.width}.png`);
  }
  for (const [index, label] of ['整理资料', '确认证据', '整理产品需求', '比较岗位方案'].entries()) {
    await step(page, label);
    await expect(page.locator('.guided-stepper [aria-current="step"]')).toBeInViewport();
    await expect(page.getByRole('heading', { name: label, exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await captureStage(page, `docs/screenshots/guided/0${index + 1}-mobile-390.png`);
  }
});
test('失败阶段可单独重试，视图切换保留未保存文字，取消保留已有资料', async ({ page }) => {
  await create(page);
  await page.getByLabel('产品构想', { exact: true }).fill('希望先做编辑和文件导出。');
  await page.getByRole('button', { name: '保存产品构想', exact: true }).click();
  await page.getByRole('button', { name: '确认资料集合，检查证据', exact: true }).click();
  let calls = 0;
  await page.route('**/api/lab/derive_features', (route) => {
    calls++;
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '引用不存在的证据，结果未应用',
        code: 'INVALID_EVIDENCE',
        requestId: 'safe-fixed-id',
      }),
    });
  });
  await page.getByRole('button', { name: '辅助检查跨资料关联', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('INVALID_EVIDENCE');
  await page.getByRole('button', { name: '只重试失败阶段', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await step(page, '整理资料');
  await page.getByLabel('产品构想', { exact: true }).fill('尚未保存的局部想法');
  await board(page);
  await back(page);
  await expect(page.getByLabel('产品构想', { exact: true })).toHaveValue('尚未保存的局部想法');
  await page.unroute('**/api/lab/derive_features');
  await page.route('**/api/lab/derive_features', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.abort();
  });
  await step(page, '确认证据');
  await page.getByRole('button', { name: '辅助检查跨资料关联', exact: true }).click();
  await page.getByRole('button', { name: '取消分析', exact: true }).click();
  await expect(page.locator('.guided-analysis-status')).toContainText('已取消');
  await saved(page);
  expect((await read(page)).sources).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: '确认证据', exact: true })).toBeVisible();
});

test('引导资料解析失败有诊断、可重试为新版本；重复链接和坏文件被拒绝，移除支持撤销', async ({
  page,
}) => {
  await create(page);
  let fail = true;
  await page.route('**/api/exploration/fetch-url', (route) =>
    route.fulfill({
      status: fail ? 422 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        fail
          ? {
              error: '网页需要登录，公开正文不可获取，请补充截图或文字。',
              code: 'WEB_UNAVAILABLE',
              requestId: 'guided-source-fixture',
            }
          : {
              title: '重试后可访问的演示资料',
              text: '支持文件导出。',
              normalizedUrl: 'https://example.com/guided-retry',
              fetchedAt: new Date().toISOString(),
              status: 'ready',
            },
      ),
    }),
  );
  await page.getByRole('button', { name: '公开产品链接', exact: false }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/guided-retry');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  const source = page.getByTestId('guided-source').first();
  await expect(source).toContainText('解析失败');
  await expect(source).toContainText('guided-source-fixture');
  await expect(
    page.getByRole('button', { name: '确认资料集合，检查证据', exact: true }),
  ).toBeDisabled();
  await source.getByRole('button', { name: '查看错误与重试', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('需要登录');
  fail = false;
  await page.getByRole('button', { name: '重新解析', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('支持文件导出');
  await page.keyboard.press('Escape');
  await expect(source).toContainText('解析完成');
  await expect(source).toContainText('V2');
  await page.getByRole('button', { name: '公开产品链接', exact: false }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/guided-retry');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此链接已在研究中');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '图片、文档或视频', exact: false }).click();
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not pdf'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('guided-source')).toHaveCount(1);
  await source.getByRole('button', { name: /移除研究资料/ }).click();
  await page.getByRole('button', { name: '确认移除资料', exact: true }).click();
  await expect(page.getByTestId('guided-source')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销上一步操作', exact: true }).click();
  await expect(page.getByTestId('guided-source')).toHaveCount(1);
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('guided-source')).toHaveCount(1);
});
