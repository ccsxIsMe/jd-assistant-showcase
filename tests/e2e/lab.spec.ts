import { seedLegacyLab } from '../fixtures/legacy-browser';
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Document, Packer, Paragraph } from 'docx';
import { type Exploration } from '../../src/lib/exploration/model';
import { validateMaterial } from '../../src/lib/exploration/material';
async function demo(page: Page) {
  await page.goto('/lab');
  await seedLegacyLab(page);
  await expect(page).toHaveURL(/\/lab\/[^/]+$/);
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '查看完整证据板', exact: true })
    .click();
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await expect(page.getByRole('status').first()).toContainText('已保存');
}
async function row(page: Page): Promise<Exploration> {
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
async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: '更多研究操作', exact: true }).click();
  await page
    .getByRole('navigation', { name: '研究操作' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function index(page: Page) {
  await menu(page, '资料与关系列表');
  return page.getByRole('dialog', { name: '资料与关系列表' });
}
async function analyze(page: Page) {
  await page.getByRole('button', { name: '关联分析', exact: true }).click();
  await expect(page.getByTestId('role-solution')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '关联分析', exact: true })).toBeEnabled();
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
}
test('关联问题引用错误展示具体字段和编号，保留成功阶段、记录和单阶段重试', async ({ page }) => {
  await demo(page);
  let attempts = 0;
  await page.route('**/api/lab/link_evidence', (route) => {
    attempts++;
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '本阶段结果未通过校验；已有成功阶段保留。',
        code: 'INVALID_REFERENCE',
        requestId: 'fixed-reference-test',
        validationIssues: [
          {
            code: 'UNKNOWN_FINDING_REFERENCE',
            path: 'questions[0].findingIds[0]',
            message: '问题只能引用本次analysis.confirmedFindings[].id；不能使用图谱节点ID。',
          },
        ],
      }),
    });
  });
  await page.getByRole('button', { name: '关联分析', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('questions[0].findingIds[0]');
  await expect(page.locator('.lab-message.error')).toContainText('fixed-reference-test');
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  const p = await row(page);
  expect(p.lab!.runs.find((r) => r.stage === 'derive_features')!.status).toBe('succeeded');
  expect(p.lab!.runs.at(-1)).toMatchObject({
    stage: 'link_evidence',
    status: 'failed',
    errorCode: 'INVALID_REFERENCE',
    requestId: 'fixed-reference-test',
  });
  expect(p.sources.length).toBeGreaterThan(0);
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '返回引导式研究', exact: true })
    .click();
  await page.getByRole('button', { name: '只重试失败阶段', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.locator('.lab-message.error')).toContainText('questions[0].findingIds[0]');
});
test('完整证据板闭环：资料解析、关联、标注、撤销、快照、部分导入及上游保护', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await demo(page);
  // All actions start at real page controls. Fixtures intercept only the external webpage boundary.
  await page.route('**/api/exploration/fetch-url', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: '本地验收网页（演示来源）',
        text: '文件导出帮助团队交付成果。\n参考产品提供多人协作。',
        normalizedUrl: 'https://example.com/lab-fixture',
        fetchedAt: new Date().toISOString(),
        description: '固定无敏感测试夹具',
        status: 'ready',
      }),
    }),
  );
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('button', { name: '参考产品网址', exact: true }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/lab-fixture');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const uploadedPNG = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e3ece0';
    ctx.fillRect(0, 0, 400, 240);
    ctx.fillStyle = '#294938';
    ctx.font = '20px sans-serif';
    ctx.fillText('Export · synthetic screenshot', 20, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: '额外上传的演示截图.png',
    mimeType: 'image/png',
    buffer: Buffer.from(uploadedPNG, 'base64'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  const doc = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph('Example delivery: export design files. Technology stack is undecided.'),
          ],
        },
      ],
    }),
  );
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'example-requirements.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: doc,
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await analyze(page);
  await page.screenshot({ path: 'docs/screenshots/lab/initial-board-1440.png', fullPage: true });
  await expect(page.locator('.lab-message.error')).toHaveCount(0);
  let p = await row(page);
  expect(p.sources).toHaveLength(8);
  expect(
    p.lab!.runs.filter((r) => r.status === 'succeeded' || r.status === 'partial'),
  ).toHaveLength(5);
  expect(p.lab!.edges.some((e) => e.strengthClass === 'strong')).toBe(true);
  expect(p.lab!.edges.some((e) => e.strengthClass === 'conflict')).toBe(true);
  // Input node expands embedded evidence without recreating its neighbours.
  const first = page.getByTestId('lab-node-source').first();
  await info.attach('board-geometry.json', {
    body: JSON.stringify(
      {
        viewport: p.lab!.ui.viewport,
        positions: p.lab!.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.layoutPosition,
        })),
        dom: await page.locator('.react-flow__node').evaluateAll((nodes) =>
          nodes.map((node) => ({
            id: node.getAttribute('data-id'),
            style: node.getAttribute('style'),
          })),
        ),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: /^展开/ }).click();
  await expect(first.locator('.lab-inline-evidence-list')).toBeVisible();
  await first.locator('.lab-inline-evidence-list button').first().click();
  await expect(page.getByRole('dialog', { name: '原始资料与证据定位' })).toBeVisible();
  await page.keyboard.press('Escape');
  let list = await index(page);
  await list
    .locator('.lab-history-row')
    .filter({ hasText: '演示设计工具界面' })
    .getByRole('button', { name: '区域标注', exact: true })
    .click();
  let dialog = page.getByRole('dialog', { name: /区域标注 ·/ });
  await expect(dialog).toContainText('上传文件不会自动识图');
  await expect(dialog.getByTestId('annotation-box')).toHaveCount(3);
  const moving = dialog.getByTestId('annotation-box').nth(1),
    movingBox = await moving.boundingBox();
  await page.mouse.move(movingBox!.x + 20, movingBox!.y + 12);
  await page.mouse.down();
  await page.mouse.move(movingBox!.x + 5, movingBox!.y + 20, { steps: 4 });
  await page.mouse.up();
  await moving.click();
  const beforeWidth = Number(await dialog.getByLabel('标注width', { exact: true }).inputValue());
  const handle = await moving.locator('i[data-resize]').boundingBox();
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 10, handle!.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await dialog.getByLabel('标注width', { exact: true }).inputValue()))
    .not.toBe(beforeWidth);
  await dialog.locator('.lab-annotation-list button').first().click();
  await dialog.getByRole('button', { name: '接受此标注', exact: true }).click();
  await expect(dialog.getByTestId('annotation-box').first()).toHaveAttribute(
    'data-status',
    'accepted',
  );
  await dialog.locator('.lab-annotation-list button').nth(1).click();
  await dialog.getByLabel('标注x', { exact: true }).fill('0.72');
  await dialog.getByRole('button', { name: '保存标注调整', exact: true }).click();
  await dialog.getByRole('button', { name: '提取图像文字与标注候选', exact: true }).click();
  await expect(
    dialog.getByText('演示数据，非真实AI分析 · lab.extract_image_evidence@1.0.0', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByTestId('annotation-box')).toHaveCount(3);
  await page.screenshot({ path: 'docs/screenshots/lab/annotations.png', fullPage: true });
  await page.keyboard.press('Escape');
  list = await index(page);
  await list
    .getByRole('button', { name: /^冲突待核实/ })
    .first()
    .click();
  dialog = page.getByRole('dialog', { name: /关系详情/ });
  await expect(dialog.getByRole('heading', { name: '一方依据', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '另一方依据', exact: true })).toBeVisible();
  await expect(dialog.locator('.lab-proof')).toHaveCount(2);
  await dialog.getByRole('button', { name: '删除此关系（可撤销）', exact: true }).click();
  await page.getByRole('button', { name: '撤销上一步操作', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await row(page)).lab!.edges.filter(
          (e) => e.relationType === 'conflicts_with' && e.status !== 'deleted',
        ).length,
    )
    .toBeGreaterThan(0);
  list = await index(page);
  await list
    .getByRole('button', { name: /^弱关联/ })
    .first()
    .click();
  dialog = page.getByRole('dialog', { name: /关系详情/ });
  await dialog.getByLabel('关系类型修改').selectOption('depends_on');
  await dialog.getByRole('button', { name: '保存关系类型（可撤销）', exact: true }).click();
  await page.getByRole('button', { name: '撤销上一步操作', exact: true }).click();
  await page.getByRole('button', { name: '确认方案', exact: true }).first().click();
  await page.getByTestId('role-solution').first().getByRole('checkbox').check();
  await expect(page.getByTestId('role-requirement').first()).toBeVisible();
  const req = page.getByTestId('role-requirement').first();
  await req.getByRole('button', { name: '编辑', exact: true }).click();
  dialog = page.getByRole('dialog', { name: /岗位要求 ·/ });
  await dialog.getByLabel('节点完整描述').fill('人工修订：验证文件导出的交付边界。');
  await dialog.getByRole('button', { name: '保存节点修改', exact: true }).click();
  await req.getByRole('button', { name: '确认要求', exact: true }).click();
  await req.locator('.lab-requirement-title').click();
  await expect(page.locator('.lab-focus-banner')).toBeVisible();
  await page
    .locator('.lab-focus-banner')
    .getByRole('button', { name: '显示全部', exact: true })
    .click();
  await expect(page.getByRole('status').first()).toContainText('已保存');
  await page.screenshot({ path: info.outputPath('evidence-board-1440.png'), fullPage: true });
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
    if (size.width === 390) {
      await page.getByRole('button', { name: '收起岗位面板', exact: true }).click();
      await expect(page.getByTestId('evidence-board')).toBeVisible();
    }
    await page.screenshot({ path: `docs/screenshots/lab/board-${size.width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '展开岗位面板', exact: true }).click();
  await menu(page, '保存快照');
  await expect(page.locator('.lab-message')).toContainText('快照 V1 已保存');
  p = await row(page);
  const v1 = p.snapshots[0],
    original = JSON.stringify(v1.research!.lab);
  const currentUrl = page.url();
  await page.getByLabel('研究标题', { exact: true }).fill('继续研究后的第二版本');
  await menu(page, '保存快照');
  await expect(page.locator('.lab-message')).toContainText('快照 V2 已保存');
  await page.goto(`/lab/snapshots/${v1.snapshotId}`);
  await expect(page.getByLabel('研究标题', { exact: true })).toHaveValue(v1.title);
  await expect(page.getByRole('status').first()).toContainText('不可变快照 V1');
  await page.screenshot({ path: info.outputPath('snapshot-v1.png'), fullPage: true });
  await page.goto(currentUrl);
  await expect(page.getByLabel('研究标题', { exact: true })).toHaveValue('继续研究后的第二版本');
  p = await row(page);
  expect(
    JSON.stringify(p.snapshots.find((s) => s.snapshotId === v1.snapshotId)!.research!.lab),
  ).toBe(original);
  const downloadPromise = page.waitForEvent('download');
  await menu(page, '导出产品需求JSON');
  const downloaded = await downloadPromise;
  const stream = await downloaded.createReadStream();
  let raw = '';
  for await (const part of stream!) raw += part.toString();
  expect(validateMaterial(JSON.parse(raw)).roleData).toBeDefined();
  expect(raw).toContain('"mode": "example"');
  const bundleDownload = page.waitForEvent('download');
  await menu(page, '导出完整研究包');
  const bundleStream = await (await bundleDownload).createReadStream();
  let bundle = '';
  for await (const chunk of bundleStream!) bundle += chunk.toString();
  expect(bundle).toContain('演示数据，非真实AI分析');
  const importedPage = await page.context().newPage();
  await importedPage.goto('/lab');
  await importedPage.getByLabel('导入探索项目或快照', { exact: true }).setInputFiles({
    name: '完整研究包.json',
    mimeType: 'application/json',
    buffer: Buffer.from(bundle),
  });
  await expect(importedPage).toHaveURL(/\/lab\/[^/]+$/);
  await expect(importedPage.getByLabel('研究标题')).toHaveValue(/导入副本$/);
  await expect(importedPage.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  const imported = await row(importedPage);
  expect(imported.id).not.toBe(p.id);
  expect(imported.lab!.annotations).toHaveLength(3);
  expect(imported.lab!.nodes.map((n) => n.layoutPosition)).toEqual(
    p.lab!.nodes.map((n) => n.layoutPosition),
  );
  const importedList = await index(importedPage);
  await importedList
    .locator('.lab-history-row')
    .filter({ hasText: '演示设计工具界面' })
    .getByRole('button', { name: '区域标注', exact: true })
    .click();
  await expect(
    importedPage.getByRole('dialog', { name: /区域标注 ·/ }).getByRole('img'),
  ).toBeVisible();
  await expect(importedPage.getByTestId('annotation-box')).toHaveCount(3);
  await importedPage.close();
  await page.getByRole('button', { name: '预览并导入岗位工作台 →', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '导入预览 · 岗位共创工作台' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('button', { name: '确认导入为待确认任务与要求', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  await expect(page.getByTestId('item-task').first()).toBeVisible();
  await expect(page.getByTestId('item-task').first()).toContainText('待确认');
  const workspaceURL = page.url(),
    preserved = await page.getByTestId('item-task').first().textContent();
  await page.goto(currentUrl);
  const beforeUpdate = await row(page);
  await page
    .getByTestId('lab-node-feature')
    .first()
    .getByRole('button', { name: /查看详情/ })
    .click();
  dialog = page.getByRole('dialog', { name: /产品功能 ·/ });
  await dialog.getByLabel('节点完整描述').fill('后续版本修改：先明确导出范围与实际验收格式。');
  await dialog.getByRole('button', { name: '保存节点修改', exact: true }).click();
  await menu(page, '保存快照');
  await expect(page.locator('.lab-message')).toContainText(
    `快照 V${beforeUpdate.snapshots[0].version + 1} 已保存`,
  );
  await page.goto(workspaceURL);
  await page.getByRole('button', { name: '检查上游更新', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '产品研究来源与上游更新' })).toContainText(
    '仅显示差异',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('item-task').first()).toHaveText(preserved!);
  expect(errors).toEqual([]);
});
test('需求实验室的新建引导、空输入、重复链接和不支持文件有实际反馈', async ({ page }) => {
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await page.getByRole('button', { name: '开始研究', exact: true }).click();
  await page.getByLabel('探索名称', { exact: true }).fill('空白研究边界验收');
  await page.getByRole('button', { name: '开始探索', exact: true }).click();
  await expect(page.getByRole('main', { name: '五阶段引导式研究' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '研究阶段' }).getByRole('button', { name: /整理资料/ }),
  ).toHaveAttribute('aria-current', 'step');
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '查看完整证据板', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '关联分析', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'old.doc',
    mimeType: 'application/msword',
    buffer: Buffer.from('unsupported'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/不支持|仅支持/);
  await page.keyboard.press('Escape');
  await page.route('**/api/exploration/fetch-url', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '该页面需要登录或拒绝访问，请粘贴截图或正文',
        code: 'WEB_UNAVAILABLE',
        requestId: 'safe-public-fixture',
      }),
    }),
  );
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('button', { name: '参考产品网址', exact: true }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/restricted');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  const listing = await index(page);
  await expect(listing).toContainText('解析失败');
  await expect(listing).toContainText('需要登录');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('button', { name: '参考产品网址', exact: true }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com/restricted');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此链接已在研究中');
});
test('保存失败不会伪造成功，重试保留当前编辑；面板键盘与减少动效有效', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === 'explorations' &&
        (globalThis as typeof globalThis & { labFailSave?: boolean }).labFailSave
      )
        throw new DOMException('固定测试存储失败', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await demo(page);
  const separator = page.getByRole('separator', { name: '调整岗位面板宽度' });
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '380');
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { labFailSave?: boolean }).labFailSave = true;
  });
  await page.getByLabel('研究标题').fill('存储失败仍在内存中的编辑');
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('保存失败');
  await menu(page, '保存快照');
  await expect(page.locator('.lab-message.error')).toBeVisible();
  await expect(page.getByLabel('研究标题')).toHaveValue('存储失败仍在内存中的编辑');
  expect((await row(page)).snapshots).toHaveLength(0);
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { labFailSave?: boolean }).labFailSave = false;
  });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  await page.reload();
  await expect(page.getByLabel('研究标题')).toHaveValue('存储失败仍在内存中的编辑');
  expect(
    await page
      .getByTestId('lab-node-source')
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe('none');
});
test('关闭并重新打开实际Edge持久化配置后，研究草稿和布局仍可恢复', async ({ playwright }, info) => {
  test.setTimeout(60000);
  await mkdir(info.outputDir, { recursive: true });
  const dir = await mkdtemp(path.join(info.outputDir, 'edge-profile-'));
  let context = await playwright.chromium.launchPersistentContext(dir, {
    channel: 'msedge',
    headless: true,
  });
  let page = await context.newPage();
  await page.goto(`${info.project.use.baseURL}/lab`);
  await seedLegacyLab(page);
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '查看完整证据板', exact: true })
    .click();
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await page.getByLabel('研究标题').fill('实际浏览器关闭后恢复的草稿');
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  const url = page.url(),
    before = await row(page);
  await context.close();
  context = await playwright.chromium.launchPersistentContext(dir, {
    channel: 'msedge',
    headless: true,
  });
  page = await context.newPage();
  await page.goto(url);
  await expect(page.getByLabel('研究标题')).toHaveValue('实际浏览器关闭后恢复的草稿');
  expect((await row(page)).lab!.nodes.map((n) => n.layoutPosition)).toEqual(
    before.lab!.nodes.map((n) => n.layoutPosition),
  );
  await context.close();
});
test('阶段失败与取消保留人工编辑，不把非法输出标为成功', async ({ page }) => {
  await demo(page);
  await page.getByLabel('研究标题', { exact: true }).fill('失败时保留的人工标题');
  await page.route('**/api/lab/derive_features', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '引用校验失败，原数据保留',
        code: 'INVALID_EVIDENCE',
        requestId: 'fixed-safe-test',
      }),
    }),
  );
  await page.getByRole('button', { name: '关联分析', exact: true }).click();
  await expect(page.locator('.lab-message.error')).toContainText('INVALID_EVIDENCE');
  await expect(page.getByLabel('研究标题')).toHaveValue('失败时保留的人工标题');
  await page.unroute('**/api/lab/derive_features');
  await page.route('**/api/lab/derive_features', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.abort();
  });
  await page.getByRole('button', { name: '关联分析', exact: true }).click();
  await page.getByRole('button', { name: '取消分析', exact: true }).click();
  await expect(page.getByRole('button', { name: '关联分析', exact: true })).toBeEnabled();
  await expect.poll(async () => (await row(page)).lab!.runs.at(-1)?.status).toBe('cancelled');
  await page.reload();
  await expect(page.getByLabel('研究标题')).toHaveValue('失败时保留的人工标题');
});
