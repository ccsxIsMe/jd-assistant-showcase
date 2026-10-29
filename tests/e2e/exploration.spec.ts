import { seedLegacyClassic } from '../fixtures/legacy-classic';
import { test, expect, type Page, type Download } from '@playwright/test';
import { newWorkspace } from '../../src/lib/workbench/model';
import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream!) text += chunk.toString();
  return text;
}
async function example(page: Page) {
  await page.goto('/explore?view=classic');
  await seedLegacyClassic(page);
  await expect(page).toHaveURL(/\/explore\/[^/?]+/);
  await expect(page.locator('.evidence-paragraph').first()).toBeVisible();
}
async function analyze(page: Page) {
  await page.getByRole('checkbox', { name: '确认分析资料范围' }).check();
  await page.getByRole('button', { name: '开始产品需求分析', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '审阅产品分析草案' })).toBeVisible();
  await page.getByRole('button', { name: '采纳所选，进入人工确认' }).click();
  await expect(page.getByTestId('explore-finding').first()).toBeVisible();
}
async function confirmMinimum(page: Page) {
  await page
    .getByTestId('explore-finding')
    .first()
    .getByRole('button', { name: '确认内容', exact: true })
    .click();
  await page.getByRole('button', { name: '产品概览', exact: true }).click();
  await page.getByRole('button', { name: '确认产品概览', exact: true }).click();
}
async function snapshot(page: Page) {
  await page.getByRole('button', { name: '保存快照', exact: true }).click();
  await page.getByRole('button', { name: '保存已确认快照', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
}

test('探索确认、证据跳转、快照导出及显式导入岗位，模块数据隔离', async ({ page }) => {
  await example(page);
  await analyze(page);
  const first = page.getByTestId('explore-finding').first();
  await expect(first.locator('.finding-status')).toHaveText('待确认');
  await first.locator('.finding-evidence-links button').first().click();
  await expect(page.locator('.evidence-paragraph.highlighted mark')).toBeVisible();
  await page.getByRole('button', { name: '功能清单', exact: true }).click();
  await confirmMinimum(page);
  await snapshot(page);
  const jobsBefore = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<number>((resolve) => {
      const r = db.transaction('workspaces').objectStore('workspaces').count();
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  });
  expect(jobsBefore).toBe(0);
  await page.getByRole('link', { name: '研究历史', exact: true }).click();
  await page.locator('.snapshot-history-list [data-snapshot-link]').first().click();
  await expect(page.getByRole('button', { name: '导入岗位工作台', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出JSON快照', exact: true }).click();
  const exported = await downloadText(await download);
  expect(JSON.parse(exported).snapshot.kind).toBe('confirmed');
  const mdDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载Markdown', exact: true }).click();
  expect(await downloadText(await mdDownload)).toContain('演示数据，非真实AI分析');
  await page.getByRole('button', { name: '导入岗位工作台', exact: true }).click();
  await page.getByLabel('快照目标岗位名称').fill('探索导入的前端岗位');
  await page.getByRole('button', { name: '确认添加为岗位资料', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  await expect(page.getByTestId('item-task')).toHaveCount(1);
  await expect(page.getByTestId('item-task').locator('.item-status')).toContainText('待确认');
  await page.getByRole('tab', { name: /岗位要求/ }).click();
  await expect(page.getByTestId('item-requirement')).toHaveCount(1);
  await expect(page.getByTestId('item-requirement').locator('.item-status')).toContainText(
    '待确认',
  );
  await page.locator('.source-tile').first().click();
  await expect(page.locator('.snapshot-origin-note')).toContainText('演示数据，非真实AI分析');
  await expect(page.locator('.snapshot-origin-note a')).toBeVisible();
});

test('探索快照比较、完整项目导入为副本，已有编辑与历史保留', async ({ page }) => {
  await example(page);
  const originalURL = page.url();
  await analyze(page);
  await confirmMinimum(page);
  await snapshot(page);
  await page.getByRole('button', { name: '功能清单', exact: true }).click();
  const first = page.getByTestId('explore-finding').first();
  await first.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('需求说明', { exact: true })
    .fill('人工新增：导出前必须确认内容，保留实时预览。');
  await page.getByRole('button', { name: '保存结论，等待确认' }).click();
  await first.getByRole('button', { name: '确认内容', exact: true }).click();
  await snapshot(page);
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const content = await downloadText(await backup);
  await page.getByRole('link', { name: '研究历史', exact: true }).click();
  await page.locator('.snapshot-history-list [data-snapshot-link]').first().click();
  await page.getByLabel('选择比较快照').selectOption({ label: 'V1 · 已确认' });
  await expect(page.getByTestId('snapshot-diff')).toContainText('修改 1 项');
  await expect(page.getByTestId('snapshot-diff')).toContainText('人工新增');
  await page.goto('/explore?view=classic');
  await page.getByLabel('导入探索项目或快照').setInputFiles({
    name: '探索备份.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  await expect(page).toHaveURL(/\/explore\/[^/?]+/);
  expect(page.url()).not.toBe(originalURL);
  await expect(page.locator('.explore-workspace-title')).toContainText('导入副本');
  await page.getByRole('button', { name: '功能清单', exact: true }).click();
  await expect(page.getByTestId('explore-finding').first()).toContainText('人工新增');
  await page.goto(originalURL);
  await page.getByRole('button', { name: '功能清单', exact: true }).click();
  await expect(page.getByTestId('explore-finding').first()).toContainText('人工新增');
});

test('图片原件、本地区域标注、缩放记忆及删除标注', async ({ page }) => {
  await example(page);
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e9eefc';
    ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = '#7963b5';
    ctx.fillRect(300, 50, 300, 300);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: '产品参考.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果' }).click();
  await expect(page.getByTestId('annotation-canvas')).toBeVisible();
  await page.getByRole('button', { name: '放大证据', exact: true }).click();
  await expect(page.getByLabel('证据缩放比例')).toHaveText('125%');
  await page.getByRole('button', { name: '缩小证据', exact: true }).click();
  await page.getByRole('button', { name: '返回原始位置', exact: true }).click();
  await expect(page.getByLabel('证据缩放比例')).toHaveText('100%');
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(page.getByTestId('annotation-canvas')).toBeHidden();
  await page.getByRole('button', { name: '重新打开预览', exact: true }).click();
  const box = (await page.getByTestId('annotation-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await page.getByLabel('区域说明', { exact: true }).fill('右侧紫色区域为用户标注的预览区域。');
  await page.getByRole('button', { name: '保存区域证据', exact: true }).click();
  await expect(page.locator('.annotate-image svg rect')).toHaveCount(1);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.annotate-image svg rect')).toHaveCount(1);
  await expect(page.locator('.annotate-image svg rect')).toHaveAttribute('x', /19[89]|20[01]/);
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect(page.locator('.annotate-image svg rect')).toHaveAttribute('width', /49[89]|50[01]/);
  await page.getByRole('button', { name: '编辑选中标注', exact: true }).click();
  await page.getByLabel('标注宽度百分比').fill('40');
  await page.getByRole('button', { name: '保存标注修改', exact: true }).click();
  await expect(page.locator('.annotate-image svg rect')).toHaveCount(1);
  await expect(page.locator('.annotate-image svg rect')).toHaveAttribute('width', '400');
  await page
    .locator('.explore-evidence-card')
    .filter({ hasText: '右侧紫色区域' })
    .getByRole('button', { name: '删除区域标注', exact: true })
    .click();
  await expect(page.locator('.annotate-image svg rect')).toHaveCount(0);
});

test('文档逐页预览与解析失败明确，网页正文和借鉴边界可追溯', async ({ page }) => {
  await example(page);
  await page.route('**/api/exploration/fetch-url', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: '公开原型产品（测试）',
        text: '这个产品可以实时预览、导出文件，还提供支付与社区。',
        description: '受控公开页测试内容',
        originalUrl: 'https://example.com',
        normalizedUrl: 'https://example.com/',
        fetchedAt: '2026-10-24T10:00:00Z',
        status: 'ready',
        warning: '',
        screenshotStatus: 'not-available',
      }),
    }),
  );
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '参考产品网址', exact: true }).click();
  await page.getByLabel('公开产品网址').fill('https://example.com');
  await page.getByLabel('想借鉴的功能').fill('实时预览与文件导出');
  await page.getByLabel('不借鉴的部分').fill('支付、社区');
  await page.getByRole('button', { name: '保存资料并查看结果' }).click();
  await expect(page.locator('.explore-url-meta')).toContainText('未获取网页截图');
  await expect(page.locator('.extracted-paragraphs')).toContainText('明确不借鉴：支付、社区');
  await page.getByRole('button', { name: '修订文字与用途', exact: true }).click();
  await page
    .getByLabel('可编辑文本预览', { exact: true })
    .fill('人工补充：只参考文件导出，不复制整个产品。');
  await page.getByRole('button', { name: '保存来源新版本', exact: true }).click();
  await expect(page.locator('.explore-source-viewer')).toContainText('不作为程序抓取原文');
  await expect(page.locator('.evidence-paragraph').first()).toContainText('用户提供文字');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Product requirements: export files and preview content.', {
    x: 50,
    y: 700,
    size: 16,
    font,
  });
  const pdfBytes = Buffer.from(await pdf.save());
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  await page
    .getByLabel('参考文件', { exact: true })
    .setInputFiles({ name: 'requirements.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
  await page.getByRole('button', { name: '保存资料并查看结果' }).click();
  await expect(page.locator('.pdf-evidence')).toContainText('第 1 / 1 页');
  await expect(page.getByTestId('annotation-canvas')).toBeVisible();
  await expect(page.locator('.extracted-paragraphs')).toContainText('Product requirements');
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'damaged.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-corrupted'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果' }).click();
  await expect(page.locator('.explore-source-viewer')).toContainText('解析失败');
  await expect(page.locator('.explore-source-viewer')).toContainText('损坏');
  const docx = await Packer.toBuffer(
    new Document({
      sections: [
        { children: [new Paragraph('产品需要支持内容实时预览和文件导出，由用户确认协作范围。')] },
      ],
    }),
  );
  await page.getByLabel('替换当前来源文件').setInputFiles({
    name: 'corrected.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx,
  });
  await expect(page.locator('.explore-source-viewer > header')).toContainText('解析完成');
  await expect(page.locator('.extracted-paragraphs')).toContainText('由用户确认协作范围');
});

test('MP4实际播放、手动关键帧和时间点可定位', async ({ page }) => {
  await example(page);
  const video = await page.evaluate(async () => {
    const mime = ['video/mp4;codecs=avc1.42001E', 'video/mp4'].find((mime) =>
      MediaRecorder.isTypeSupported(mime),
    );
    if (!mime) throw new Error('本机Edge不支持生成MP4测试样本');
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d')!;
    // Give the capture track a real first frame before starting the encoder.
    context.fillStyle = '#434e80';
    context.fillRect(0, 0, 320, 180);
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const complete = new Promise<string>((resolve) => {
      recorder.onstop = () => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(new Blob(chunks, { type: 'video/mp4' }));
        stream.getTracks().forEach((track) => track.stop());
      };
    });
    recorder.start();
    context.fillStyle = '#8171bf';
    context.fillRect(0, 0, 320, 180);
    let frame = 0;
    const tick = setInterval(() => {
      context.fillStyle = frame++ < 6 ? '#434e80' : '#8171bf';
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = '#fff';
      context.fillText('Product preview ' + frame, 40, 80);
    }, 80);
    setTimeout(() => {
      clearInterval(tick);
      recorder.stop();
    }, 1800);
    return complete;
  });
  expect(
    Buffer.from(video, 'base64').byteLength,
    'MediaRecorder应生成实际非空MP4样本',
  ).toBeGreaterThan(100);
  await page.getByRole('button', { name: '添加探索资料', exact: true }).click();
  await page.getByRole('button', { name: '上传材料', exact: true }).click();
  await page.getByLabel('参考文件', { exact: true }).setInputFiles({
    name: 'product-preview.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(video, 'base64'),
  });
  await page.getByRole('button', { name: '保存资料并查看结果' }).click();
  await expect(page.locator('.video-evidence video')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.video-evidence video').evaluate((v) => (v as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByLabel('关键帧说明').fill('用户观察：此帧呈现内容预览区域。');
  await page.getByRole('button', { name: '保存当前关键帧', exact: true }).click();
  await expect(page.locator('.video-frame-list button')).toHaveCount(1);
  await page.locator('.video-frame-list button').first().click();
  await expect(page.getByTestId('annotation-canvas')).toBeVisible();
  await page.getByLabel('标注左侧百分比').fill('10');
  await page.getByLabel('标注顶部百分比').fill('10');
  await page.getByLabel('标注宽度百分比').fill('50');
  await page.getByLabel('标注高度百分比').fill('50');
  await page.getByLabel('区域说明', { exact: true }).fill('实际关键帧中的预览区域，人工矩形标注。');
  await page.getByRole('button', { name: '保存区域证据', exact: true }).click();
  await expect(
    page.locator('.explore-evidence-card').filter({ hasText: '实际关键帧中的预览区域' }),
  ).toBeVisible();
});

test('旧数据库升级保留岗位，真实模式失败保留探索编辑，窄屏可确认', async ({ page }) => {
  const legacy = newWorkspace('升级前已保存的岗位');
  await page.goto('/settings/ai');
  await page.evaluate(async (workspace) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('workspaces', { keyPath: 'id' });
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction('workspaces', 'readwrite');
        tx.objectStore('workspaces').put(workspace);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(new Error('fixture failed'));
      };
    });
  }, legacy);
  await example(page);
  await page.getByRole('button', { name: '产品概览', exact: true }).click();
  await page.getByLabel('产品目标', { exact: true }).fill('人工编辑的目标，即使AI失败也必须保留。');
  await page.getByLabel('产品探索分析模式').selectOption('real');
  await page.getByRole('checkbox', { name: '确认分析资料范围' }).check();
  await page.getByRole('button', { name: '开始产品需求分析', exact: true }).click();
  await expect(page.locator('.center-ai-error')).toContainText('真实模型未启用');
  await expect(page.getByLabel('产品目标', { exact: true })).toHaveValue(
    '人工编辑的目标，即使AI失败也必须保留。',
  );
  await page.getByLabel('产品探索分析模式').selectOption('example');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '确认产品概览', exact: true }).click();
  await expect(page.locator('.explore-overview')).toContainText('已确认');
  await page.getByRole('button', { name: '分析与确认', exact: true }).click();
  await expect(page.locator('.explore-assistant')).toBeVisible();
  await page.screenshot({ path: 'test-results/explore-mobile.png' });
  await page.goto(`/workspaces/${legacy.id}`);
  await expect(page.locator('.workspace-title')).toHaveText('升级前已保存的岗位');
});

test('公开解析接口拒绝私网及不合法分析输入', async ({ request }) => {
  const privateResult = await request.post('/api/exploration/fetch-url', {
    data: { url: 'http://169.254.169.254/latest/meta-data/' },
  });
  expect(privateResult.status()).toBe(422);
  expect((await privateResult.json()).error).toContain('禁止');
  expect(
    (
      await request.post('/api/exploration/analyze', {
        data: { projectId: 'test', consent: false },
      })
    ).status(),
  ).toBe(422);
});
