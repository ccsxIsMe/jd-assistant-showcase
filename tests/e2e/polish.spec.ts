import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
async function openExample(page: Page, title = '简历证据核对', seed = '查看完成版') {
  await page.goto('/examples');
  await page
    .locator('.demo-module-grid section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button', { name: seed, exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/examples/);
  await expect(page.locator('.demo-ribbon')).toContainText('示例项目｜虚构材料｜预置分析结果');
}
async function saved(page: Page) {
  await expect(page.getByText('已保存到当前浏览器', { exact: true })).toBeVisible();
}
test('软件工程师完成版真实文件、简历证据定位、人工修正、重分析与版本保留', async ({ page }) => {
  await openExample(page);
  await expect(page.locator('.resume-requirements button')).toHaveCount(5);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.locator('.resume-citations button').first().click();
  await expect(page.locator('.resume-readable mark')).toContainText('独立完成');
  await page.getByRole('button', { name: '修正这条材料判断' }).click();
  await page.getByLabel('人工修正状态').selectOption('insufficient');
  await page.getByLabel('人工修正理由').fill('演示人工决定：需要补充一次报名验收材料。');
  await page.getByRole('button', { name: '保存人工修正' }).click();
  await expect(page.locator('.resume-human-note')).toContainText('需要补充');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并核对材料', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '核对报告已形成' })).toBeVisible();
  await expect(page.locator('.resume-human-note')).toContainText('需要补充');
  await saved(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /下载Markdown/ }).click();
  const file = await (await download).path();
  expect(await readFile(file!, 'utf8')).toContain('示例项目｜虚构材料｜预置分析结果');
  await page.reload();
  await expect(page.locator('.resume-human-note')).toContainText('需要补充');
  await mkdir('docs/screenshots/polish-after', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/polish-after/resume-evidence-1440.png',
    fullPage: true,
  });
});
test('已有JD短路径、本地DOCX/PDF入口、取消与错误保留', async ({ page }) => {
  await page.goto('/match');
  await page
    .getByLabel('岗位JD', { exact: true })
    .fill('负责活动页面与报名表单实现。\n能够完成名单查看及CSV文件导出。');
  await page.getByRole('button', { name: '整理这份JD的核对要求' }).click();
  await page
    .getByLabel('上传简历文件')
    .setInputFiles('public/demo/software-engineer/software-resume.docx');
  await expect(page.getByLabel('简历文本预览 / 直接粘贴')).toHaveValue(/独立完成问题列表/);
  await expect(page.getByRole('button', { name: '确认并核对材料', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并核对材料', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '核对报告已形成' })).toBeVisible();
  await saved(page);
  const url = page.url();
  expect(url).toContain('?review=');
  await page.reload();
  await expect(page.getByLabel('简历文本预览 / 直接粘贴')).toHaveValue(/独立完成/);
  await page.route('**/api/resume/review', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route
      .fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: '引用无法定位，请重试。',
          code: 'INVALID_REFERENCE',
          requestId: 'synthetic-invalid-reference',
        }),
      })
      .catch(() => {});
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并核对材料', exact: true }).click();
  await page.getByRole('button', { name: '取消核对', exact: true }).click();
  await expect(page.locator('.resume-error')).toContainText('已取消');
  await expect(page.getByLabel('简历文本预览 / 直接粘贴')).toHaveValue(/独立完成/);
  await page.waitForTimeout(1800);
  await expect(page.locator('.resume-error')).toContainText('已取消');
});
test('岗位编辑只提示标准更新，旧报告不改写；真实未启用错误保留材料', async ({ page }) => {
  await openExample(page);
  const reviewUrl = page.url();
  await page.getByRole('link', { name: '返回岗位标准与依据 ↗', exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  await page.getByRole('tab', { name: /岗位要求/ }).click();
  const card = page.getByTestId('item-requirement').first();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('新增人工核对条件：报名表单必须提供异常反馈验收样例。');
  await page.getByRole('button', { name: '保存为待复核内容', exact: true }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.goto(reviewUrl);
  await expect(page.locator('.resume-version-warning')).toContainText('岗位内容已有更新');
  await expect(page.getByTestId('resume-assessment')).not.toContainText('新增人工核对条件');
  await page.getByLabel('简历核对分析方式').selectOption('real');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '使用真实AI核对材料', exact: true }).click();
  await expect(page.locator('.resume-error')).toContainText('CONFIGURATION');
  await expect(page.locator('.resume-readable')).toContainText('独立完成问题列表');
  await expect(page.getByTestId('resume-assessment')).not.toContainText('新增人工核对条件');
  await page.screenshot({
    path: 'docs/screenshots/polish-after/resume-configuration-error.png',
    fullPage: true,
  });
});
