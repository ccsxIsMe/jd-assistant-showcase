import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { newItem, newWorkspace, now, type Workspace } from '../../src/lib/workbench/model';
import { initializeDecision } from '../../src/lib/decisions/quality';

const shots = 'docs/screenshots/jd-review-guidance';
function fixture(question = true) {
  const w = newWorkspace('软件工程师 · 核对导航验收（虚构）');
  const t = newItem('task', '页面交付', '完成页面与验收。');
  const r = newItem('requirement', '界面实现能力', '能完成相关页面交付。');
  t.status = r.status = 'confirmed';
  w.items = [
    t,
    r,
    newItem('block', '主要职责', '完成界面实现与验收，明确协作边界。'),
    newItem('block', '岗位能力', '具备界面实现与联调能力。'),
  ];
  w.ui.selectedId = t.id;
  w.ui.rightOpen = false;
  if (question)
    w.questions = [
      {
        id: 'review-q',
        title: '本岗位是否承担上线后的值守？',
        detail: '记录实际决定；不会由系统替你作答。',
        important: true,
        kind: 'human',
        status: 'deferred',
        targetIds: [],
        refs: [],
        answer: '',
        reason: '',
        createdAt: now(),
      },
    ];
  return w;
}
async function open(page: Page, w: Workspace) {
  await page.goto('/');
  await page.evaluate(async (w) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onupgradeneeded = () => {
        for (const name of [
          'workspaces',
          'explorations',
          'exploration-assets',
          'resume-reviews',
          'demo-instances',
        ])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('workspaces', 'readwrite');
      tx.objectStore('workspaces').put(w);
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, w);
  await page.goto(`/workspaces/${w.id}`);
  await page
    .getByRole('complementary', { name: '岗位交互教程' })
    .getByRole('button', { name: '跳过教程', exact: true })
    .click();
}
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise((resolve) => {
      const r = db
        .transaction('workspaces')
        .objectStore('workspaces')
        .get(location.pathname.split('/').at(-1)!);
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  });
}

test('JD核对引导定位已折叠问题与指定正文，人工处理后才能保存确认版本', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w = fixture();
  let aiCalls = 0;
  await page.route('**/api/workbench', async (route) => {
    aiCalls++;
    await route.abort();
  });
  await open(page, w);
  const checklist = page.getByLabel('JD核对待办');
  await expect(checklist).toContainText('还需处理 3 项');
  await expect(checklist).toContainText('打开此问题');
  await checklist.getByText('查看其他 2 项待办', { exact: true }).click();
  await expect(checklist.getByText(/在JD编辑中核对这段正文/).first()).toBeVisible();
  await checklist.getByText('查看其他 2 项待办', { exact: true }).click();
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/desktop-checklist.png`, fullPage: true });
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  const q = page.locator('#question-review-q');
  const answer = q.getByRole('textbox', { name: /自己的回答/ });
  await expect(answer).toBeVisible();
  await expect(answer).toBeFocused();
  await expect(page.locator('[data-decision-form="review-q"]')).toHaveCount(1);
  await answer.fill('本岗位不承担上线后的值守，由现有运维团队负责。');
  await q.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect(checklist).toContainText('还需处理 2 项');
  await expect
    .poll(async () => (await saved(page)).questions[0].answer)
    .toContain('不承担上线后的值守');
  await page.getByRole('button', { name: '下一步：逐段核对JD正文', exact: true }).click();
  const block = page.locator(`#item-${w.items[2].id}`);
  await expect(block.getByRole('button', { name: '确认段落', exact: true })).toBeFocused();
  await expect(block).toContainText('待确认');
  await page.screenshot({ path: `${shots}/located-jd-block.png`, fullPage: true });
  await block.getByRole('button', { name: '确认段落', exact: true }).click();
  await expect(checklist).toContainText('还需处理 1 项');
  await checklist.getByRole('button', { name: '去核对这段JD', exact: true }).click();
  const second = page.locator(`#item-${w.items[3].id}`);
  await expect(second.getByRole('button', { name: '确认段落', exact: true })).toBeFocused();
  await second.getByRole('button', { name: '确认段落', exact: true }).click();
  await expect(checklist).toHaveCount(0);
  await page.getByRole('button', { name: '下一步：保存版本或导出JD', exact: true }).click();
  await page
    .getByRole('dialog', { name: '版本与修改记录' })
    .getByRole('button', { name: '保存确认版本', exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).versions[0]?.kind).toBe('confirmed');
  expect(aiCalls).toBe(0);
});

test('窄屏核对待办可定位共创助手，暂缓时保存草稿并保留未知状态', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const w = fixture();
  await open(page, w);
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/mobile-checklist.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  await expect(page.getByRole('button', { name: '展开核对待办', exact: true })).toBeVisible();
  await expect(page.locator('#question-review-q').getByRole('textbox')).toBeInViewport();
  await page.screenshot({ path: `${shots}/mobile-located-question.png`, fullPage: true });
  await page
    .getByLabel('JD核对待办')
    .getByRole('button', { name: '暂时不确定？查看版本并保存草稿', exact: true })
    .click();
  const versions = page.getByRole('dialog', { name: '版本与修改记录' });
  await expect(versions.getByRole('button', { name: '保存确认版本', exact: true })).toBeDisabled();
  await versions.getByRole('button', { name: '保存草稿快照', exact: true }).click();
  await expect.poll(async () => (await saved(page)).versions[0]?.kind).toBe('draft');
  await page.keyboard.press('Escape');
  await page.reload();
  const record = await saved(page);
  expect(record.questions[0].status).toBe('deferred');
  expect(record.questions[0].answer).toBe('');
  expect(record.items[2].status).toBe('pending');
  await expect(page.getByLabel('JD核对待办')).toContainText('还需处理 3 项');
});

