import { seedLegacyClassic } from '../fixtures/legacy-classic';
import { test, expect, type Page } from '@playwright/test';
async function example(page: Page) {
  await page.goto('/explore?view=classic');
  await seedLegacyClassic(page);
  await expect(page.locator('.evidence-paragraph').first()).toBeVisible();
}
async function imageClipboard(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ddd5ec';
    ctx.fillRect(0, 0, 320, 180);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    );
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
}
test('真实Ctrl+V粘贴图片先预览，取消不写入，保存后刷新可恢复', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await example(page);
  await imageClipboard(page);
  await page.getByRole('link', { name: '返回需求实验室', exact: true }).focus();
  await page.keyboard.press('Control+V');
  const modal = page.getByRole('dialog', { name: '添加探索资料' });
  await expect(modal.getByRole('img', { name: /待添加图片预览/ })).toBeVisible();
  await expect(page.locator('.explore-source-tile')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.explore-source-tile')).toHaveCount(1);
  await page.getByRole('link', { name: '返回需求实验室', exact: true }).focus();
  await page.keyboard.press('Control+V');
  await expect(modal.getByRole('img', { name: /待添加图片预览/ })).toBeVisible();
  await page.getByLabel('参考目的', { exact: true }).fill('粘贴的产品截图，等待人工标注。');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.getByTestId('annotation-canvas')).toBeVisible();
  await expect(page.locator('.explore-source-tile')).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('annotation-canvas')).toBeVisible();
});
test('表单可连续粘贴、移除图片，拒绝不支持格式且普通文字粘贴正常', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await example(page);
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  const text = page.getByLabel('想法与上下文', { exact: true });
  await text.focus();
  await page.evaluate(() => navigator.clipboard.writeText('普通文字粘贴需要保留。'));
  await page.keyboard.press('Control+V');
  await expect(text).toHaveValue('普通文字粘贴需要保留。');
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  await imageClipboard(page);
  await page.getByRole('region', { name: '粘贴图片区域' }).focus();
  await page.keyboard.press('Control+V');
  await page.keyboard.press('Control+V');
  await expect(page.getByRole('img', { name: /待添加图片预览/ })).toHaveCount(2);
  await page.getByRole('region', { name: '粘贴图片区域' }).evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(['<svg/>'], 'unsupported.svg', { type: 'image/svg+xml' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('仅支持');
  await expect(page.getByRole('img', { name: /待添加图片预览/ })).toHaveCount(2);
  await page
    .getByRole('button', { name: /移除待添加文件/ })
    .first()
    .click();
  await expect(page.getByRole('img', { name: /待添加图片预览/ })).toHaveCount(1);
  await page.getByRole('button', { name: '描述想法', exact: true }).click();
  await expect(text).toHaveValue('普通文字粘贴需要保留。');
});
test('视频链接失败保留诊断，截图作为关联补充，不覆盖原链接', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await example(page);
  let requested = '';
  await page.route('**/api/exploration/fetch-url', (route) => {
    requested = route.request().postDataJSON().url;
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '网页返回HTTP 412；请补充截图或文字。',
        code: 'WEB_UNAVAILABLE',
        requestId: 'fixed-public-request',
      }),
    });
  });
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '参考产品网址', exact: true }).click();
  await page
    .getByLabel('公开产品网址')
    .fill('https://www.bilibili.com/video/BV1test/?p=2&spm_id_from=test&vd_source=test');
  await expect(page.getByRole('dialog')).toContainText('不自动提取字幕');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.locator('.explore-source-viewer')).toContainText('fixed-public-request');
  await expect(page.locator('.explore-source-viewer')).toContainText('WEB_UNAVAILABLE');
  expect(requested).toBe('https://www.bilibili.com/video/BV1test/?p=2');
  await page.getByRole('button', { name: '粘贴截图或上传材料', exact: true }).click();
  await expect(page.getByLabel('关联原始链接')).not.toHaveValue('');
  await imageClipboard(page);
  await page.getByRole('region', { name: '粘贴图片区域' }).focus();
  await page.keyboard.press('Control+V');
  await expect(page.getByRole('img', { name: /待添加图片预览/ })).toBeVisible();
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await expect(page.locator('.explore-source-tile')).toHaveCount(3);
  await expect(page.getByTestId('annotation-canvas')).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const sources = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('fixture database failed'));
    });
    return new Promise<
      { id: string; kind: string; status: string; linkedSourceId: string | null }[]
    >((resolve, reject) => {
      const r = db.transaction('explorations').objectStore('explorations').get(id);
      r.onsuccess = () => {
        db.close();
        if (r.result) resolve(r.result.sources);
        else reject(new Error('fixture exploration not found'));
      };
      r.onerror = () => reject(new Error('fixture read failed'));
    });
  }, id);
  const original = sources.find((s) => s.kind === 'url')!;
  const image = sources.find((s) => s.kind === 'image')!;
  expect(original.status).toBe('error');
  expect(image.linkedSourceId).toBe(original.id);
});
test('取消正在抓取的链接不产生迟到来源', async ({ page }) => {
  await example(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route('**/api/exploration/fetch-url', async (route) => {
    entered();
    await held;
    await route
      .fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: '迟到网页',
          text: '迟到文字',
          normalizedUrl: 'https://example.com',
          fetchedAt: new Date().toISOString(),
          status: 'ready',
        }),
      })
      .catch(() => {});
  });
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '参考产品网址', exact: true }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com');
  await page.getByRole('button', { name: '保存资料并查看结果', exact: true }).click();
  await started;
  await page.getByRole('button', { name: '取消解析', exact: true }).click();
  release();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.explore-source-tile')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.explore-source-tile')).toHaveCount(1);
});
