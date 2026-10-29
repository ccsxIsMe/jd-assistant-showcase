import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import type { Exploration } from '../../src/lib/exploration/model';
import type { Workspace } from '../../src/lib/workbench/model';
test.beforeEach(async ({ page }) => page.setDefaultTimeout(12000));
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('read failed'));
    });
    const read = (name: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(new Error('read failed'));
      });
    const [projects, workspaces, reviews, demos] = await Promise.all(
      ['explorations', 'workspaces', 'resume-reviews', 'demo-instances'].map(read),
    );
    db.close();
    return {
      projects: projects as Exploration[],
      workspaces: workspaces as Workspace[],
      reviews,
      demos: demos as { id: string; projectId: string; workspaceId: string; reviewId: string }[],
    };
  });
}
async function open(page: Page, title: string, fromStart = false) {
  await page.goto('/examples');
  await page
    .locator('.demo-module-grid section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button', { name: fromStart ? '从头体验' : '查看完成版', exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/examples/);
}
async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: '更多研究操作', exact: true }).click();
  await page
    .getByRole('navigation', { name: '研究操作' })
    .getByRole('button', { name, exact: true })
    .click();
}
test('从首页、真实预置阶段到部分导入、JD局部审阅、简历定位与报告导出', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('link', { name: '体验完整示例', exact: false }).click();
  await page
    .locator('.demo-module-grid section')
    .filter({ has: page.getByRole('heading', { name: 'AI帮我规划', exact: true }) })
    .getByRole('button', { name: '从头体验', exact: true })
    .click();
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await expect(main.getByRole('heading', { level: 1 })).toContainText('把想法');
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution')).toHaveCount(3);
  await expect(page.locator('.lab-error')).toHaveCount(0);
  await main.getByRole('button', { name: '我不确定', exact: true }).first().click();
  await expect(main.getByRole('status').filter({ hasText: '方向仍未知' })).toBeVisible();
  await main.getByText('填写自己的方向（可选）', { exact: true }).click();
  await main.getByLabel('自己的规划偏好').fill('暂不确定维护方式，先讨论轻量Web交付边界。');
  await main.getByRole('button', { name: '其他，请填写并保存', exact: true }).click();
  await expect(main.getByRole('status').filter({ hasText: '已保存自己的偏好' })).toBeVisible();
  await main.locator('.planning-proof summary').first().click();
  await expect(main.getByTestId('guided-evidence').first()).toBeVisible();
  await main.locator('.planning-proof summary').first().click();
  const plan = main.getByTestId('planning-solution').filter({
    has: page.getByRole('heading', { name: '软件工程师（Web应用方向）', exact: true }),
  });
  await plan.getByRole('button', { name: '选择此方案', exact: true }).click();
  const ack = main.getByRole('checkbox', { name: /我理解上述重要冲突/ });
  if (await ack.count()) await ack.check();
  await main.getByRole('button', { name: '确认方案并生成资料包', exact: true }).click();
  await expect(main.locator('.guided-handoff')).toBeVisible();
  await main.getByRole('button', { name: '保存快照并预览导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入预览 · 岗位共创工作台' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(5);
  await dialog.getByRole('checkbox').last().uncheck();
  await dialog.getByRole('button', { name: '确认导入为待确认任务与要求', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  const jobUrl = page.url();
  await expect(page.locator('.demo-ribbon')).toContainText('示例项目｜虚构材料｜预置分析结果');
  await page.getByRole('tab', { name: /任务与要求/ }).click();
  for (const tab of ['岗位任务', '岗位要求']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    while (
      await page
        .locator('.confirm-button')
        .filter({ hasText: /^确认$/ })
        .count()
    )
      await page
        .locator('.confirm-button')
        .filter({ hasText: /^确认$/ })
        .first()
        .click();
  }
  await page.getByRole('button', { name: '生成 JD 草稿', exact: true }).click();
  await expect(page.locator('.jd-block').first()).toBeVisible();
  const first = page.locator('.jd-block').first();
  await first.click();
  await first.getByRole('button', { name: '精简内容', exact: true }).click();
  await expect(page.locator('.suggestion-card')).toHaveCount(1);
  await page.screenshot({ path: 'docs/screenshots/polish-after/jd-diff-1440.png', fullPage: true });
  await page.getByRole('button', { name: '应用本条', exact: true }).click();
  await expect(page.locator('.suggestion-card')).toContainText('已应用到草稿');
  await page.getByRole('link', { name: '用当前岗位核对简历', exact: true }).click();
  await expect(page.getByLabel('岗位JD', { exact: true })).toHaveCount(0);
  await expect(page.locator('.resume-requirements button')).toHaveCount(4);
  await page
    .getByLabel('上传简历文件')
    .setInputFiles('public/demo/software-engineer/software-resume.docx');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并核对材料', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '核对报告已形成' })).toBeVisible();
  await page.locator('.resume-citations button').first().click();
  await expect(page.locator('.resume-readable mark')).toBeVisible();
  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载Markdown', exact: true }).click();
  expect(await readFile((await (await d).path())!, 'utf8')).toContain('上游快照');
  const data = await records(page);
  const w = data.workspaces.find((w) => jobUrl.endsWith(w.id))!;
  expect(w.items.filter((i) => i.kind === 'requirement')).toHaveLength(4);
  expect(w.researchImports![0].material.roleData!.requirements).toHaveLength(4);
});
test('完成版共同研究、模式共享、关系删除撤销、旧快照恢复与隔离重置', async ({ page }) => {
  test.setTimeout(90000);
  await open(page, '共同研究');
  const url = page.url();
  const before = (await records(page)).projects.find((p) => url.endsWith(p.id))!;
  const history = JSON.stringify(before.snapshots);
  await page
    .getByRole('navigation', { name: '研究阶段' })
    .getByRole('button', { name: /产品需求/ })
    .click();
  const feature = page.getByTestId('guided-feature').first();
  await feature.getByRole('button', { name: '编辑与排除', exact: true }).click();
  await page.getByLabel('节点完整描述').fill('人工补充：报名表单应提供可复验的校验反馈。');
  await page.getByRole('button', { name: '保存节点修改', exact: true }).click();
  await page.getByLabel('研究方式').selectOption('plan');
  await page.getByRole('button', { name: '查看完整证据板', exact: true }).first().click();
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await menu(page, '资料与关系列表');
  let dialog = page.getByRole('dialog', { name: '资料与关系列表' });
  await dialog
    .getByRole('button', { name: /^冲突待核实/ })
    .first()
    .click();
  dialog = page.getByRole('dialog', { name: /关系详情/ });
  await expect(dialog.locator('.lab-proof')).toHaveCount(2);
  await dialog.getByRole('button', { name: '删除此关系（可撤销）', exact: true }).click();
  await page.getByRole('button', { name: '撤销上一步操作', exact: true }).click();
  await expect
    .poll(async () => {
      const p = (await records(page)).projects.find((p) => p.id === before.id)!;
      return p.lab!.edges.filter(
        (e) => e.relationType === 'conflicts_with' && e.status !== 'deleted',
      ).length;
    })
    .toBe(1);
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  const after = (await records(page)).projects.find((p) => p.id === before.id)!;
  expect(after.findings.some((f) => f.description.includes('人工补充'))).toBe(true);
  expect(JSON.stringify(after.snapshots)).toBe(history);
  expect(
    after.lab!.edges.filter((e) => e.relationType === 'conflicts_with' && e.status !== 'deleted'),
  ).toHaveLength(1);
  await menu(page, '历史快照');
  await page
    .getByRole('dialog')
    .getByRole('link', { name: /证据板/ })
    .first()
    .click();
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('不可变快照');
  await page.goto(url);
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await open(page, '共同研究');
  expect(page.url()).toBe(url);
  await page.goto('/examples');
  await page.getByRole('button', { name: '复制完成版为个人项目', exact: true }).click();
  await expect(page).not.toHaveURL(/\/examples/);
  const personal = page.url();
  await page.goto('/examples');
  await page.getByRole('button', { name: '重置完成版…', exact: true }).click();
  await page.getByRole('button', { name: '确认重置此示例', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已建立新的示例');
  const data = await records(page);
  expect(data.projects.find((p) => personal.endsWith(p.id))!.demo!.kind).toBe('personal-copy');
  expect(data.projects.find((p) => p.id === before.id)!.demo!.retired).toBe(true);
  expect(JSON.stringify(data.projects.find((p) => p.id === before.id)!.snapshots)).toBe(history);
});
test('主页面四种视口真实截图、减少动态效果与无页面横向溢出', async ({ page }) => {
  test.setTimeout(90000);
  await mkdir('docs/screenshots/polish-after', { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const title of [
    'AI帮我规划',
    '共同研究',
    '完整证据板',
    '岗位共创与JD',
    '简历证据核对',
    '研究历史与快照',
  ]) {
    await open(page, title);
    if (title === '完整证据板') await expect(page.getByTestId('evidence-board')).toBeVisible();
    const skip = page.getByRole('button', { name: '跳过教程', exact: true });
    if (await skip.first().isVisible()) await skip.first().click();
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      if (title === '完整证据板' && width === 390) {
        await page.getByRole('button', { name: '收起岗位面板', exact: true }).click();
        await expect(page.getByTestId('evidence-board')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `docs/screenshots/polish-after/${title}-${width}.png`,
        fullPage: true,
      });
    }
  }
  for (const route of ['/', '/lab', '/examples', '/match', '/settings/ai']) {
    await page.goto(route);
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `docs/screenshots/polish-after/${route.replaceAll('/', '') || 'home'}-${width}.png`,
        fullPage: true,
      });
    }
  }
});
test('暂不招聘方案可保存资料包，重置示例不影响真实岗位', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '创建岗位', exact: true }).first().click();
  await page.getByLabel('岗位名称', { exact: true }).fill('隔离验证：真实空白岗位');
  await page.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  const personal = page.url();
  await open(page, 'AI帮我规划');
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await main
    .getByTestId('planning-solution')
    .filter({
      has: page.getByRole('heading', { name: '现有服务组合 · 暂不新增招聘', exact: true }),
    })
    .getByRole('button', { name: '选择此方案', exact: true })
    .click();
  const ack = main.getByRole('checkbox', { name: /我理解上述重要冲突/ });
  if (await ack.count()) await ack.check();
  await main.getByRole('button', { name: '确认方案并生成资料包', exact: true }).click();
  await expect(
    main.getByText('当前选择暂不新增招聘。可以保存快照或导出研究包，无需强行生成岗位要求。'),
  ).toBeVisible();
  await expect(
    main.getByRole('button', { name: '保存快照并预览导入', exact: true }),
  ).toBeDisabled();
  const d = page.waitForEvent('download');
  await main.getByRole('button', { name: '导出完整研究包', exact: true }).click();
  expect(await readFile((await (await d).path())!, 'utf8')).toContain(
    '示例项目｜虚构材料｜预置分析结果',
  );
  await page.goto('/examples');
  await page.getByRole('button', { name: '重置完成版…', exact: true }).click();
  await page.getByRole('button', { name: '确认重置此示例', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已建立新的示例');
  await page.goto(personal);
  await expect(
    page.getByRole('button', { name: '隔离验证：真实空白岗位', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.demo-ribbon')).toHaveCount(0);
});
