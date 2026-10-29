import { seedLegacyWorkbench } from '../fixtures/legacy-browser';
import { test, expect, type Page } from '@playwright/test';
async function example(page: Page) {
  await page.goto('/');
  await seedLegacyWorkbench(page);
  await expect(page).toHaveURL(/\/workspaces\//);
  const guide = page.getByRole('complementary', { name: '岗位交互教程' });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: '跳过教程', exact: true }).click();
  await page.getByRole('button', { name: '从资料整理', exact: true }).click();
  await expect(page.getByTestId('item-task')).toHaveCount(3);
}
async function selectTask(page: Page, title: string) {
  const card = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .click();
  return card;
}
test('岗位新建、人工资料/任务、刷新恢复与岗位隔离', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '创建岗位', exact: true }).first().click();
  await page.getByLabel('岗位名称', { exact: true }).fill('人工创建的实施工程师岗位');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  const url = page.url();
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByLabel('资料标题', { exact: true }).fill('负责人会议原文');
  await page.getByLabel('来源人物或渠道', { exact: true }).fill('用户录入会议记录');
  await page
    .getByLabel('原文（保存后通过新版本修订）', { exact: true })
    .fill('本岗位负责客户系统部署和使用培训，不负责产品研发。');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByRole('button', { name: '新增任务', exact: true }).click();
  await page.getByLabel('名称 / 标题', { exact: true }).fill('客户系统部署');
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('完成客户系统部署与使用培训。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  await expect(page.getByTestId('item-task')).toHaveCount(1);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '客户系统部署', exact: true })).toBeVisible();
  await expect(page.getByText('负责人会议原文', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回岗位列表' }).click();
  await seedLegacyWorkbench(page);
  expect(page.url()).not.toBe(url);
  await expect(page.getByTestId('item-task')).toHaveCount(0);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '客户系统部署', exact: true })).toBeVisible();
});
test('完整示例：引用定位、人工范围、选择采纳、锁定、JD与版本导出', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await example(page);
  const pages = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '订单页面建设', exact: true }) });
  await expect(pages.locator('.item-status')).toBeVisible();
  await pages.getByRole('button', { name: /查看依据/ }).click();
  await expect(page.locator('.source-highlight')).toHaveText(
    '我们要做一个内部订单管理系统，需要完成订单列表、订单详情和基础操作页面。',
  );
  await pages.getByRole('button', { name: '确认', exact: true }).click();
  const api = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '接口接入与联调', exact: true }) });
  await api.getByRole('button', { name: '确认', exact: true }).click();
  const database = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '独立后端与数据库开发', exact: true }) });
  await database.locator('summary').click();
  await database.getByRole('button', { name: '排除本项' }).click();
  await page.getByRole('button', { name: '补充演示技术栈' }).click();
  await page.getByRole('tab', { name: /岗位要求/ }).click();
  const framework = page
    .getByTestId('item-requirement')
    .filter({ has: page.getByRole('heading', { name: 'Vue与React技术栈要求', exact: true }) });
  await framework.getByRole('button', { name: '局部共创' }).click();
  await page
    .getByLabel('这一次，你想调整什么？')
    .fill('当前项目使用React和TypeScript，Vue不是必备条件。');
  const original = await framework.locator('.object-main').textContent();
  await page.getByRole('button', { name: '生成局部修改建议' }).click();
  await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
  expect(await framework.locator('.object-main').textContent()).toBe(original);
  const specific = page
    .getByTestId('suggestion-card')
    .filter({ has: page.getByRole('heading', { name: 'Vue与React技术栈要求', exact: true }) });
  await specific.getByRole('button', { name: '应用本条', exact: true }).click();
  const react = page
    .getByTestId('item-requirement')
    .filter({ has: page.getByRole('heading', { name: 'React与TypeScript开发能力', exact: true }) });
  await expect(react).toBeVisible();
  await react.getByRole('button', { name: '确认', exact: true }).click();
  await react.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(react.getByText('已锁定', { exact: true })).toBeVisible();
  const dbReq = page
    .getByTestId('item-requirement')
    .filter({ has: page.getByRole('heading', { name: '独立数据库设计能力', exact: true }) });
  await expect(dbReq.locator('.item-status')).toBeVisible();
  await dbReq.locator('summary').click();
  await dbReq.getByRole('button', { name: '排除本项' }).click();
  const communication = page
    .getByTestId('item-requirement')
    .filter({ has: page.getByRole('heading', { name: '前后端协作与接口联调能力', exact: true }) });
  await communication.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('tab', { name: 'JD编辑', exact: true }).click();
  await page.getByRole('button', { name: '从确认内容生成JD草稿' }).click();
  await expect(page.getByTestId('jd-block')).toHaveCount(3);
  for (const block of await page.getByTestId('jd-block').all())
    await block.getByRole('button', { name: '确认段落', exact: true }).click();
  await page.getByRole('tab', { name: /问题澄清/ }).click();
  for (const q of await page.locator('.question-card').all()) {
    if (!(await q.locator('.decision-input').isVisible()))
      await q.locator('.question-title').click();
    await expect(q.locator('.decision-input')).toBeVisible();
    const direct = q.getByRole('button', { name: '直接补充想法', exact: true });
    if (await direct.count()) await direct.click();
    else if (await q.getByRole('radio', { name: '其他，请填写', exact: true }).count())
      await q.getByRole('radio', { name: '其他，请填写', exact: true }).check();
    const textarea = q.locator('textarea');
    await textarea.fill('本地操作者决定：按补充资料确认前端范围和React技术栈；后端数据库不纳入。');
    await q.getByRole('button', { name: '保存这个决定' }).click();
  }
  await page.getByRole('button', { name: '版本', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存确认版本' })).toBeDisabled();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  // A real answer change requires the affected items/JD to be reviewed again.
  await page.getByRole('tab', { name: '任务与要求', exact: true }).click();
  for (const type of ['岗位任务', '岗位要求']) {
    await page.getByRole('tab', { name: new RegExp(type) }).click();
    for (const item of await page
      .getByTestId(type === '岗位任务' ? 'item-task' : 'item-requirement')
      .all()) {
      const confirm = item.getByRole('button', { name: '确认', exact: true });
      if ((await confirm.count()) && (await confirm.isVisible())) {
        const unlock = item.getByRole('button', { name: '解锁', exact: true });
        const wasLocked = (await unlock.count()) > 0;
        if (wasLocked) await unlock.click();
        if (await confirm.isEnabled()) await confirm.click();
        if (wasLocked) await item.getByRole('button', { name: '锁定', exact: true }).click();
      }
    }
  }
  await page.getByRole('tab', { name: 'JD编辑', exact: true }).click();
  for (const block of await page.getByTestId('jd-block').all())
    await block.getByRole('button', { name: '确认段落', exact: true }).click();
  await page.getByRole('button', { name: '版本', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存确认版本' })).toBeEnabled();
  await page.getByRole('button', { name: '保存确认版本' }).click();
  await expect(page.getByRole('button', { name: /确认版本 1/ })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '导出JD', exact: true }).click();
  await page.getByRole('button', { name: '复制JD正文' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('React和TypeScript');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载Markdown' }).click();
  const file = await download;
  const stream = await file.createReadStream();
  let text = '';
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain('虚构示例');
  expect(text).not.toContain('sourceId');
  expect(text).not.toContain('五险一金');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.workspace-topbar')).toBeHidden();
  await expect(page.locator('.print-document')).toBeVisible();
  expect(errors).toEqual([]);
});
test('局部编辑、迟到结果过期、真实模式失败仍可人工工作', async ({ page }) => {
  await example(page);
  const card = await selectTask(page, '订单页面建设');
  await card.getByRole('button', { name: '局部共创' }).click();
  await page
    .getByLabel('这一次，你想调整什么？')
    .fill('只负责前端页面和接口接入，不负责后端与数据库。');
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/workbench', async (route) => {
    const response = await route.fetch();
    await wait;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '生成局部修改建议' }).click();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('AI请求期间人工修改的新工作内容，不能覆盖。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  release();
  await expect(
    page.getByTestId('suggestion-card').first().getByText('已过期', { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText('AI请求期间人工修改的新工作内容');
  await page.unroute('**/api/workbench');
  await page
    .getByRole('button', { name: /内部订单管理系统前端工程师/ })
    .first()
    .click();
  await page.getByRole('combobox', { name: 'AI协作方式', exact: true }).selectOption('real');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByLabel('这一次，你想调整什么？').fill('按新的前端范围精简');
  await page.getByRole('button', { name: '生成局部修改建议' }).click();
  await expect(page.locator('.center-ai-error')).toContainText('真实模型未启用');
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('模型不可用时仍然可以手动修改并保存。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
});
test('完整示例布局、窄屏抽屉替代、弹窗Esc与打印', async ({ page }) => {
  await page.goto('/');
  await seedLegacyWorkbench(page, true);
  await expect(page).toHaveURL(/\/workspaces\//);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.workspace-root')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/workbench-${viewport.width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '资料', exact: true }).click();
  await expect(page.locator('.sources-pane')).toBeVisible();
  await page.getByRole('button', { name: '共创助手', exact: true }).click();
  await expect(page.locator('.review-pane')).toBeVisible();
  await page.getByRole('button', { name: '导出JD', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出JD', exact: true })).toBeFocused();
});
