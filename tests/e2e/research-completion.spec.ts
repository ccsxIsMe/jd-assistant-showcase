import { expect, test, type Page } from '@playwright/test';
import {
  newExploration,
  makeId,
  type Exploration,
  type AnalysisRun,
} from '../../src/lib/exploration/model';
import {
  createSource,
  sourceChanged,
  paragraphs,
  applyAnalysis,
  semanticSignature,
  changeFinding,
  createSnapshot,
} from '../../src/lib/exploration/domain';
import { analysisRequestFor, exampleAnalysis } from '../../src/lib/exploration/analysis';
import { materialFromSnapshot } from '../../src/lib/exploration/material';
import { importRequirementMaterial } from '../../src/lib/exploration/workbench-import';
import { newWorkspace, type Workspace } from '../../src/lib/workbench/model';
import { editItem, toggleLock } from '../../src/lib/workbench/domain';

function seed() {
  let p = newExploration('验收用产品研究');
  p.initialObjective = '为小团队做实时预览和文件导出，不复制支付社区。';
  const source = createSource('text', '实际用户说明');
  source.status = 'ready';
  source.versions[0].text = '需要实时预览。\n需要文件导出。\n不需要支付和社区。';
  source.versions[0].paragraphs = paragraphs(source.versions[0].text);
  p = sourceChanged(p, source, source.versions[0]);
  const output = exampleAnalysis(analysisRequestFor(p));
  const run: AnalysisRun = {
    id: makeId(),
    at: new Date().toISOString(),
    requestId: makeId(),
    promptVersion: 'exploreRequirements@1.1.0',
    mode: 'example',
    baseSignature: semanticSignature(p),
    applied: false,
    output,
    modelConfig: {
      provider: 'mock',
      model: 'built-in-product-example',
      configurationId: 'example@1',
    },
    parserVersions: { pdfjs: '6.4.299' },
  };
  p.runs.push(run);
  p = applyAnalysis(
    p,
    run,
    output.findings.map((f) => f.key),
    true,
  );
  p.overviewConfirmed = true;
  p = changeFinding(p, p.findings[0].id, { status: 'confirmed' });
  p.snapshots.unshift(createSnapshot(p, 'confirmed', new Set()));
  return p;
}
async function put(
  page: Page,
  p: Exploration,
  w?: Workspace,
  assets: { id: string; text: string }[] = [],
) {
  await page.goto('/explore?view=classic');
  await expect(page.getByRole('button', { name: '体验产品探索示例', exact: true })).toBeVisible();
  await page.evaluate(
    async ({ p, w, assets }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('jd-assistant-workbench', 3);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(new Error('fixture open failed'));
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ['explorations', 'workspaces', 'exploration-assets'],
          'readwrite',
        );
        tx.objectStore('explorations').put(p);
        if (w) tx.objectStore('workspaces').put(w);
        for (const a of assets)
          tx.objectStore('exploration-assets').put({
            id: a.id,
            explorationId: p.id,
            blob: new Blob([a.text], { type: 'text/plain' }),
            name: a.id + '.txt',
          });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('fixture save failed'));
      });
      db.close();
    },
    { p, w, assets },
  );
}
async function saved(page: Page, id: string): Promise<Exploration> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<Exploration>((resolve) => {
      const r = db.transaction('explorations').objectStore('explorations').get(id);
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  }, id);
}
async function editFirst(page: Page, text: string) {
  await page.getByRole('button', { name: '功能清单', exact: true }).click();
  await page
    .getByTestId('explore-finding')
    .first()
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  await page.getByLabel('需求说明', { exact: true }).fill(text);
  await page.getByRole('button', { name: '保存结论，等待确认', exact: true }).click();
}
async function saveDraft(page: Page) {
  await page.getByRole('button', { name: '保存快照', exact: true }).click();
  await page.getByRole('button', { name: '保存草案快照', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '保存产品需求快照' })).toBeHidden();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
}

