import { test, expect, type Page } from '@playwright/test';
import type { Exploration } from '../../src/lib/exploration/model';
async function example(page: Page) {
  await page.goto('/examples');
  await page
    .locator('.demo-module-grid section')
    .filter({ has: page.getByRole('heading', { name: '共同研究', exact: true }) })
    .getByRole('button', { name: '查看完成版', exact: true })
    .click();
  await expect(page).toHaveURL(/\/lab\//);
  await expect(page.locator('.lab-project-heading small')).toContainText('已保存');
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    async function read<T>(store: string) {
      return new Promise<T[]>((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    const projects = await read<Exploration>('explorations'),
      workspaces = await read('workspaces'),
      assets = await read<{ id: string; blob: Blob }>('exploration-assets');
    db.close();
    return {
      projects,
      workspaces,
      assets: assets.map((a) => ({ id: a.id, size: a.blob.size, type: a.blob.type })),
    };
  });
}
test('需求实验室首页四张流程卡和标题在深色区域可读，四种视口截图', async ({ page }) => {
  await page.goto('/lab');
  const colors = await page.locator('.explore-map span').evaluateAll((els) =>
    els.map((el) => {
      const rgb = (s: string) =>
          s
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number),
        lum = (c: number[]) =>
          c
            .map((n) => {
              const v = n / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const s = getComputedStyle(el),
        a = lum(rgb(s.color)),
        b = lum(rgb(s.backgroundColor));
      return { text: el.textContent, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    }),
  );
  expect(colors).toHaveLength(4);
  for (const c of colors) expect(c.contrast, c.text ?? '').toBeGreaterThan(4.5);
  await expect(page.locator('.explore-hero h1')).toHaveCSS('color', 'rgb(241, 245, 255)');
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
      path: `docs/screenshots/lab-home-fix/home-${width}.png`,
      fullPage: true,
    });
  }
});
test('首页项目删除可取消、撤销和持久化恢复，旧快照附件及工作台不受影响', async ({
  page,
  context,
}) => {
  test.setTimeout(70000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await example(page);
  const url = page.url(),
    projectId = url.split('/').at(-1)!.split('?')[0];
  const editor = await context.newPage();
  await editor.goto(url);
  await expect(editor.locator('.lab-project-heading small')).toContainText('已保存');
  await page.goto('/lab');
  const before = await records(page),
    project = before.projects.find((p) => p.id === projectId)!;
  const card = page
    .getByTestId('exploration-project-card')
    .filter({ has: page.getByRole('heading', { name: project.title, exact: true }) });
  await card.getByRole('button', { name: `删除探索：${project.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除这个探索？' });
  await expect(dialog).toContainText('快照');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: `删除探索：${project.title}`, exact: true }).click();
  await dialog.getByRole('button', { name: '确认删除探索', exact: true }).click();
  await expect(page.locator('.explore-project-notice')).toContainText('已移至回收站');
  await expect(card).toHaveCount(0);
  await expect(editor.getByRole('heading', { name: '这个探索已在回收站中' })).toBeVisible();
  const removed = await records(page),
    trashed = removed.projects.find((p) => p.id === projectId)!;
  expect(trashed.trashedAt).toBeTruthy();
  expect(trashed.snapshots).toEqual(project.snapshots);
  expect(trashed.sources).toEqual(project.sources);
  expect(removed.assets).toEqual(before.assets);
  expect(removed.workspaces).toEqual(before.workspaces);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(card).toHaveCount(1);
  await expect(editor.getByRole('heading', { name: '这个探索已在回收站中' })).toHaveCount(0);
  await card.getByRole('button', { name: `删除探索：${project.title}`, exact: true }).click();
  await dialog.getByRole('button', { name: '确认删除探索', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^回收站/ }).click();
  await expect(card).toHaveCount(1);
  await page.screenshot({ path: 'docs/screenshots/lab-home-fix/trash-1440.png', fullPage: true });
  await card.getByRole('button', { name: `恢复探索：${project.title}`, exact: true }).click();
  await page.getByRole('button', { name: /^我的探索（/ }).click();
  await expect(card).toHaveCount(1);
  await page.reload();
  await expect(card).toHaveCount(1);
  const restored = await records(page);
  expect(restored.projects.find((p) => p.id === projectId)!.snapshots).toEqual(project.snapshots);
  await editor.close();
});
test('删除存储失败不显示成功，版本冲突保留新编辑', async ({ page }) => {
  await example(page);
  await page.goto('/lab');
  const project = (await records(page)).projects[0],
    card = page
      .getByTestId('exploration-project-card')
      .filter({ has: page.getByRole('heading', { name: project.title, exact: true }) });
  await card.getByRole('button', { name: `删除探索：${project.title}`, exact: true }).click();
  await page.evaluate(() => {
    const state = window as typeof window & { originalProjectPut?: IDBObjectStore['put'] };
    state.originalProjectPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'explorations') throw new DOMException('fixed-quota', 'QuotaExceededError');
      return state.originalProjectPut!.apply(this, args);
    };
  });
  const dialog = page.getByRole('dialog', { name: '删除这个探索？' });
  await dialog.getByRole('button', { name: '确认删除探索', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('本地保存失败');
  expect((await records(page)).projects[0].trashedAt).toBeFalsy();
  await expect(page.locator('.explore-project-notice')).toHaveCount(0);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (
      window as typeof window & { originalProjectPut: IDBObjectStore['put'] }
    ).originalProjectPut;
  });
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('explorations', 'readwrite'),
        store = tx.objectStore('explorations'),
        r = store.get(id);
      r.onsuccess = () =>
        store.put({ ...r.result, title: '另一个页面的新编辑', revision: r.result.revision + 1 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, project.id);
  await dialog.getByRole('button', { name: '确认删除探索', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('其他页面更新');
  expect((await records(page)).projects[0]).toMatchObject({ title: '另一个页面的新编辑' });
  expect((await records(page)).projects[0].trashedAt).toBeFalsy();
});
test('AI设置的不计费网络检查独立于模型测试，准确展示进程权限失败', async ({ page }) => {
  let modelPosts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/ai/connection')) modelPosts++;
  });
  let denied = false;
  await page.route('**/api/ai/network', (route) =>
    route.fulfill({
      status: denied ? 502 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        denied
          ? {
              ok: false,
              code: 'NETWORK_DENIED',
              message: '服务进程联网权限被拒绝（EACCES）；已有编辑保留。',
              requestId: 'network-denied-test',
            }
          : {
              ok: true,
              code: 'NETWORK_REACHABLE',
              httpStatus: 401,
              message: 'HTTPS网络可达，未携带密钥，不代表密钥无效。',
              requestId: 'network-probe-test',
            },
      ),
    }),
  );
  await page.goto('/settings/ai');
  await page.getByRole('button', { name: '检查网络（不调用模型）', exact: true }).click();
  await expect(page.locator('.connection-result')).toContainText('尚未验证模型');
  expect(modelPosts).toBe(0);
  denied = true;
  await page.getByRole('button', { name: '检查网络（不调用模型）', exact: true }).click();
  await expect(page.locator('.connection-result')).toContainText('NETWORK_DENIED');
  await expect(page.locator('.connection-result')).toContainText('network-denied-test');
  expect(modelPosts).toBe(0);
});
