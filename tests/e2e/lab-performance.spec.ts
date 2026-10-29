import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { format, resolveConfig } from 'prettier';
import { syntheticLab } from '../fixtures/lab';
test('20、100、300节点：实际浏览器视口、拖动、保存和证据链性能记录', async ({ page, browser }) => {
  test.setTimeout(120000);
  const measurements: unknown[] = [];
  for (const size of [20, 100, 300] as const) {
    const data = syntheticLab(size);
    expect(data.lab!.nodes).toHaveLength(size);
    await page.goto('/lab');
    await page.evaluate(async (data) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('jd-assistant-workbench', 3);
        r.onupgradeneeded = () => {
          for (const name of ['workspaces', 'explorations', 'exploration-assets'])
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
    }, data);
    await page.setViewportSize({ width: 1440, height: 900 });
    let start = Date.now();
    await page.goto(`/lab/${data.id}`);
    await expect(page.getByRole('main', { name: '五阶段引导式研究' })).toBeVisible();
    const guidedOpenMs = Date.now() - start;
    await page
      .locator('.lab-top-actions')
      .getByRole('button', { name: '查看完整证据板', exact: true })
      .click();
    await expect(page.getByTestId('lab-node-source').first()).toBeVisible();
    const openMs = Date.now() - start;
    const rendered = await page.locator('.react-flow__node').count();
    expect(rendered).toBeLessThan(size);
    const source = page.getByTestId('lab-node-source').first(),
      handle = source.locator('.lab-node-drag-handle'),
      box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.evaluate(() => {
      const sample = { active: true, frames: [] as number[], previous: performance.now() };
      Reflect.set(window, 'labDragFrameSample', sample);
      function frame(t: number) {
        if (!sample.active) return;
        sample.frames.push(t - sample.previous);
        sample.previous = t;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    start = Date.now();
    await page.mouse.move(box!.x + 50, box!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box!.x + 110, box!.y + 90, { steps: 10 });
    await page.mouse.up();
    const dragGestureMs = Date.now() - start;
    const dragFrames = await page.evaluate(() => {
      const sample = Reflect.get(window, 'labDragFrameSample') as {
        active: boolean;
        frames: number[];
      };
      sample.active = false;
      return sample.frames;
    });
    await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
    const dragSaveMs = Date.now() - start;
    const read = () =>
      page.evaluate(async () => {
        const id = location.pathname.split('/').at(-1)!;
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('jd-assistant-workbench', 3);
          r.onsuccess = () => resolve(r.result);
        });
        return new Promise<import('../../src/lib/exploration/model').Exploration>((resolve) => {
          const r = db.transaction('explorations').objectStore('explorations').get(id);
          r.onsuccess = () => resolve(r.result);
        });
      });
    const beforeAdd = await read();
    start = Date.now();
    await page.getByRole('button', { name: '添加资料', exact: true }).click();
    await page.getByLabel('资料或产品名称').fill('合成新增：检查增量布局');
    await page.getByLabel('想法与上下文').fill('新增合成说明，仅用于工程测试。');
    await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
    const addNodeMs = Date.now() - start;
    const afterAdd = await read();
    for (const node of beforeAdd.lab!.nodes)
      expect(afterAdd.lab!.nodes.find((n) => n.id === node.id)!.layoutPosition).toEqual(
        node.layoutPosition,
      );
    start = Date.now();
    await source.getByRole('button', { name: /^展开/ }).click();
    await expect(source.locator('.lab-inline-evidence-list')).toBeVisible();
    const expandMs = Date.now() - start;
    await page.getByRole('button', { name: '展开岗位面板', exact: true }).click();
    start = Date.now();
    await page.getByTestId('role-requirement').first().locator('.lab-requirement-title').click();
    await expect(page.locator('.lab-focus-banner')).toBeVisible();
    const focusMs = Date.now() - start;
    await page
      .locator('.lab-focus-banner')
      .getByRole('button', { name: '显示全部', exact: true })
      .click();
    const oldZoom = await page.getByLabel('画布缩放比例', { exact: true }).textContent();
    start = Date.now();
    await page.getByRole('button', { name: '放大画布', exact: true }).click();
    await expect(page.getByLabel('画布缩放比例', { exact: true })).not.toHaveText(oldZoom!);
    const zoomResponseMs = Date.now() - start;
    await page.getByRole('button', { name: '缩小画布', exact: true }).click();
    await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
    const frameIntervals = await page.evaluate(async () => {
      const result: number[] = [];
      let previous = performance.now();
      for (let i = 0; i < 30; i++)
        await new Promise<void>((resolve) =>
          requestAnimationFrame((t) => {
            result.push(t - previous);
            previous = t;
            resolve();
          }),
        );
      return result;
    });
    start = Date.now();
    await page.getByRole('button', { name: '更多研究操作' }).click();
    await page.getByRole('button', { name: '保存快照', exact: true }).click();
    await expect(page.locator('.lab-message')).toContainText('快照 V1 已保存');
    const snapshotMs = Date.now() - start;
    await page.getByRole('button', { name: '更多研究操作' }).click();
    await page.getByRole('button', { name: '历史快照', exact: true }).click();
    start = Date.now();
    await page.getByRole('link', { name: '在证据板打开旧版本', exact: true }).click();
    await expect(page.getByTestId('evidence-board')).toBeVisible();
    const reopenMs = Date.now() - start;
    measurements.push({
      nodes: size,
      sources: data.sources.length,
      edges: data.lab!.edges.length,
      renderedAtInitialViewport: rendered,
      openMs,
      guidedOpenMs,
      dragGestureMs,
      dragFrameSamples: dragFrames.length,
      dragFrameP95Ms:
        dragFrames.sort((a, b) => a - b)[Math.max(0, Math.ceil(dragFrames.length * 0.95) - 1)] ??
        null,
      zoomResponseMs,
      dragAndDurableSaveMs: dragSaveMs,
      addSourceAndSaveMs: addNodeMs,
      expandMs,
      focusMs,
      createSnapshotMs: snapshotMs,
      openSnapshotMs: reopenMs,
      frameIntervalP95Ms: frameIntervals.sort((a, b) => a - b)[28],
    });
  }
  await mkdir('docs/screenshots/lab', { recursive: true });
  await writeFile(
    process.env.LAB_PERFORMANCE_REPORT ?? 'docs/dual-mode-performance.json',
    await format(
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          device: {
            platform: os.platform(),
            release: os.release(),
            cpu: os.cpus()[0]?.model,
            memoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
          },
          browser: browser.version(),
          viewport: '1440 × 900',
          method: `Production mock build at ${process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'}. Wall time includes Playwright/UI waits and 350ms auto-save debounce. dragFrameP95Ms samples RAF during the actual 10-step mouse gesture; frameIntervalP95Ms samples idle after interactions. Neither is a sustained FPS benchmark. openMs includes guided open and explicit board activation; guidedOpenMs stops when guided main becomes visible. Not a cold-cache or real-model latency measurement.`,
          measurements,
        },
        null,
        2,
      ),
      { ...(await resolveConfig('package.json')), parser: 'json' },
    ),
  );
});