test('完整V1恢复、派生V2、独立复制、重复保存与历史窄屏', async ({ page }) => {
  const p = seed();
  const v1 = p.snapshots[0];
  const original = p.findings[0].description;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await put(page, p);
  await page.goto(`/explore/snapshots/${v1.snapshotId}`);
  await expect(page.locator('.snapshot-detail')).toContainText(p.initialObjective!);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出JSON快照', exact: true }).click();
  const stream = await (await download).createReadStream();
  let raw = '';
  for await (const chunk of stream!) raw += chunk.toString();
  const archive = JSON.parse(raw).snapshot;
  expect(archive.research.findings).toHaveLength(p.findings.length);
  expect(archive.research.findings.some((f: { status: string }) => f.status === 'pending')).toBe(
    true,
  );
  expect(archive.research.runs[0].modelConfig.configurationId).toBe('example@1');
  expect(archive.research.operations.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '基于当前快照继续研究', exact: true }).click();
  await page.getByLabel('新研究标题').fill('派生V2研究');
  await page.getByRole('button', { name: '创建派生研究', exact: true }).click();
  await expect(page).toHaveURL(/\/explore\/[\w-]+$/);
  const derivedId = page.url().split('/').at(-1)!;
  await editFirst(page, 'V2人工修订：导出前确认预览内容。');
  await saveDraft(page);
  await saveDraft(page);
  const derived = await saved(page, derivedId);
  expect(derived.snapshots).toHaveLength(1);
  expect(derived.snapshots[0].version).toBe(2);
  expect(derived.snapshots[0].lineage?.parentSnapshotId).toBe(v1.snapshotId);
  await page.reload();
  await expect(page.getByTestId('explore-finding').first()).toContainText('V2人工修订');
  await page.goto(`/explore/snapshots/${v1.snapshotId}`);
  await expect(page.locator('.snapshot-detail')).toContainText(original);
  await expect(page.locator('.snapshot-detail')).not.toContainText('V2人工修订');
  await page.getByRole('button', { name: '原始资料与证据', exact: true }).click();
  await expect(page.locator('.research-source-manifest')).toContainText('实际用户说明');
  await page.getByRole('button', { name: '复制快照', exact: true }).click();
  await page.getByLabel('新研究标题').fill('隔离副本');
  await page.getByRole('button', { name: '创建独立副本', exact: true }).click();
  await expect(page).toHaveURL(/\/explore\/[\w-]+$/);
  const copyId = page.url().split('/').at(-1)!;
  await editFirst(page, '仅副本修改，不影响原研究。');
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  expect((await saved(page, p.id)).findings[0].description).toBe(original);
  expect((await saved(page, derivedId)).findings[0].description).toContain('V2人工修订');
  expect((await saved(page, copyId)).findings[0].description).toContain('仅副本');
  await page.goto('/explore/history');
  await page.getByLabel('搜索研究历史').fill('隔离副本');
  await expect(page.getByTestId('research-history-card')).toHaveCount(1);
  await expect(page.getByTestId('research-history-card')).toContainText('尚未保存到快照');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId('research-history-card').locator('[data-snapshot-link]').click();
  await expect(page.getByRole('button', { name: '复制快照', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('结构图真实关系、节点新增、排除撤销和证据返回', async ({ page }) => {
  const p = seed();
  await put(page, p);
  await page.goto(`/explore/${p.id}`);
  await page.getByRole('button', { name: '需求结构图', exact: true }).click();
  await page.getByRole('button', { name: '添加结构节点', exact: true }).click();
  await page.getByLabel('结论名称', { exact: true }).fill('实际用户场景');
  await page.getByLabel('需求说明', { exact: true }).fill('用户在会议中核对导出前预览。');
  await page.getByLabel('父节点关系').selectOption(p.findings[0].id);
  await page.getByRole('button', { name: '保存结论，等待确认', exact: true }).click();
  const parent = page.locator(`#finding-${p.findings[0].id}`);
  await expect(parent).toContainText('实际用户场景');
  // Work from the unique direct heading, avoiding its ancestor node controls.
  const row = page
    .locator('.explore-structure li')
    .filter({ has: page.locator(':scope > button > strong', { hasText: '实际用户场景' }) })
    .last();
  await expect(row).toContainText('待确认');
  await row.getByRole('button', { name: '排除节点', exact: true }).click();
  await expect(row).toHaveClass(/excluded/);
  await page.getByRole('button', { name: '撤销最近研究修改', exact: true }).click();
  await expect(row).not.toHaveClass(/excluded/);
  await page.getByRole('button', { name: '撤销最近研究修改', exact: true }).click();
  await expect(page.locator('.explore-structure strong', { hasText: '实际用户场景' })).toHaveCount(
    0,
  );
  await parent.getByRole('button', { name: '定位证据', exact: true }).first().click();
  await expect(page.locator('.evidence-paragraph.highlighted mark')).toBeVisible();
  await page.getByRole('button', { name: '关闭证据并返回研究画布', exact: true }).click();
  await expect(page.locator('.explore-structure')).toBeVisible();
  await page.getByRole('button', { name: '添加结构节点', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('上游差异不改人工编辑，锁定阻止同步，显式应用及移除只标复核', async ({ page }) => {
  const p = seed();
  const v1 = p.snapshots[0];
  let w = importRequirementMaterial(newWorkspace('研究导入岗位'), materialFromSnapshot(v1), [
    p.findings[0].id,
  ]);
  const task = w.items.find((i) => i.kind === 'task')!;
  w = editItem(w, task.id, { text: '岗位人工编辑：保留客户协作说明。' });
  w = toggleLock(w, task.id);
  const original = w.items.find((i) => i.id === task.id)!.text;
  await put(page, p, w);
  await page.goto(`/explore/${p.id}`);
  await editFirst(page, '上游新增：导出前需人工确认最新预览。');
  await saveDraft(page);
  await page.goto(`/workspaces/${w.id}`);
  const local = page.getByTestId('item-task').first();
  await expect(local).toContainText(original);
  await page.getByRole('button', { name: '检查上游更新', exact: true }).click();
  const outline = page
    .getByRole('dialog')
    .getByRole('button', { name: '检查上游更新', exact: true });
  const colors = await outline.evaluate((element) => {
    const style = getComputedStyle(element);
    return { text: style.color, background: style.backgroundColor };
  });
  expect(colors.text).not.toBe(colors.background);
  await expect(page.locator('.upstream-change').first()).toContainText('上游新增');
  const changed = page.locator('.upstream-change').filter({ hasText: '上游功能变化' }).first();
  await expect(changed).toContainText('本地已锁定');
  await expect(changed.getByRole('checkbox')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(local).toContainText(original);
  await local.getByRole('button', { name: '解锁', exact: true }).click();
  await page.getByRole('button', { name: '检查上游更新', exact: true }).click();
  await expect(changed.getByRole('checkbox')).not.toBeChecked();
  await changed.getByRole('checkbox').check();
  await page.getByRole('button', { name: '同步所选变更并保留其他编辑', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已按选择同步');
  await page.keyboard.press('Escape');
  await expect(local).toContainText('上游新增');
  const updated = await local.locator('.object-main').textContent();
  await page.goto(`/explore/${p.id}`);
  await page.getByRole('button', { name: '需求结构图', exact: true }).click();
  await page
    .locator(`#finding-${p.findings[0].id}`)
    .getByRole('button', { name: '排除节点', exact: true })
    .first()
    .click();
  await saveDraft(page);
  await page.goto(`/workspaces/${w.id}`);
  await page.getByRole('button', { name: '检查上游更新', exact: true }).click();
  const removed = page.locator('.upstream-change').filter({ hasText: '上游功能移除 / 排除' });
  await expect(removed.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '同步所选变更并保留其他编辑', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已按选择同步');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('item-task').first().locator('.item-status')).toContainText(
    '需复核',
  );
  expect(await page.getByTestId('item-task').first().locator('.object-main').textContent()).toBe(
    updated,
  );
  await page.getByRole('tab', { name: /岗位要求/ }).click();
  await expect(page.getByTestId('item-requirement').first().locator('.item-status')).toContainText(
    '需复核',
  );
});

test('删除快照先确认，只清理专属附件，其他快照共享附件保留', async ({ page }) => {
  const p = seed();
  const shared = makeId(),
    exclusive = makeId();
  const source = createSource('document', '快照附件');
  source.status = 'ready';
  source.versions[0].assetId = shared;
  source.versions[0].mime = 'text/plain';
  source.versions[0].fileName = 'shared.txt';
  const v1 = p.snapshots[0];
  v1.research!.sources.push(structuredClone(source));
  const own = structuredClone(source);
  own.id = makeId();
  own.versions[0].assetId = exclusive;
  v1.research!.sources.push(own);
  v1.research!.archive.assetIds.push(shared, exclusive);
  const v2 = createSnapshot(p, 'draft', new Set());
  v2.research!.sources.push(source);
  v2.research!.archive.assetIds.push(shared);
  p.snapshots.unshift(v2);
  await put(page, p, undefined, [
    { id: shared, text: 'shared fixture' },
    { id: exclusive, text: 'exclusive fixture' },
  ]);
  await page.goto('/explore/history');
  const card = page
    .getByTestId('research-history-card')
    .filter({ has: page.locator(`[href="/explore/snapshots/${v1.snapshotId}"]`) });
  await card.getByRole('button', { name: '删除此快照', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('不会自动删除');
  await page.getByRole('button', { name: '保留快照', exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '删除此快照', exact: true }).click();
  await page.getByRole('button', { name: '确认删除研究快照', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await saved(page, p.id)).snapshots.map((s) => s.snapshotId)).toEqual([v2.snapshotId]);
  const remaining = await page.evaluate(
    async ({ shared, exclusive }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('jd-assistant-workbench', 3);
        r.onsuccess = () => resolve(r.result);
      });
      const values = await Promise.all(
        [shared, exclusive].map(
          (id) =>
            new Promise<boolean>((resolve) => {
              const r = db
                .transaction('exploration-assets')
                .objectStore('exploration-assets')
                .get(id);
              r.onsuccess = () => resolve(!!r.result);
            }),
        ),
      );
      db.close();
      return values;
    },
    { shared, exclusive },
  );
  expect(remaining).toEqual([true, false]);
});

test('迟到模型响应不可覆盖新编辑，未采纳输出仍归档', async ({ page }) => {
  const p = seed();
  p.snapshots = [];
  await put(page, p);
  await page.goto(`/explore/${p.id}`);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exploration/analyze', async (route) => {
    const response = await route.fetch();
    await hold;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '产品概览', exact: true }).click();
  await page.getByRole('checkbox', { name: '确认分析资料范围' }).check();
  const start = page.getByRole('button', { name: '开始产品需求分析', exact: true });
  await start.click();
  await expect(page.getByRole('button', { name: '等待结构化分析…', exact: true })).toBeDisabled();
  await page
    .getByLabel('产品目标', { exact: true })
    .fill('分析期间人工补充的目标，不允许被迟到结果覆盖。');
  await page.getByRole('button', { name: '产品概览', exact: true }).click();
  release();
  const modal = page.getByRole('dialog', { name: '审阅产品分析草案' });
  await expect(modal).toContainText('本次草案已过期');
  await expect(
    modal.getByRole('button', { name: '采纳所选，进入人工确认', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('产品目标', { exact: true })).toHaveValue(
    '分析期间人工补充的目标，不允许被迟到结果覆盖。',
  );
  await saveDraft(page);
  const state = await saved(page, p.id);
  expect(state.snapshots[0].research?.runs.some((run) => !run.applied)).toBe(true);
  expect(state.snapshots[0].research?.overview.goal).toContain('分析期间人工补充');
});

test('空历史、长标题长URL和大量证据在桌面与窄屏可读', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/explore/history');
  await expect(page.getByRole('heading', { name: '还没有研究记录', exact: true })).toBeVisible();
  let p = seed();
  p.title = '产品研究与交互需求'.repeat(20);
  p.findings[0].description = '需要核实的长需求说明。'.repeat(150);
  for (let n = 0; n < 6; n++) {
    const source = createSource('url', `公开参考${n}：` + '长标题'.repeat(40));
    source.status = 'ready';
    const version = source.versions[0];
    version.normalizedUrl = 'https://example.com/' + 'product-reference/'.repeat(100);
    version.text = Array.from(
      { length: 20 },
      (_, i) => `第${i + 1}段实际测试资料。` + '需要保留并核实证据。'.repeat(60),
    ).join('\n');
    version.paragraphs = paragraphs(version.text, 'extracted');
    p = sourceChanged(p, source, version);
  }
  p.snapshots = [createSnapshot(p, 'draft', new Set())];
  await put(page, p);
  await page.goto(`/explore/${p.id}`);
  await page.getByRole('button', { name: '功能清单', exact: true }).click();
  await expect(page.getByTestId('explore-finding').first()).toContainText('长需求说明');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto(`/explore/snapshots/${p.snapshots[0].snapshotId}`);
  await page.getByRole('button', { name: '原始资料与证据', exact: true }).click();
  await page.locator('.research-source-manifest button').last().click();
  await expect(page.locator('.archived-evidence')).toContainText('需要保留并核实证据');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
