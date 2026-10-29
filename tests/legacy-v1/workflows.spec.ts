import { test, expect } from '@playwright/test';
import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const jd = '前端工程师，负责React页面开发与接口联调，具备TypeScript实践经验。';
test('页面与接口冒烟、输入拒绝与mock数据', async ({ request }) => {
  for (const url of ['/generate', '/optimize', '/match'])
    expect((await request.get(url)).status()).toBe(200);
  expect((await request.get('/api/status')).status()).toBe(200);
  expect((await request.post('/api/ai/recommend', { data: { title: '' } })).status()).toBe(422);
  expect(
    (await request.post('/api/ai/match', { data: { jd, resume: jd, consent: false } })).status(),
  ).toBe(422);
  expect((await request.post('/api/ai/unknown', { data: {} })).status()).toBe(404);
  expect(
    (
      await request.post('/api/ai/recommend', {
        data: Buffer.from('{'),
        headers: { 'Content-Type': 'application/json' },
      })
    ).status(),
  ).toBe(400);
  const res = await request.post('/api/ai/recommend', { data: { title: '前端工程师' } });
  expect((await res.json()).mode).toBe('mock');
});
test('生成：推荐、多选、补充、生成、复制和下载', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/generate');
  await page.getByLabel('职位名称 *', { exact: true }).fill('前端工程师');
  await page.getByRole('button', { name: '推荐职责与技能' }).click();
  await expect(page.getByText('负责前端工程师相关工作的计划与执行', { exact: true })).toBeVisible();
  await page.getByRole('checkbox').first().uncheck();
  await page.getByLabel('补充岗位职责', { exact: true }).fill('负责无障碍页面建设');
  await page.getByRole('button', { name: '添加岗位职责' }).click();
  await page.getByLabel('工作经验', { exact: true }).fill('3年以上');
  await page.getByRole('button', { name: '生成完整JD' }).click();
  const result = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '职位描述', exact: true }) });
  await expect(result.getByText('演示数据，非真实AI分析', { exact: true })).toBeVisible();
  await expect(result.getByText('负责无障碍页面建设', { exact: true })).toBeVisible();
  await expect(result.getByText('负责前端工程师相关工作的计划与执行', { exact: true })).toHaveCount(
    0,
  );
  await result.getByRole('button', { name: '复制', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '演示数据，非真实AI分析',
  );
  const downloadPromise = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载Markdown' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('职位描述.md');
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain('演示数据，非真实AI分析');
  expect(errors).toEqual([]);
});
test('优化：报告与正文分别展示导出，失败保留输入', async ({ page }) => {
  await page.goto('/optimize');
  await page.getByLabel('原始职位描述 *', { exact: true }).fill(jd);
  await page.getByRole('button', { name: '分析并优化JD' }).click();
  await expect(page.getByRole('heading', { name: 'JD分析报告', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '优化后的JD', exact: true })).toBeVisible();
  expect(await page.getByRole('button', { name: '下载Markdown' }).count()).toBe(2);
  await page.route('**/api/ai/optimize', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: '测试调用失败' }),
    }),
  );
  await page.getByRole('button', { name: '分析并优化JD' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('测试调用失败');
  await expect(page.getByLabel('原始职位描述 *', { exact: true })).toHaveValue(jd);
});
test('匹配：DOCX本地解析、预览编辑、确认与辅助评分', async ({ page }) => {
  await page.goto('/match');
  await page.getByLabel('目标职位JD *', { exact: true }).fill(jd);
  const buffer = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph('候选人具备React与TypeScript项目实践，参与前端页面开发和接口联调。'),
          ],
        },
      ],
    }),
  );
  await page.getByLabel('上传简历文件').setInputFiles({
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
  });
  await expect(page.getByLabel('简历文本预览 / 直接粘贴 *', { exact: true })).toHaveValue(
    /候选人具备React/,
  );
  await expect(page.getByRole('button', { name: '确认并分析匹配度' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page
    .getByLabel('简历文本预览 / 直接粘贴 *', { exact: true })
    .fill('候选人具备React项目经验，负责页面开发及接口联调。');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并分析匹配度' }).click();
  await expect(page.getByRole('heading', { name: '简历匹配分析报告', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: '待核实信息', exact: true })).toBeVisible();
});
test('PDF可提取、扫描件/损坏文件明确报错', async ({ page }) => {
  await page.goto('/match');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText('Resume: React TypeScript developer with frontend project experience.', { font });
  await page.getByLabel('上传简历文件').setInputFiles({
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel('简历文本预览 / 直接粘贴 *', { exact: true })).toHaveValue(
    /Resume: React/,
    { timeout: 20000 },
  );
  const empty = await PDFDocument.create();
  empty.addPage();
  await page.getByLabel('上传简历文件').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await empty.save()),
  });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('扫描件');
  await page.getByLabel('上传简历文件').setInputFiles({
    name: 'bad.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('broken'),
  });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('签名无效');
});
test('取消后可重试；移动端基本布局', async ({ page }) => {
  await page.goto('/optimize');
  await page.getByLabel('原始职位描述 *', { exact: true }).fill(jd);
  await page.route('**/api/ai/optimize', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.abort();
  });
  await page.getByRole('button', { name: '分析并优化JD' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('已取消');
  await expect(page.getByRole('button', { name: '分析并优化JD' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/generate', '/optimize', '/match']) {
    await page.goto(url);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
test('超时与不合法结构明确失败，Markdown原始HTML不执行', async ({ page }) => {
  await page.goto('/optimize');
  await page.getByLabel('原始职位描述 *', { exact: true }).fill(jd);
  await page.route('**/api/ai/optimize', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'mock', data: { strengths: [] } }),
    }),
  );
  await page.getByRole('button', { name: '分析并优化JD' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('结构不合法');
  await page.unroute('**/api/ai/optimize');
  await page.route('**/api/ai/optimize', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'mock',
        data: {
          strengths: ['原文信息明确'],
          weaknesses: ['需要核实职责细节'],
          suggestions: ['补充事实'],
          optimized:
            '# 安全展示\n\n<img src=x onerror="window.__injected=true">\n\n保留需要人工核实的岗位信息。',
        },
      }),
    }),
  );
  await page.getByRole('button', { name: '分析并优化JD' }).click();
  await expect(page.getByRole('heading', { name: '安全展示', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__injected'))).toBeUndefined();
  await expect(page.locator('.markdown img')).toHaveCount(0);
  await page.unroute('**/api/ai/optimize');
  await page.clock.install();
  await page.route('**/api/ai/optimize', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.abort();
  });
  await page.getByRole('button', { name: '分析并优化JD' }).click();
  await page.clock.fastForward(65001);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('超时');
});
test('流中断与流内错误不会发布成最终JD', async ({ page }) => {
  await page.goto('/generate');
  await page.getByLabel('职位名称 *', { exact: true }).fill('前端工程师');
  await page.getByRole('button', { name: '推荐职责与技能' }).click();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await page.route('**/api/ai/generate', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'X-AI-Mode': 'mock', 'Content-Type': 'application/x-ndjson' },
      body:
        JSON.stringify({
          type: 'delta',
          text: '这是一份尚未完成的职位描述，不能发布为最终结果。',
        }) + '\n',
    }),
  );
  await page.getByRole('button', { name: '生成完整JD' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('结果流中断');
  await expect(page.getByRole('button', { name: '下载Markdown' })).toHaveCount(0);
  await page.unroute('**/api/ai/generate');
  await page.route('**/api/ai/generate', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'X-AI-Mode': 'mock', 'Content-Type': 'application/x-ndjson' },
      body: JSON.stringify({ type: 'error', message: '模型生成失败，请重试。' }) + '\n',
    }),
  );
  await page.getByRole('button', { name: '生成完整JD' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('模型生成失败');
});
