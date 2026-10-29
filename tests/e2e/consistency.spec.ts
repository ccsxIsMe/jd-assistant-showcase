import { seedLegacyWorkbench } from '../fixtures/legacy-browser';
import { test, expect, type Page } from '@playwright/test';
test('拖拽与上移替代操作，人工编辑可关联可验证原文', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const task = await seed(page);
  const other = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '接口接入与联调', exact: true }) });
  await page.evaluate(() => {
    const events: unknown[] = [];
    Reflect.set(window, 'nativeDragDiagnostics', events);
    for (const kind of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'dragstart',
      'dragenter',
      'dragover',
      'drop',
      'dragend',
    ])
      document.addEventListener(
        kind,
        (event) => {
          const e = event as DragEvent;
          events.push({
            kind,
            target: (e.target as HTMLElement).closest('[data-testid]')?.getAttribute('data-testid'),
            label: (e.target as HTMLElement).closest('button')?.getAttribute('aria-label'),
            x: e.clientX,
            y: e.clientY,
          });
        },
        true,
      );
  });
  await other
    .locator('.drag-handle')
    .dragTo(task.locator('.object-title'), { targetPosition: { x: 100, y: 12 } });
  await test.info().attach('native-drag-events', {
    body: JSON.stringify(await page.evaluate(() => Reflect.get(window, 'nativeDragDiagnostics'))),
    contentType: 'application/json',
  });
  await expect(page.getByTestId('item-task').first()).toContainText('接口接入与联调');
  await task.locator('summary').click();
  await task.getByRole('button', { name: '上移', exact: true }).click();
  await expect(page.getByTestId('item-task').first()).toContainText('订单页面建设');
  await page.keyboard.press('Escape');
  await task.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('关联资料', { exact: true }).selectOption({ label: '项目负责人说明 · v1' });
  await page
    .getByLabel('引用原文片段', { exact: true })
    .fill('需要完成订单列表、订单详情和基础操作页面。');
  await page.getByRole('button', { name: '添加可验证引用' }).click();
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  await expect(task.getByRole('button', { name: /查看依据/ })).toHaveCount(2);
  await task
    .getByRole('button', { name: /查看依据/ })
    .last()
    .click();
  await expect(page.locator('.source-highlight')).toHaveText(
    '需要完成订单列表、订单详情和基础操作页面。',
  );
});
test('必要关联组实际应用，完整备份导入为副本且原岗位保留', async ({ page }) => {
  await page.goto('/');
  await seedLegacyWorkbench(page, true);
  await expect(page).toHaveURL(/\/workspaces\//);
  const originalURL = page.url();
  await page.getByRole('tab', { name: '任务与要求', exact: true }).click();
  const task = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '订单页面建设', exact: true }) });
  await task.getByRole('button', { name: '局部共创' }).click();
  await page
    .getByLabel('这一次，你想调整什么？')
    .fill('一起同步前端职责与关联要求，React和TypeScript，岗位不负责后端与数据库。');
  await page.getByRole('button', { name: '生成局部修改建议' }).click();
  const group = page.getByTestId('suggestion-card').filter({ hasText: '必要关联建议组' });
  await expect(group).toHaveCount(1);
  await group.getByRole('button', { name: '应用整组', exact: true }).click();
  await expect(group).toContainText('已应用到草稿');
  await expect(task.locator('.item-status')).toContainText('需复核');
  await page.getByLabel('工作区更多操作').click();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整岗位备份', exact: true }).click();
  const file = await promise;
  const path = await file.path();
  expect(path).toBeTruthy();
  await page.getByRole('link', { name: '返回岗位列表' }).click();
  await page.getByLabel('导入岗位备份', { exact: true }).setInputFiles(path!);
  await expect(page).toHaveURL(/\/workspaces\//);
  expect(page.url()).not.toBe(originalURL);
  await expect(page.locator('.workspace-title')).toContainText('导入副本');
  await page.goto(originalURL);
  await expect(page.locator('.workspace-title')).not.toContainText('导入副本');
});
async function seed(page: Page) {
  await page.goto('/');
  await seedLegacyWorkbench(page);
  await page.getByRole('button', { name: '从资料整理', exact: true }).click();
  await expect(page.getByTestId('item-task')).toHaveCount(3);
  return page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '订单页面建设', exact: true }) });
}
test('来源修订保留旧引用并提示复核；TXT与Markdown实际导入', async ({ page }) => {
  const task = await seed(page);
  await task.getByRole('button', { name: '确认', exact: true }).click();
  await task.getByRole('button', { name: /查看依据/ }).click();
  await page.getByRole('button', { name: '新增修订版本' }).click();
  await page
    .getByLabel('原文（保存后通过新版本修订）', { exact: true })
    .fill('新的项目范围：订单列表不变，订单详情拆分为第二阶段交付。');
  await page.getByRole('button', { name: '保存新版本' }).click();
  await expect(task.locator('.item-status')).toContainText('需复核');
  await task.getByRole('button', { name: /查看依据/ }).click();
  await expect(page.getByLabel('查看资料版本')).toHaveValue('1');
  await expect(page.locator('.source-highlight')).toContainText('订单列表、订单详情');
  for (const name of ['补充说明.txt', '补充要求.md']) {
    await page.getByRole('button', { name: '添加资料', exact: true }).click();
    await page.getByLabel('导入岗位资料文件').setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('项目补充材料：新人主要负责界面建设，具体安排需由负责人确认。'),
    });
    await expect(page.getByLabel('原文（保存后通过新版本修订）', { exact: true })).toHaveValue(
      /项目补充材料/,
    );
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await expect(page.locator('.source-tile').filter({ hasText: name })).toBeVisible();
  }
});
test('局部应用后撤销，保留随后无关编辑；锁定项按钮和逻辑一致', async ({ page }) => {
  const task = await seed(page);
  const original = await task.locator('.scope-note').textContent();
  await task.getByRole('button', { name: '局部共创' }).click();
  await page
    .getByLabel('这一次，你想调整什么？')
    .fill('只负责前端页面和接口接入，不负责后端与数据库。');
  await page.getByRole('button', { name: '生成局部修改建议' }).click();
  await page
    .getByTestId('suggestion-card')
    .filter({ has: page.getByRole('heading', { name: '订单页面建设', exact: true }) })
    .getByRole('button', { name: '应用本条' })
    .click();
  await expect(task.locator('.scope-note')).toContainText('后端和数据库');
  const other = page
    .getByTestId('item-task')
    .filter({ has: page.getByRole('heading', { name: '接口接入与联调', exact: true }) });
  await other.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('随后人工修改：增加接口异常状态验证，不应被撤销。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  await page.getByRole('button', { name: '撤销最近一次AI应用' }).click();
  await expect(page.getByTestId('suggestion-card').first()).toContainText('已撤销');
  await expect(task.locator('.scope-note')).toHaveText(original!);
  await expect(other).toContainText('随后人工修改：增加接口异常状态验证');
  await task.getByRole('button', { name: '锁定', exact: true }).click();
  await task.getByRole('button', { name: '局部共创' }).click();
  await expect(page.getByRole('button', { name: '生成局部修改建议' })).toBeDisabled();
  await expect(task.locator('.item-status')).toContainText('待确认');
});
test('保存失败保留输入并可重试；取消AI不会破坏人工流程', async ({ page }) => {
  const task = await seed(page);
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype;
    const original = proto.transaction;
    Reflect.set(window, 'restoreStorage', () => {
      proto.transaction = original;
    });
    proto.transaction = () => {
      throw new DOMException('浏览器存储暂不可用', 'QuotaExceededError');
    };
  });
  await task.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .getByLabel('具体工作 / 条件与交付', { exact: true })
    .fill('保存失败时依然保留的人工编辑内容。');
  await page.getByRole('button', { name: '保存为待复核内容' }).click();
  await expect(page.getByText('保存失败', { exact: true })).toBeVisible();
  await expect(task).toContainText('保存失败时依然保留');
  await page.evaluate(() => {
    Reflect.get(window, 'restoreStorage')();
  });
  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await task.getByRole('button', { name: '局部共创' }).click();
  await page.getByLabel('这一次，你想调整什么？').fill('只负责前端页面');
  await page.route('**/api/workbench', async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.abort();
  });
  await page.getByRole('button', { name: '生成局部修改建议' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).first().click();
  await expect(page.locator('.center-ai-error')).toContainText('已取消');
  await expect(task).toContainText('保存失败时依然保留');
  await expect(page.getByRole('button', { name: '生成局部修改建议' })).toBeEnabled();
});
