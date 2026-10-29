import { seedLegacyWorkbench } from '../fixtures/legacy-browser';
import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import type { Exploration } from '../../src/lib/exploration/model';
import { validateMaterial } from '../../src/lib/exploration/material';
import { Document, Packer, Paragraph } from 'docx';
async function readResearch(page: Page, id?: string): Promise<Exploration> {
  return page.evaluate(async (id) => {
    const key = id ?? location.pathname.split('/').at(-1)!;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<Exploration>((resolve) => {
      const r = db.transaction('explorations').objectStore('explorations').get(key);
      r.onsuccess = () => resolve(r.result);
    });
  }, id);
}
async function saved(page: Page) {
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
}
async function createPlan(page: Page) {
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '你希望如何探索产品需求？' })).toBeVisible();
  await page.getByRole('button', { name: '开始规划', exact: true }).click();
  await expect(page.getByRole('main', { name: 'AI帮我规划' })).toBeVisible();
  const guide = page.getByRole('complementary', { name: '研究交互教程' });
  await expect(guide).toBeVisible();
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  await guide.getByRole('button', { name: '跳过教程', exact: true }).click();
}
async function addUrl(page: Page) {
  await page.route('**/api/exploration/fetch-url', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: '演示产品页面 · 双模式固定网页',
        text: '多人协作：成员可以一起编辑设计。\n文件导出：将当前作品导出为文件。\n项目列表：保存与打开设计项目。\n这是一份固定测试资料，非真实在线抓取。',
        normalizedUrl: 'https://example.com/dual-mode-design',
        fetchedAt: new Date().toISOString(),
        description: '固定无敏感测试夹具',
        status: 'ready',
      }),
    }),
  );
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  const materials = main.locator('.planning-materials');
  if ((await materials.getAttribute('open')) === null)
    await materials.locator('summary').first().click();
  await main.getByRole('button', { name: '公开产品链接', exact: false }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/dual-mode-design');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function addImage(page: Page) {
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '添加资料', exact: true })
    .click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 440;
    c.height = 260;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e4ecdc';
    x.fillRect(0, 0, 440, 260);
    x.fillStyle = '#2f5244';
    x.font = '24px sans-serif';
    x.fillText('Collaborate     Export', 22, 75);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'design-demo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('新手双模式闭环：一句目标、多源资料、自动规划、选择与未知、资料包、工作台JD和交互教程', async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createPlan(page);
  await mkdir('docs/screenshots/dual-mode', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/dual-mode/planning-input-1440.png',
    fullPage: true,
  });
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/lab/')) calls.push(r.url().split('/').at(-1)!);
  });
  await main
    .getByLabel('规划产品目标')
    .fill('我想做一个在线设计工具，可以一起编辑并导出成果，还不清楚首版范围和需要什么岗位。');
  await main.getByText('预算与交付时间（可选）', { exact: true }).click();
  await main.getByLabel('规划预算').fill('8万元以内，仍需核实');
  await main.getByLabel('规划交付时间').fill('先在六周内验证');
  await addUrl(page);
  await addImage(page);
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '取消分析', exact: true })).toHaveCount(0);
  expect(calls).toEqual(['derive_features', 'link_evidence', 'propose_roles']);
  await saved(page);
  let p = await readResearch(page);
  expect(p.lab!.researchGuide.sourceSignature).toBeNull();
  expect(p.lab!.solutions.every((s) => s.status === 'pending')).toBe(true);
  expect(
    p.sources.find((s) => s.title === '规划约束（用户补充）')!.versions.at(-1)!.text,
  ).toContain('8万元');
  expect(p.lab!.solutions[0].productPlan!.priorityFeatureIds).not.toEqual(
    p.lab!.solutions[1].productPlan!.priorityFeatureIds,
  );
  await page.screenshot({
    path: 'docs/screenshots/dual-mode/planning-results-1440.png',
    fullPage: true,
  });
  await main.locator('.planning-proof>summary').click();
  await expect(main.getByTestId('guided-evidence').first()).toBeVisible();
  await main.getByRole('button', { name: /另外\d+组证据/ }).click();
  expect(await main.getByTestId('guided-evidence').count()).toBeGreaterThan(4);
  await main.getByRole('button', { name: '收起次要证据', exact: true }).click();
  await main.locator('.planning-proof>summary').click();
  const question = main.getByTestId('planning-question').first();
  await expect(question).toContainText('该问题的可选方案尚未生成完成');
  await question.getByRole('button', { name: '保留未知并继续规划', exact: true }).click();
  await saved(page);
  p = await readResearch(page);
  expect(p.questions.some((q) => q.response?.kind === 'uncertain' && q.status === 'open')).toBe(
    true,
  );
  expect(p.lab!.activeSolutionIds).toEqual([]);
  const scope = main
    .getByTestId('planning-question')
    .filter({ has: page.getByRole('heading', { name: '首版优先验证哪项能力？', exact: true }) });
  await scope.getByRole('radio').first().check();
  await scope.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await main
    .getByTestId('planning-solution')
    .first()
    .getByRole('button', { name: '选择此方案', exact: true })
    .click();
  const list = main.locator('.planning-package fieldset input[type=checkbox]');
  for (const c of (await list.all()).slice(1)) await c.uncheck();
  const ack = main.getByRole('checkbox', { name: /我理解上述重要冲突与未知/ });
  if (await ack.count()) await ack.check();
  await main.getByRole('button', { name: '确认方案并生成资料包', exact: true }).click();
  await expect(main.getByRole('heading', { name: '导入预览', exact: true })).toBeVisible();
  await main.getByRole('button', { name: '仅保存研究快照', exact: true }).click();
  await expect(page.locator('.lab-message')).toContainText('快照 V1');
  await saved(page);
  const labUrl = page.url(),
    snapshot = (await readResearch(page)).snapshots[0];
  const downloadPromise = page.waitForEvent('download');
  await main.getByRole('button', { name: '导出最近快照的产品需求JSON', exact: true }).click();
  const download = await downloadPromise;
  const material = validateMaterial(JSON.parse(await readFile((await download.path())!, 'utf8')));
  expect(material.roleData!.solutions[0].productPlan).toBeTruthy();
  expect(material.constraints.join('\n')).toContain('8万元');
  expect(material.openQuestions.length).toBeGreaterThan(0);
  await mkdir('docs/screenshots/dual-mode', { recursive: true });
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
    await main.evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: `docs/screenshots/dual-mode/handoff-${size.width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await main.getByRole('button', { name: '保存快照并预览导入', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '导入预览 · 岗位共创工作台' });
  await expect(preview.getByRole('checkbox')).toHaveCount(1);
  await preview.getByRole('button', { name: '确认导入为待确认任务与要求', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  const tour = page.getByRole('complementary', { name: '岗位交互教程' });
  await expect(tour).toBeVisible();
  expect(
    await page.locator('.source-tile').evaluateAll((tiles) =>
      tiles.every((tile) => {
        const bottom = tile.getBoundingClientRect().bottom;
        return [...tile.querySelectorAll('strong,small')].every(
          (text) => text.getBoundingClientRect().bottom <= bottom,
        );
      }),
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'docs/screenshots/dual-mode/workbench-tutorial-1440.png',
    fullPage: true,
  });
  await expect(page.getByTestId('item-task').first()).toContainText('待确认');
  for (const task of await page.getByTestId('item-task').all())
    await task.getByRole('button', { name: '确认', exact: true }).click();
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('tab', { name: '岗位要求', exact: false })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const req of await page.getByTestId('item-requirement').all())
    await req.getByRole('button', { name: '确认', exact: true }).click();
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '生成 JD 草稿', exact: true }).click();
  await expect(page.getByTestId('jd-block').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: '岗位交互教程' })).toBeVisible();
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await page
    .getByTestId('jd-block')
    .filter({ has: page.getByRole('heading', { name: '主要职责', exact: true }) })
    .click();
  await page.getByLabel('这一次，你想调整什么？').fill('精简内容，保留已确认的岗位事实。');
  await page.getByRole('button', { name: '生成局部修改建议', exact: true }).click();
  await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
  await page
    .getByTestId('suggestion-card')
    .first()
    .getByRole('button', { name: '应用本条', exact: true })
    .click();
  await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '导出JD', exact: true }).click();
  const jdPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载Markdown', exact: true }).click();
  const jd = await jdPromise;
  expect(await readFile((await jd.path())!, 'utf8')).toContain('非真实AI分析');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: '完成教程', exact: true }).click();
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.goto(`/lab/snapshots/${snapshot.snapshotId}`);
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await page.goto(labUrl);
  await expect(page.getByRole('main', { name: 'AI帮我规划' })).toBeVisible();
});
test('规划阶段失败只重试依赖，空输入与短输入有具体反馈，模式切换不触发模型', async ({ page }) => {
  await createPlan(page);
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('一句产品目标');
  await main.getByLabel('规划产品目标').fill('你好');
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('目标太短');
  await main
    .getByLabel('规划产品目标')
    .fill('希望做一个可编辑内容并导出成果的工具，先验证最小范围。');
  let failed = false;
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/lab/')) calls.push(r.url().split('/').at(-1)!);
  });
  await page.route('**/api/lab/link_evidence', (r) => {
    if (!failed) {
      failed = true;
      return r.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: '固定引用失败，已完成内容保留',
          code: 'INVALID_REFERENCE',
          requestId: 'fixed-plan-fail',
        }),
      });
    }
    return r.continue();
  });
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('fixed-plan-fail');
  expect(calls).toEqual(['derive_features', 'link_evidence']);
  await main.getByRole('button', { name: '继续未完成的规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution').first()).toBeVisible();
  expect(calls).toEqual(['derive_features', 'link_evidence', 'link_evidence', 'propose_roles']);
  await saved(page);
  const before = await readResearch(page);
  await page.getByLabel('研究方式', { exact: true }).selectOption('collaborate');
  await expect(page.getByRole('main', { name: '五阶段引导式研究' })).toBeVisible();
  await page
    .getByRole('navigation', { name: '研究阶段' })
    .getByRole('button', { name: /整理产品需求/ })
    .click();
  const feature = page.getByTestId('guided-feature').first();
  await feature.getByRole('button', { name: '编辑与排除', exact: true }).click();
  await page.getByLabel('节点完整描述').fill('人工边界：只验证可编辑的单人流程与导出质量。');
  await page.getByRole('button', { name: '保存节点修改', exact: true }).click();
  await page.getByText('修改当前产品目标', { exact: true }).click();
  await page.getByLabel('引导产品目标').fill('共同研究里尚未保存的目标草稿');
  await page.getByLabel('研究方式', { exact: true }).selectOption('plan');
  await expect(main).toContainText('先看方向');
  await page.getByLabel('研究方式', { exact: true }).selectOption('collaborate');
  await expect(page.getByLabel('引导产品目标')).toHaveValue('共同研究里尚未保存的目标草稿');
  await page.getByLabel('研究方式', { exact: true }).selectOption('plan');
  await saved(page);
  const after = await readResearch(page);
  expect(after.sources).toEqual(before.sources);
  expect(after.findings[0].description).toContain('人工边界');
  expect(after.lab!.nodes.map((n) => n.layoutPosition)).toEqual(
    before.lab!.nodes.map((n) => n.layoutPosition),
  );
  expect(calls).toHaveLength(4);
  await page.reload();
  await expect(page.getByLabel('研究方式', { exact: true })).toHaveValue('plan');
});

test('只有公开网址也可规划，无需填写岗位或技术栈', async ({ page }) => {
  await createPlan(page);
  await addUrl(page);
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await expect(main.getByLabel('规划产品目标')).toHaveValue('');
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution')).toHaveCount(2);
  await saved(page);
  const p = await readResearch(page);
  expect(p.initialObjective).toBeUndefined();
  expect(p.lab!.runs.filter((r) => r.status === 'failed')).toEqual([]);
  expect(p.lab!.solutions.every((s) => s.status === 'pending')).toBe(true);
});

test('纯图片明确提示画面证据尚未核对；补充DOCX文字后可直接规划', async ({ page }) => {
  await createPlan(page);
  await addImage(page);
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('尚无已核对的画面证据');
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '添加资料', exact: true })
    .click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  const doc = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph(
              '演示需求：我希望用户能够编辑设计并将成果导出为文件，人员与技术方案尚未明确。',
            ),
          ],
        },
      ],
    }),
  );
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'planning-example.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: doc,
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution').first()).toBeVisible();
  await saved(page);
  const p = await readResearch(page);
  expect(p.sources.find((s) => s.kind === 'document')!.versions.at(-1)!.text).toContain('导出');
  expect(p.lab!.solutions.every((s) => s.status === 'pending')).toBe(true);
});

test('真实控件教程可退出、继续、重演及跳过；不存在目标时不画空框', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await seedLegacyWorkbench(page);
  const tour = page.getByRole('complementary', { name: '岗位交互教程' });
  await expect(tour).toBeVisible();
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  await expect(tour.getByRole('heading')).toContainText('确认实际工作');
  await tour.getByRole('button', { name: '本步稍后处理', exact: true }).click();
  await expect(page.getByRole('tab', { name: '岗位要求', exact: false })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  await tour.getByRole('button', { name: '退出教程', exact: true }).click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: '岗位使用引导', exact: true }).click();
  await page.getByRole('button', { name: '继续交互教程', exact: true }).click();
  await expect(tour.getByRole('heading')).toContainText('区分必要');
  await tour.getByRole('button', { name: '退出教程', exact: true }).click();
  await page.getByRole('button', { name: '岗位使用引导', exact: true }).click();
  await page.getByRole('button', { name: '重新演示教程', exact: true }).click();
  await expect(tour.getByRole('heading')).toContainText('从真实资料开始');
  await expect(page.getByTestId('tutorial-highlight')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/dual-mode/tutorial-390.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tour.getByRole('button', { name: '跳过教程', exact: true }).click();
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: '从资料整理', exact: true }).click();
  await page.getByRole('button', { name: '任务 / JD', exact: true }).click();
  await page.getByRole('tab', { name: '岗位任务', exact: false }).click();
  await expect(page.getByTestId('item-task')).toHaveCount(3);
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await page.getByRole('button', { name: '开始规划', exact: true }).click();
  const labTour = page.getByRole('complementary', { name: '研究交互教程' });
  await labTour.getByRole('button', { name: '本步稍后处理', exact: true }).click();
  await labTour.getByRole('button', { name: '本步稍后处理', exact: true }).click();
  await expect(labTour).toContainText('暂无可核对证据');
  await expect(page.getByTestId('tutorial-highlight')).toHaveCount(0);
  await labTour.getByRole('button', { name: '跳过教程', exact: true }).click();
});
