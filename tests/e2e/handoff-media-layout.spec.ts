import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { syntheticLab } from '../fixtures/lab';
import type { Exploration } from '../../src/lib/exploration/model';
import type { Workspace } from '../../src/lib/workbench/model';
import { synchronizeLab } from '../../src/lib/lab/graph';
import { seedLegacyWorkbench } from '../fixtures/legacy-browser';
const shots = 'docs/screenshots/handoff-media-layout';
async function seed(page: Page, data: Exploration) {
  await page.goto('/lab');
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onupgradeneeded = () => {
        for (const name of [
          'workspaces',
          'explorations',
          'exploration-assets',
          'resume-reviews',
          'demo-instances',
        ])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('explorations', 'readwrite');
      tx.objectStore('explorations').put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('fixture write failed'));
    });
    db.close();
  }, data);
  await page.goto(`/lab/${data.id}`);
}
async function record<T>(page: Page, store: string): Promise<T> {
  return page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<T>((resolve) => {
      const r = db.transaction(store).objectStore(store).get(location.pathname.split('/').at(-1)!);
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  }, store);
}
test('已回答方向、无功能关联的岗位要求：真实快照预览与导入保留待确认', async ({ page }) => {
  const p = syntheticLab(20),
    lab = p.lab!;
  lab.ui.researchStep = 'handoff';
  lab.ui.researchMode = 'collaborate';
  lab.solutions[0].status = 'confirmed';
  lab.activeSolutionIds = [lab.solutions[0].id];
  lab.requirements = [lab.requirements[0]];
  Object.assign(lab.requirements[0], { status: 'confirmed', relatedFeatureIds: [] });
  lab.researchGuide.importRequirementIds = [lab.requirements[0].id];
  p.questions[0].status = 'answered';
  p.questions[0].answer = '先采用已讨论的第一阶段范围';
  await seed(page, synchronizeLab(p));
  await page.getByRole('button', { name: '保存快照并预览导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入预览 · 岗位共创工作台' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/将作为岗位交付候选带入/)).toBeVisible();
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/role-only-import.png`, fullPage: true });
  await dialog.getByRole('button', { name: '确认导入为待确认任务与要求', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  const w = await record<Workspace>(page, 'workspaces');
  expect(w.items).toHaveLength(2);
  expect(w.items.every((i) => i.status === 'pending')).toBe(true);
  expect(w.items.every((i) => i.researchLink?.featureIds.length === 0)).toBe(true);
  expect(w.questions.some((q) => q.answer === p.questions[0].answer)).toBe(true);
  expect(w.sources[0].snapshotOrigin?.explorationId).toBe(p.id);
});
test('工作台图片上传、真实Ctrl+V粘贴、失败保留文字、刷新恢复原图和说明', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedLegacyWorkbench(page);
  const tutorial = page.getByRole('complementary', { name: '岗位交互教程' });
  if (await tutorial.isVisible())
    await tutorial.getByRole('button', { name: '跳过教程', exact: true }).click();
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '录入岗位资料' });
  await dialog
    .getByLabel('原文（保存后通过新版本修订）', { exact: true })
    .fill('原先填写的图片说明需要保留');
  const upload = dialog.getByLabel('导入岗位资料文件', { exact: true });
  await upload.setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('broken image'),
  });
  await expect(dialog.getByRole('alert')).toContainText('签名');
  await expect(dialog.getByLabel('原文（保存后通过新版本修订）', { exact: true })).toHaveValue(
    '原先填写的图片说明需要保留',
  );
  await upload.setInputFiles('public/demo/software-engineer/interface.png');
  await expect(dialog.getByAltText('待保存岗位资料图片')).toBeVisible();
  await dialog.getByLabel('资料标题', { exact: true }).fill('上传的岗位参考截图');
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /上传的岗位参考截图/ }).click();
  await expect(page.getByAltText('上传的岗位参考截图')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /上传的岗位参考截图/ }).click();
  await expect(page.getByAltText('上传的岗位参考截图')).toBeVisible();
  await expect(page.getByTestId('source-original')).toContainText('原先填写的图片说明需要保留');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '录入岗位资料' });
  await page.evaluate(async () => {
    const response = await fetch('/demo/software-engineer/interface.png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await response.blob() })]);
  });
  await dialog.getByLabel('资料标题', { exact: true }).focus();
  await page.keyboard.press('Control+V');
  await expect(dialog.getByAltText('待保存岗位资料图片')).toBeVisible();
  await dialog.getByLabel('资料标题', { exact: true }).fill('直接粘贴的岗位截图');
  await dialog
    .getByLabel('图片说明（可选，填写后供AI整理）', { exact: true })
    .fill('人工说明：画面包含导出按钮，是否承担此任务仍需讨论。');
  await page.screenshot({ path: `${shots}/workbench-paste.png`, fullPage: true });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Reflect.set(window, 'savedImageTestPut', put);
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'exploration-assets')
        throw new DOMException('测试：存储空间不足', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('存储空间不足');
  await expect(dialog.getByAltText('待保存岗位资料图片')).toBeVisible();
  await expect(dialog.getByLabel('图片说明（可选，填写后供AI整理）', { exact: true })).toHaveValue(
    '人工说明：画面包含导出按钮，是否承担此任务仍需讨论。',
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = Reflect.get(window, 'savedImageTestPut');
  });
  await dialog.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await record<Workspace>(page, 'workspaces')).sources.filter(
          (s) => s.versions.at(-1)?.image,
        ).length,
    )
    .toBe(2);
  const w = await record<Workspace>(page, 'workspaces');
  const images = w.sources.filter((s) => s.versions.at(-1)?.image);
  expect(images).toHaveLength(2);
  expect(new Set(images.map((s) => s.versions.at(-1)!.image!.assetId)).size).toBe(2);
  expect(images[1].versions[0].text).toContain('人工说明');
  await page.getByRole('button', { name: /直接粘贴的岗位截图/ }).click();
  await page.getByRole('button', { name: '新增修订版本', exact: true }).click();
  await page
    .getByLabel('图片说明（可选，填写后供AI整理）', { exact: true })
    .fill('修订后的人工说明保留原图。');
  await page.getByRole('button', { name: '保存新版本', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await expect(page.getByAltText('直接粘贴的岗位截图')).toBeVisible();
});
test('旧分散布局紧凑整理、撤销和刷新：节点关系不变且手动位置保留', async ({ page }) => {
  const p = syntheticLab(20);
  p.lab!.ui.researchView = 'board';
  p.lab!.ui.boardDensity = 'all';
  for (const [i, n] of p.lab!.nodes.entries())
    n.layoutPosition = { x: (i % 5) * 1400, y: Math.floor(i / 5) * 1300 };
  p.lab!.nodes[0].userPositioned = true;
  const original = p.lab!.nodes.map((n) => n.layoutPosition);
  await seed(page, p);
  await expect(page.getByTestId('evidence-board')).toBeVisible();
  await page.getByRole('button', { name: '适配全部', exact: true }).click();
  await page.screenshot({ path: `${shots}/board-before.png`, fullPage: true });
  await page.getByRole('button', { name: '紧凑整理', exact: true }).click();
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  const compact = await record<Exploration>(page, 'explorations');
  expect(compact.lab!.nodes[0].layoutPosition).toEqual(original[0]);
  expect(compact.lab!.edges).toEqual(p.lab!.edges);
  expect(compact.lab!.nodes.map((n) => n.layoutPosition)).not.toEqual(original);
  await page.screenshot({ path: `${shots}/board-after.png`, fullPage: true });
  await page.getByRole('button', { name: '撤销上一步操作', exact: true }).click();
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  expect(
    (await record<Exploration>(page, 'explorations')).lab!.nodes.map((n) => n.layoutPosition),
  ).toEqual(original);
  await page.reload();
  expect(
    (await record<Exploration>(page, 'explorations')).lab!.nodes.map((n) => n.layoutPosition),
  ).toEqual(original);
});
