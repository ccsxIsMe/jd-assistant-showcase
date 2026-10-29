import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockFeatures, mockRoles } from '../../src/lib/lab/mock';
import type { LabStageRequest } from '../../src/lib/lab/ai-contract';
import type { Exploration } from '../../src/lib/exploration/model';
import { currentDecisions } from '../../src/lib/decisions/records';
import { seedLegacyLab } from '../fixtures/legacy-browser';
async function read(page: Page): Promise<Exploration> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<Exploration>((resolve) => {
      const r = db
        .transaction('explorations')
        .objectStore('explorations')
        .get(location.pathname.split('/').at(-1)!);
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  });
}
const choices = [
  {
    id: 'now',
    label: '首版支持共同编辑',
    impact: '需要核对同步、协作与验收边界',
    sourceType: 'ai_suggestion' as const,
  },
  {
    id: 'later',
    label: '首版先不做共同编辑',
    impact: '先验证单人编辑，后续协作另行决定',
    sourceType: 'ai_suggestion' as const,
  },
];
test('新建、AI规划同义去重、唯一入口、证据和图谱同步、模式编辑、快照及岗位继承', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let lastAnswer = '';
  await page.route('**/api/lab/*', async (route) => {
    const input = route.request().postDataJSON() as LabStageRequest;
    const common = {
      detail: '固定无敏感验收：影响首版范围，非真实AI推理。',
      choices,
      decisionSpec: {
        topic: '实时协作范围',
        selection: 'single' as const,
        explanation: '影响首版交付范围与后续岗位讨论。',
        requiredNow: false,
        requiredReason: '允许带假设继续',
        scope: {
          dimension: 'collaborative-editing',
          phase: 'mvp' as const,
          perspective: 'our_product' as const,
          objectIds: [],
        },
      },
      evidenceIds: input.analysis.evidence.slice(0, 2).map((e) => e.evidenceId),
    };
    let output;
    if (input.stage === 'derive_features') {
      output = mockFeatures(input);
      output.questions = [
        {
          ...common,
          title: '首版是否需要实时协作？',
          findingKeys: output.findings
            .filter((f) => f.kind === 'feature')
            .slice(0, 1)
            .map((f) => f.key),
        },
      ];
    } else if (input.stage === 'link_evidence')
      output = {
        relations: [],
        questions: [
          {
            ...common,
            title: '第一阶段是否支持多人同时编辑？',
            findingIds: input.analysis.confirmedFindings
              .filter((f) => f.kind === 'feature')
              .slice(0, 1)
              .map((f) => f.id),
          },
        ],
        notice: '演示验收，同义问题来自第二个阶段',
      };
    else {
      output = mockRoles(input);
      output.questions = [];
      lastAnswer = input.analysis.questions[0]?.answer ?? '';
      if (lastAnswer && output.solutions[0])
        output.solutions[0].description = `固定响应按当前决定：${lastAnswer}`;
    }
    await route.fulfill({
      json: {
        stage: input.stage,
        output,
        requestId: crypto.randomUUID(),
        projectId: input.projectId,
        baseRevision: input.revision,
        inputVersions: input.inputVersions,
        promptVersion: 'test.unified@1',
        mode: 'example',
        modelConfig: { provider: 'mock', model: 'fixed-test', configurationId: 'test@1' },
      },
    });
  });
  await page.goto('/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).click();
  await page.getByRole('button', { name: '开始规划', exact: true }).click();
  await page
    .getByRole('complementary', { name: '研究交互教程' })
    .getByRole('button', { name: '跳过教程', exact: true })
    .click();
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await main
    .getByLabel('规划产品目标')
    .fill(
      '希望做一个可以单人编辑并导出的工具，首版实时协作是否需要仍待决定。\n先核对用户工作范围，不预设技术栈。',
    );
  await main.getByRole('button', { name: '开始AI规划', exact: true }).click();
  await expect(main.getByTestId('planning-solution').first()).toBeVisible();
  await expect.poll(async () => currentDecisions((await read(page)).questions).length).toBe(1);
  const p = await read(page);
  const id = p.questions[0].id;
  await expect(page.locator(`[data-decision-form="${id}"]`)).toHaveCount(1);
  const sourceBefore = JSON.stringify(p.sources),
    positions = p.lab!.nodes.map((n) => [n.id, n.layoutPosition]);
  const entry = page.locator(`[data-decision-form="${id}"]`);
  await entry.getByRole('radio', { name: /首版先不做共同编辑/ }).check();
  await entry.getByRole('button', { name: '保存这个决定' }).click();
  await expect.poll(async () => (await read(page)).questions[0].answer).toBe('首版先不做共同编辑');
  await main.locator('.planning-proof>summary').click();
  const refs = main.locator('.planning-proof .decision-references');
  await refs.locator(':scope>summary').click();
  await expect(refs).toContainText('首版先不做共同编辑');
  await expect(refs.locator('input,textarea')).toHaveCount(0);
  await refs.getByRole('button', { name: '修改这个决定' }).click();
  await expect(entry).toBeFocused();
  await mkdir('docs/screenshots/unify-decisions', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/unify-decisions/after-evidence-1440.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '查看完整证据板', exact: true }).click();
  const node = page.getByTestId('lab-node-question').first();
  await node.getByRole('button', { name: /查看详情/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator(`[data-decision-form="${id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-decision-form="${id}"]`)).toHaveCount(1);
  await expect(dialog.getByRole('radio', { name: /首版先不做共同编辑/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回引导式研究', exact: true }).click();
  await page.getByLabel('研究方式', { exact: true }).selectOption('collaborate');
  await page
    .getByRole('navigation', { name: '研究阶段' })
    .getByRole('button', { name: /确认证据/ })
    .click();
  const current = page.locator(`[data-decision-form="${id}"]`);
  await expect(current).toHaveCount(1);
  await current.getByRole('radio', { name: '其他，请填写', exact: true }).check();
  await current
    .getByRole('textbox', { name: /自己的回答/ })
    .fill('先支持异步轮流编辑，不做首版实时同步');
  await page.getByLabel('研究方式', { exact: true }).selectOption('plan');
  const recorded = main.locator('.planning-decisions>details');
  if ((await recorded.getAttribute('open')) === null)
    await recorded.locator(':scope>summary').click();
  const recordedItem = recorded.locator(':scope>details').first();
  if ((await recordedItem.getAttribute('open')) === null)
    await recordedItem.locator(':scope>summary').click();
  await expect(
    page.locator(`[data-decision-form="${id}"]`).getByRole('textbox', { name: /自己的回答/ }),
  ).toHaveValue('先支持异步轮流编辑，不做首版实时同步');
  await page
    .locator(`[data-decision-form="${id}"]`)
    .getByRole('button', { name: '保存这个决定' })
    .click();
  await expect
    .poll(async () => (await read(page)).questions[0].response?.text)
    .toBe('先支持异步轮流编辑，不做首版实时同步');
  expect(JSON.stringify((await read(page)).sources)).toBe(sourceBefore);
  expect((await read(page)).lab!.nodes.map((n) => [n.id, n.layoutPosition])).toEqual(positions);
  await recorded.getByRole('button', { name: '按这个回答补充关联方案' }).click();
  await expect.poll(() => lastAnswer).toBe('先支持异步轮流编辑，不做首版实时同步');
  await main
    .getByTestId('planning-solution')
    .first()
    .getByRole('button', { name: '选择此方案' })
    .click();
  const ack = main.getByRole('checkbox', { name: /我理解上述重要冲突与未知/ });
  if (await ack.count()) await ack.check();
  await main.getByRole('button', { name: '确认方案并生成资料包', exact: true }).click();
  await main.getByRole('button', { name: '保存快照并预览导入', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '导入预览 · 岗位共创工作台' });
  await preview.getByRole('button', { name: '确认导入为待确认任务与要求', exact: true }).click();
  await expect(page).toHaveURL(/workspaces/);
  const tour = page.getByRole('complementary', { name: '岗位交互教程' });
  if (await tour.count()) await tour.getByRole('button', { name: '跳过教程', exact: true }).click();
  await page.getByRole('tab', { name: /问题澄清/ }).click();
  const inherited = page.locator('.question-card').filter({ hasText: '首版是否需要实时协作？' });
  if (!(await inherited.getByRole('button', { name: '确认沿用到当前岗位' }).count()))
    await inherited.locator('.question-title').click();
  await expect(inherited).toContainText('先支持异步轮流编辑');
  await inherited.getByRole('button', { name: '确认沿用到当前岗位' }).click();
  await expect(inherited).toHaveClass(/resolved/);
  await page.getByRole('tab', { name: /岗位任务/ }).click();
  for (const task of await page.getByTestId('item-task').all())
    await task.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('tab', { name: /岗位要求/ }).click();
  for (const req of await page.getByTestId('item-requirement').all())
    await req.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('button', { name: '生成 JD 草稿', exact: true }).click();
  await expect(page.getByTestId('jd-block').first()).toBeVisible();
});
test('旧同义问题冲突仅一次复核，来源、历史与跨模式草稿保持，桌面和窄屏唯一表单', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedLegacyLab(page);
  await page.evaluate(async () => {
    localStorage.setItem(
      'jd-interactive-guide:lab:v2',
      JSON.stringify({ status: 'skipped', stepId: '' }),
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('explorations', 'readwrite'),
        store = tx.objectStore('explorations'),
        r = store.get(location.pathname.split('/').at(-1)!);
      r.onsuccess = () => {
        const p = r.result as Exploration;
        p.findings.push({
          id: 'legacy-collaboration-feature',
          revision: 1,
          kind: 'feature',
          title: '实时协作（固定迁移验收）',
          description: '固定测试中的首版协作候选',
          behavior: '',
          outcome: '',
          basis: 'inferred',
          priority: 'medium',
          phase: 'mvp',
          status: 'pending',
          locked: false,
          evidenceIds: p.evidence.slice(0, 2).map((e) => e.evidenceId),
          parentId: null,
          origin: 'user',
        });
        const base = {
          detail: '固定历史迁移验收，双方来源需保留。',
          findingIds: ['legacy-collaboration-feature'],
          choices: [
            { id: 'yes', label: '首版实施实时协作', impact: '需要同步验收' },
            { id: 'no', label: '首版不做实时协作', impact: '后续再评估' },
          ],
          status: 'answered' as const,
          response: { kind: 'custom', choiceIds: [], text: '' },
        };
        p.questions = [
          {
            ...base,
            id: 'legacy-a',
            title: '首版是否需要实时协作？',
            evidenceIds: p.evidence.slice(0, 1).map((e) => e.evidenceId),
            answer: '首版需要共同编辑',
            response: { kind: 'custom', choiceIds: [], text: '首版需要共同编辑' },
          },
          {
            ...base,
            id: 'legacy-b',
            title: '第一阶段是否支持多人同时编辑？',
            evidenceIds: p.evidence.slice(1, 2).map((e) => e.evidenceId),
            answer: '首版先不做共同编辑',
            response: { kind: 'custom', choiceIds: [], text: '首版先不做共同编辑' },
          },
        ];
        p.lab!.ui.researchMode = 'plan';
        p.lab!.ui.planningScreen = 'results';
        store.put(p);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('[data-decision-form]')).toHaveCount(1);
  const entry = page.locator('[data-decision-form]');
  await expect(entry).toContainText('历史回答不一致');
  await expect(entry).toContainText('首版需要共同编辑');
  await expect(entry).toContainText('首版先不做共同编辑');
  await expect.poll(async () => currentDecisions((await read(page)).questions).length).toBe(1);
  const before = await read(page),
    snapshotJson = JSON.stringify(before.snapshots),
    sources = JSON.stringify(before.sources);
  expect(currentDecisions(before.questions)).toHaveLength(1);
  expect(before.questions).toHaveLength(2);
  await entry.getByRole('radio', { name: /首版不做实时协作/ }).check();
  await entry.getByRole('button', { name: '保存这个决定' }).click();
  await expect
    .poll(async () => (await read(page)).questions[0].decision?.answerNeedsReview)
    .toBe(false);
  await page.getByLabel('研究方式', { exact: true }).selectOption('collaborate');
  await page
    .getByRole('navigation', { name: '研究阶段' })
    .getByRole('button', { name: /确认证据/ })
    .click();
  await expect(page.locator('[data-decision-form]')).toHaveCount(1);
  expect(
    await page
      .locator('[data-decision-form]')
      .getByRole('button', { name: '保存这个决定' })
      .evaluate((e) => getComputedStyle(e).color),
  ).toBe('rgb(255, 255, 255)');
  await expect(
    page.locator('[data-decision-form]').getByRole('radio', { name: /首版不做实时协作/ }),
  ).toBeChecked();
  await page.screenshot({
    path: 'docs/screenshots/unify-decisions/after-collaborate-1280.png',
    fullPage: true,
  });
  await page
    .locator('[data-decision-form]')
    .screenshot({ path: 'docs/screenshots/unify-decisions/after-single-answer-1280.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-decision-form]').scrollIntoViewIfNeeded();
  expect(
    await page
      .locator('[data-decision-form] .decision-business-card input')
      .first()
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(24);
  expect(
    await page
      .locator('[data-decision-form] .decision-business-card>span')
      .first()
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('[data-decision-form]')
    .screenshot({ path: 'docs/screenshots/unify-decisions/after-single-answer-390.png' });
  await page.reload();
  const after = await read(page);
  expect(JSON.stringify(after.snapshots)).toBe(snapshotJson);
  expect(JSON.stringify(after.sources)).toBe(sources);
  expect(currentDecisions(after.questions)).toHaveLength(1);
});