test('未知岗位条件从待办直接打开既有编辑窗口，不新增回答表单', async ({ page }) => {
  const w = fixture(false);
  w.items.forEach((i) => {
    i.status = 'confirmed';
  });
  w.items[1].category = 'unknown';
  await open(page, w);
  await page.getByRole('button', { name: '下一步：核对岗位条件分类', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '人工编辑要求' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('条件分类', { exact: true })).toBeFocused();
  expect((await saved(page)).items[1].category).toBe('unknown');
});

test('人工问题没有补充说明且旧选项无效时仍有回答框，保存决定后待办更新', async ({ page }) => {
  const w = fixture();
  w.questions[0].detail = '';
  w.questions[0].status = 'open';
  w.questions[0].choices = [
    { id: 'old-other', label: '其他，请填写', impact: '辅助操作' },
    { id: 'old-unsure', label: '我不确定', impact: '辅助操作' },
  ];
  await open(page, w);
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  const q = page.locator('#question-review-q');
  const answer = q.getByRole('textbox', { name: /自己的回答/ });
  await expect(answer).toBeVisible();
  await expect(answer).toBeInViewport();
  await mkdir('docs/screenshots/manual-question-answer', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/manual-question-answer/after-empty-detail.png',
    fullPage: true,
  });
  await answer.fill('由现有运维团队值守，此岗位仅负责开发交付。');
  await q.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect.poll(async () => (await saved(page)).questions[0].status).toBe('resolved');
  await expect(page.getByLabel('JD核对待办')).toContainText('还需处理 2 项');
});

test('人工问题的历史复合题可直接复核原回答、保存和撤销，不要求生成选项', async ({ page }) => {
  const w = fixture();
  w.questions[0] = initializeDecision({
    ...w.questions[0],
    title: '岗位预算和交付时间如何确定？',
    detail: '',
    status: 'resolved',
    answer: '旧决定：预算和交付节点均由负责人补充。',
  });
  w.questions[0].decision!.answerNeedsReview = true;
  await open(page, w);
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  const q = page.locator('#question-review-q');
  const answer = q.getByRole('textbox', { name: /自己的回答/ });
  await expect(answer).toHaveValue('旧决定：预算和交付节点均由负责人补充。');
  await expect(q.getByRole('button', { name: '重新生成选项', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-decision-form="review-q"]')).toHaveCount(1);
  await mkdir('docs/screenshots/manual-question-answer', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/manual-question-answer/after-legacy-review.png',
    fullPage: true,
  });
  await answer.fill('预算仍未决定；先按负责人确认的阶段验收计划推进。');
  await q.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).questions[0].decision?.answerNeedsReview)
    .toBe(false);
  await expect.poll(async () => (await saved(page)).questions[0].answer).toContain('预算仍未决定');
  await q.getByRole('button', { name: '撤销这次问题选择', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).questions[0].answer)
    .toBe('旧决定：预算和交付节点均由负责人补充。');
  await expect(answer).toHaveValue('旧决定：预算和交付节点均由负责人补充。');
});

test('人工问题无说明时可保留未知和暂缓，刷新仍有填写入口', async ({ page }) => {
  const w = fixture();
  w.questions[0].detail = '';
  await open(page, w);
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  const q = page.locator('#question-review-q');
  await q.getByRole('button', { name: '我还不确定', exact: true }).click();
  await expect.poll(async () => (await saved(page)).questions[0].response?.kind).toBe('uncertain');
  expect((await saved(page)).questions[0].status).toBe('open');
  await q.getByRole('button', { name: '暂缓这项问题', exact: true }).click();
  await expect.poll(async () => (await saved(page)).questions[0].status).toBe('deferred');
  await page.reload();
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  await expect(q.getByRole('textbox', { name: /自己的回答/ })).toBeVisible();
  expect((await saved(page)).questions[0].status).toBe('deferred');
});

test('打开导入的人工问题直接显示已有答案的编辑框，保存前不确认适用性', async ({ page }) => {
  const w = fixture();
  w.questions[0] = initializeDecision({
    ...w.questions[0],
    status: 'open',
    detail: '',
    answer: '研究决定：运维负责值守，本岗位仅负责开发交付。',
  });
  w.questions[0].decision!.inheritedFrom = {
    projectId: 'fixed-research',
    snapshotId: 'fixed-snapshot',
    questionId: 'upstream-q',
  };
  await open(page, w);
  await page.getByRole('button', { name: '下一步：处理重要问题', exact: true }).click();
  const q = page.locator('#question-review-q');
  await expect(q.getByRole('textbox', { name: /自己的回答/ })).toHaveValue(w.questions[0].answer);
  expect((await saved(page)).questions[0].status).toBe('open');
  await expect(page.locator('[data-decision-form="review-q"]')).toHaveCount(1);
  await q.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect.poll(async () => (await saved(page)).questions[0].status).toBe('resolved');
  expect((await saved(page)).questions[0].decision!.inheritedFrom?.snapshotId).toBe(
    'fixed-snapshot',
  );
});
