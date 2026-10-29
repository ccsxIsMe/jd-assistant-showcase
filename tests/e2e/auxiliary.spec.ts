import { test, expect } from '@playwright/test';
import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const jd = '前端工程师，负责React页面开发与接口联调，具备TypeScript实践经验。';
test('页面、兼容入口、旧AI接口与工作台接口边界', async ({ request }) => {
  for (const path of ['/', '/generate', '/optimize', '/match'])
    expect((await request.get(path)).status()).toBe(200);
  expect((await request.post('/api/ai/recommend', { data: { title: '' } })).status()).toBe(422);
  expect(
    (await request.post('/api/ai/match', { data: { jd, resume: jd, consent: false } })).status(),
  ).toBe(422);
  expect(
    (
      await request.post('/api/ai/recommend', {
        data: Buffer.from('{'),
        headers: { 'Content-Type': 'application/json' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await request.post('/api/workbench', { data: { action: 'execute-code' } })).status(),
  ).toBe(422);
  const res = await request.post('/api/ai/recommend', { data: { title: '前端工程师' } });
  expect((await res.json()).mode).toBe('mock');
});
test('辅助简历匹配仍可解析DOCX、编辑、主动确认与下载', async ({ page }) => {
  await page.goto('/match');
  await page.getByLabel('岗位JD', { exact: true }).fill(jd);
  await page.getByRole('button', { name: '整理这份JD的核对要求' }).click();
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
  await expect(page.getByLabel('简历文本预览 / 直接粘贴', { exact: true })).toHaveValue(
    /候选人具备React/,
  );
  await expect(page.getByRole('button', { name: '确认并核对材料' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page
    .getByLabel('简历文本预览 / 直接粘贴', { exact: true })
    .fill('候选人具备React项目经验，负责页面开发及接口联调。');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并核对材料' }).click();
  await expect(page.getByRole('heading', { name: '本次岗位要求', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText('简历未体现，待核实；没有绘制虚构高亮。')).toBeVisible();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载Markdown' }).click();
  expect((await promise).suggestedFilename()).toContain('简历证据核对');
});
test('PDF实际解析、无文字/损坏文件提示', async ({ page }) => {
  await page.goto('/match');
  await page.getByLabel('岗位JD', { exact: true }).fill(jd);
  await page.getByRole('button', { name: '整理这份JD的核对要求' }).click();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText('Resume: React TypeScript developer with frontend experience.', { font, size: 12 });
  await page.getByLabel('上传简历文件').setInputFiles({
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByLabel('简历文本预览 / 直接粘贴', { exact: true })).toHaveValue(
    /Resume: React/,
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
