import { seedLegacyClassic } from '../fixtures/legacy-classic';
import { expect, test } from '@playwright/test';
test('探索422展示精确规则与字段，重试保留人工编辑，采纳前不改需求', async ({ page }) => {
  await page.goto('/explore?view=classic');
  await seedLegacyClassic(page);
  await page.getByRole('button', { name: '产品概览', exact: true }).click();
  const goal = page.getByLabel('产品目标', { exact: true });
  await goal.fill('校验失败后必须保留的人工目标');
  let calls = 0;
  await page.route('**/api/exploration/analyze', async (route) => {
    calls++;
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '分析结果经过一次修复仍未通过校验；已有编辑保留。',
        code: 'INVALID_FORMAT',
        requestId: 'fixed-validation-request',
        validationIssues: [
          {
            code: 'EXPLICIT_EVIDENCE',
            path: 'findings[0].basis',
            message: '网页观察不能替代用户决定。',
          },
        ],
        attempts: 2,
      }),
    });
  });
  await page.getByRole('checkbox', { name: '确认分析资料范围' }).check();
  await page.getByRole('button', { name: '开始产品需求分析', exact: true }).click();
  const error = page.locator('.center-ai-error');
  await expect(error).toContainText('findings[0].basis');
  await expect(error).toContainText('网页观察不能替代用户决定');
  await expect(error).toContainText('EXPLICIT_EVIDENCE');
  await expect(error).toContainText('fixed-validation-request');
  await expect(goal).toHaveValue('校验失败后必须保留的人工目标');
  await error.getByRole('button', { name: '重试本次操作', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(goal).toHaveValue('校验失败后必须保留的人工目标');
  await page.reload();
  await expect(goal).toHaveValue('校验失败后必须保留的人工目标');
});
