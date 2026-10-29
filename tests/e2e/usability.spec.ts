import { seedLegacyWorkbench } from '../fixtures/legacy-browser';
import { test, expect, type Page } from '@playwright/test';
async function seed(page: Page, completed = false) {
  await page.goto('/');
  await seedLegacyWorkbench(page, completed);
  await expect(page).toHaveURL(/\/workspaces\//);
  if (!completed) {
    await page.getByRole('button', { name: '从资料整理', exact: true }).click();
    await expect(page.getByTestId('item-task')).toHaveCount(3);
  }
}

test('问题澄清不代替内容确认，确认自动保存且生成入口明显', async ({ page }) => {
  await seed(page);
  const task = page.getByTestId('item-task').first();
  const question = page.locator('.question-card').first();
  const direct = question.getByRole('button', { name: '直接补充想法', exact: true });
  if (await direct.count()) await direct.click();
  else if (await question.getByRole('radio', { name: '其他，请填写', exact: true }).count())
    await question.getByRole('radio', { name: '其他，请填写', exact: true }).check();
  await question
    .locator('textarea')
    .fill('测试中的人工回答：后端由现有团队负责，需要修改并确认关联条目。');
  await question.getByRole('button', { name: '保存这个决定' }).click();
  await expect(question).toHaveClass(/resolved/);
  await expect(task.locator('.item-status')).toContainText('待确认');
  await expect(page.getByRole('button', { name: '生成 JD 草稿', exact: true })).toBeDisabled();
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/workbench')) requests++;
  });
  await task.getByRole('button', { name: '确认', exact: true }).click();
  await expect(task.locator('.item-status')).toHaveText('已确认');
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.reload();
  await expect(page.getByTestId('item-task').first().locator('.item-status')).toHaveText('已确认');
  await expect(page.getByTestId('jd-block')).toHaveCount(0);
  await page.getByRole('button', { name: '生成 JD 草稿', exact: true }).click();
  await expect(page.getByTestId('jd-block').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '更新 JD', exact: true })).toBeVisible();
});

test('更新JD限定一个段落，先展示差异，采纳与撤销均保留其他正文', async ({ page }) => {
  await seed(page, true);
  await page.getByRole('tab', { name: '任务与要求', exact: true }).click();
  const task = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '订单页面建设', exact: true }) });
  await task.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('只完成订单列表前端页面及可访问性验收。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  await task.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('tab', { name: 'JD编辑', exact: true }).click();
  const blocks = page.getByTestId('jd-block');
  const original = await blocks
    .locator('textarea')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLTextAreaElement).value));
  const duties = blocks.filter({
    has: page.getByRole('heading', { name: '主要职责', exact: true }),
  });
  const originalDuties = await duties.locator('textarea').inputValue();
  await page.getByRole('button', { name: '更新 JD', exact: true }).click();
  await page.getByLabel('选择要更新的段落').selectOption({ label: '主要职责（需复核）' });
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/api/workbench') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: '生成更新建议' }).click();
  expect((await request).postDataJSON().scope).toBe('selected');
  await expect(page.getByTestId('suggestion-card')).toHaveCount(1);
  await expect(duties.locator('textarea')).toHaveValue(originalDuties);
  await page
    .getByTestId('suggestion-card')
    .getByRole('button', { name: '应用本条', exact: true })
    .click();
  await expect(duties.locator('textarea')).toHaveValue(/可访问性验收/);
  const after = await blocks
    .locator('textarea')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLTextAreaElement).value));
  expect(after.filter((text, index) => text !== original[index])).toHaveLength(1);
  await page.getByRole('button', { name: '撤销最近一次AI应用', exact: true }).click();
  await expect(duties.locator('textarea')).toHaveValue(originalDuties);
});

test('两侧拖拽、键盘、折叠及刷新记忆；正文放大且手机无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page, true);
  const left = page.getByRole('separator', { name: '调整资料栏宽度' });
  const right = page.getByRole('separator', { name: '调整助手栏宽度' });
  const leftBox = (await left.boundingBox())!;
  await page.mouse.move(leftBox.x + 5, leftBox.y + 130);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 85, leftBox.y + 130, { steps: 8 });
  await page.mouse.up();
  await expect(left).toHaveAttribute('aria-valuenow', '320');
  const rightBox = (await right.boundingBox())!;
  await page.mouse.move(rightBox.x + 5, rightBox.y + 130);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 75, rightBox.y + 130, { steps: 8 });
  await page.mouse.up();
  await expect(right).toHaveAttribute('aria-valuenow', '420');
  await right.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuenow', '444');
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(left).toHaveAttribute('aria-valuenow', '320');
  await expect(right).toHaveAttribute('aria-valuenow', '444');
  await page.getByRole('button', { name: '收起资料', exact: true }).click();
  await expect(left).toBeHidden();
  await page.getByRole('button', { name: '展开资料', exact: true }).click();
  await expect(left).toHaveAttribute('aria-valuenow', '320');
  await left.focus();
  await page.keyboard.press('Home');
  await right.focus();
  await page.keyboard.press('Home');
  await page.getByRole('tab', { name: '任务与要求', exact: true }).click();
  expect(
    await page
      .getByTestId('item-task')
      .first()
      .locator('.object-main > p')
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.locator('.source-tile').first().click();
  expect(
    await page
      .locator('.source-original')
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: 'test-results/workspace-readable-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(left).toBeHidden();
  await expect(right).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '共创助手', exact: true }).click();
  await expect(page.locator('.review-pane')).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-readable-mobile.png' });
});

test('局部建议502显示编号，可用当前编辑重试且保留意图与人工内容', async ({ page }) => {
  await seed(page);
  const task = page.getByTestId('item-task').first();
  await task.getByRole('button', { name: '局部共创', exact: true }).click();
  await page
    .getByLabel('这一次，你想调整什么？')
    .fill('只负责前端页面和接口接入，不负责后端数据库。');
  let failed = false;
  await page.route('**/api/workbench', (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: '服务器未收到DeepSeek响应，已有编辑保留。',
          code: 'NETWORK',
          requestId: 'fixed-test-request-502',
        }),
      });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '生成局部修改建议', exact: true }).click();
  await expect(page.locator('.center-ai-error')).toContainText('fixed-test-request-502');
  await expect(page.getByLabel('这一次，你想调整什么？')).toHaveValue(
    '只负责前端页面和接口接入，不负责后端数据库。',
  );
  await task.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('失败后继续输入的人工交付，不得丢失。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  const retried = page.waitForRequest(
    (r) => r.url().endsWith('/api/workbench') && r.method() === 'POST',
  );
  await page.locator('.center-ai-error').getByRole('button', { name: '重试本次操作' }).click();
  const body = (await retried).postDataJSON();
  expect(
    body.context.items.some(
      (i: { text: string }) => i.text === '失败后继续输入的人工交付，不得丢失。',
    ),
  ).toBe(true);
  await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
  await expect(task.locator('.object-main')).toContainText('失败后继续输入的人工交付，不得丢失。');
});
