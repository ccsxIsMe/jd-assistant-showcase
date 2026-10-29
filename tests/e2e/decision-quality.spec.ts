import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { newExploration, type Exploration } from '../../src/lib/exploration/model';
import { createSource, paragraphs, sourceChanged } from '../../src/lib/exploration/domain';
import { synchronizeLab } from '../../src/lib/lab/graph';
import { initializeDecision } from '../../src/lib/decisions/quality';
import { decisionCases } from '../fixtures/decision-cases';
import { createExample } from '../../src/lib/workbench/example';
import type { Workspace } from '../../src/lib/workbench/model';

// Fixture setup only; all repairs, choices, edits, switches and assertions use live pages.
async function put(page: Page, p: Exploration | Workspace, store = 'explorations') {
  await page.goto('/lab');
  await expect(page.getByRole('button', { name: '新建探索', exact: true })).toBeVisible();
  await page.evaluate(
    async ({ p, store }) => {
      for (const scope of ['lab', 'workbench'])
        localStorage.setItem(
          `jd-interactive-guide:${scope}:v2`,
          JSON.stringify({ status: 'skipped', stepId: '' }),
        );
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
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
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(p);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { p, store },
  );
  await page.goto(store === 'explorations' ? `/lab/${p.id}` : `/workspaces/${p.id}`);
  const tour = page.getByRole('button', { name: '跳过教程', exact: true });
  if (await tour.count()) await tour.first().click();
}
async function read<T>(page: Page, id: string, store = 'explorations'): Promise<T> {
  return page.evaluate(
    async ({ id, store }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('jd-assistant-workbench', 3);
        r.onsuccess = () => resolve(r.result);
      });
      return new Promise<T>((resolve) => {
        const r = db.transaction(store).objectStore(store).get(id);
        r.onsuccess = () => {
          db.close();
          resolve(r.result);
        };
      });
    },
    { id, store },
  );
}
function research(index: number, valid = false) {
  const c = decisionCases[index];
  let p = newExploration(`选择题验收 · ${c.name} · 演示数据`);
  p.initialObjective = c.facts;
  const s = createSource('text', '固定无敏感测试资料');
  s.status = 'ready';
  s.versions[0].text = c.facts;
  s.versions[0].paragraphs = paragraphs(c.facts, 'user');
  p = sourceChanged(p, s, s.versions[0]);
  p.questions = [
    {
      id: 'question-1',
      title: c.original,
      detail: '测试模型返回/旧版缺失选项；非真实AI结果。',
      findingIds: [],
      evidenceIds: [],
      status: 'open',
      answer: '',
      ...(valid ? initializeDecision(c.questions[0]) : {}),
    },
  ];
  p = synchronizeLab(p);
  p.lab!.ui.researchMode = 'plan';
  p.lab!.ui.planningScreen = 'results';
  return p;
}
async function openRecorded(page: Page, title: string) {
  const other = page.locator('.planning-decisions>details');
  if ((await other.getAttribute('open')) === null) await other.locator(':scope>summary').click();
  const detail = other
    .locator(':scope>details')
    .filter({ has: page.locator('summary').filter({ hasText: title }) })
    .first();
  if ((await detail.getAttribute('open')) === null) await detail.locator(':scope>summary').click();
  return detail;
}
test('游戏复合问题：缺失状态、仅本题补全、两维独立业务卡片、未知与模式刷新恢复', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const p = research(0);
  let repairs = 0;
  await page.route('**/api/ai/decision-options', async (route) => {
    repairs++;
    const b = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        operationId: b.operationId,
        questionId: b.question.id,
        contextId: b.context.id,
        questions: decisionCases[0].questions,
        issues: [],
        promptVersion: 'decision-options@1.0.0',
      },
    });
  });
  await put(page, p);
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await expect(main.getByTestId('planning-question').locator('.decision-incomplete')).toBeVisible();
  await expect(main.getByRole('group', { name: '业务选项' })).toHaveCount(0);
  await expect(main.getByRole('radio', { name: '以上都不适用', exact: true })).toHaveCount(0);
  await mkdir('docs/screenshots/decision-quality', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/decision-quality/incomplete-1440.png',
    fullPage: true,
  });
  await main.getByRole('button', { name: '重新生成选项', exact: true }).click();
  await expect(main.getByRole('group', { name: '业务选项' })).toHaveCount(2);
  await main
    .getByTestId('planning-question')
    .first()
    .screenshot({ path: 'docs/screenshots/decision-quality/game-role-options.png' });
  await main
    .getByTestId('planning-question')
    .nth(1)
    .screenshot({ path: 'docs/screenshots/decision-quality/game-style-options.png' });
  expect(repairs).toBe(1);
  const first = main.getByTestId('planning-question').first();
  await expect(first.getByRole('radio')).toHaveCount(5); // Three actual directions + two primary auxiliary actions.
  await first.getByRole('radio', { name: /主要可操作角色/ }).check();
  await first.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].response?.choiceIds)
    .toEqual(['playable']);
  const style = main.getByTestId('planning-question').first();
  await style.getByRole('radio', { name: '我不确定', exact: true }).check();
  await style.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[1].response?.kind)
    .toBe('uncertain');
  expect((await read<Exploration>(page, p.id)).questions[1].status).toBe('open');
  await page.getByLabel('研究方式', { exact: true }).selectOption('collaborate');
  await expect(page.getByRole('main', { name: '五阶段引导式研究' })).toBeVisible();
  await page.getByLabel('研究方式', { exact: true }).selectOption('plan');
  await page.reload();
  const recorded = await openRecorded(page, decisionCases[0].questions[0].title);
  await expect(recorded.getByRole('radio', { name: /主要可操作角色/ })).toBeChecked();
  const state = await read<Exploration>(page, p.id);
  expect(state.questions).toHaveLength(2);
  expect(state.questions[0].response?.optionsVersion).toBe(2);
  await page.screenshot({
    path: 'docs/screenshots/decision-quality/game-1440.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await recorded
    .locator('.decision-input')
    .screenshot({ path: 'docs/screenshots/decision-quality/game-options-390.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/decision-quality/game-390.png', fullPage: true });
});
test('活动报名：业务选择和自定义进入后续方案；都不适用绑定版本，跳过不确认', async ({ page }) => {
  const p = research(1, true);
  await put(page, p);
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  const question = main.getByTestId('planning-question').first();
  await expect(question.getByRole('group', { name: '业务选项' }).getByRole('radio')).toHaveCount(3);
  await question.getByRole('radio', { name: /转入候补名单/ }).check();
  await question.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].answer)
    .toBe('转入候补名单');
  let received = '';
  await page.route('**/api/lab/propose_roles', async (route) => {
    const b = route.request().postDataJSON();
    received = b.analysis.questions[0].answer;
    await route.fulfill({
      json: {
        stage: 'propose_roles',
        output: {
          solutions: [
            {
              key: 'answer-driven',
              title: `按当前决定形成方案：${received}`,
              description: '固定测试，仅验证回答实际用于后续请求。',
              rationale: '依据当前用户决定',
              assumptions: ['其余条件待确认'],
              advantages: ['范围清晰'],
              disadvantages: ['尚需验收'],
              openQuestions: [],
              relatedFeatureIds: [],
              relatedEvidenceIds: [],
              productPlan: {
                goal: received,
                priorityFeatureIds: [],
                deferredFeatureIds: [],
                difference: `根据你的决定：${received}`,
                complexity: '首版规则验证',
                capabilityNotes: ['当前岗位要求仍待核对'],
              },
              roles: [
                { key: 'owner', title: '方案责任人待确认', headcount: null, rationale: '仅作候选' },
              ],
              requirements: [],
            },
          ],
          questions: [],
          notice: '演示测试，非真实AI分析',
        },
        requestId: crypto.randomUUID(),
        projectId: b.projectId,
        baseRevision: b.revision,
        inputVersions: b.inputVersions,
        promptVersion: 'test.answer@1',
        mode: 'example',
        modelConfig: { provider: 'mock', model: 'test', configurationId: 'test@1' },
      },
    });
  });
  let item = await openRecorded(page, decisionCases[1].original);
  await item.getByRole('button', { name: '按这个回答补充关联方案' }).click();
  await expect.poll(() => received).toBe('转入候补名单');
  await expect(main.getByTestId('planning-solution').first()).toContainText('转入候补名单');
  item = await openRecorded(page, decisionCases[1].original);
  await item.getByRole('radio', { name: '其他，请填写', exact: true }).check();
  const text = '先登记下一场通知意向，不承诺本场名额';
  await item.getByRole('textbox', { name: /自己的回答/ }).fill(text);
  await item.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].response?.text)
    .toBe(text);
  await item.getByRole('button', { name: '按这个回答补充关联方案' }).click();
  await expect.poll(() => received).toBe(text);
  await expect(main.getByTestId('planning-solution').last()).toContainText(text);
  item = await openRecorded(page, decisionCases[1].original);
  await item.getByText('其他处理方式', { exact: true }).click();
  await item.getByRole('radio', { name: '以上都不适用', exact: true }).check();
  await item.getByRole('textbox', { name: /自己的回答/ }).fill('重新考虑按场次通知');
  await item.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].response?.kind)
    .toBe('none');
  expect((await read<Exploration>(page, p.id)).questions[0].response?.optionSnapshot).toHaveLength(
    3,
  );
  await page.screenshot({
    path: 'docs/screenshots/decision-quality/signup-1440.png',
    fullPage: true,
  });
  await item.getByRole('radio', { name: '暂时跳过', exact: true }).check();
  await item.getByRole('button', { name: '保存这个决定', exact: true }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].status)
    .toBe('deferred');
});
test('局部补全迟到期间正在填写的自定义内容保留，结果不覆盖', async ({ page }) => {
  const p = research(1);
  let release!: () => void;
  let arrived = false;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/ai/decision-options', async (route) => {
    arrived = true;
    await wait;
    const b = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        operationId: b.operationId,
        questionId: b.question.id,
        contextId: b.context.id,
        questions: decisionCases[1].questions,
        issues: [],
        promptVersion: 'test',
      },
    });
  });
  await put(page, p);
  const q = page.getByTestId('planning-question').first();
  await q.getByRole('button', { name: '重新生成选项' }).click();
  await expect.poll(() => arrived).toBe(true);
  await q.getByRole('button', { name: '直接补充想法' }).click();
  await q.getByRole('textbox', { name: /自己的回答/ }).fill('正在输入的新偏好，不可被迟到响应覆盖');
  release();
  await expect(q).toContainText('迟到的补全结果未应用');
  await expect(q.getByRole('textbox', { name: /自己的回答/ })).toHaveValue(
    '正在输入的新偏好，不可被迟到响应覆盖',
  );
  await expect(q.getByRole('group', { name: '业务选项' })).toHaveCount(0);
  await q.getByRole('button', { name: '保存这个决定' }).click();
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].response?.kind)
    .toBe('custom');
});
test('岗位共创工作台：独立真实业务选项可点击保存，刷新恢复稳定ID', async ({ page }) => {
  const w = createExample();
  w.title = '软件工程师范围 · 固定测试';
  w.questions = [
    {
      id: 'work-scope',
      ...initializeDecision(decisionCases[2].questions[0]),
      kind: 'potential',
      important: false,
      targetIds: [],
      refs: [],
      status: 'open',
      answer: '',
      reason: '',
      createdAt: new Date().toISOString(),
    },
  ];
  await put(page, w, 'workspaces');
  await page.getByRole('tab', { name: /问题澄清/ }).click();
  const card = page.locator('.question-card').filter({ hasText: decisionCases[2].original });
  await card.locator('.question-title').click();
  await expect(card.getByRole('group', { name: '业务选项' }).getByRole('radio')).toHaveCount(3);
  await card.getByRole('radio', { name: /服务接口与数据处理/ }).check();
  await card.getByRole('button', { name: '保存这个决定' }).click();
  await expect
    .poll(
      async () =>
        (await read<Workspace>(page, w.id, 'workspaces')).questions[0].response?.choiceIds,
    )
    .toEqual(['service']);
  await page.reload();
  await page.getByRole('tab', { name: /问题澄清/ }).click();
  await card.locator('.question-title').click();
  await expect(card.getByRole('radio', { name: /服务接口与数据处理/ })).toBeChecked();
  await page.screenshot({
    path: 'docs/screenshots/decision-quality/work-scope-1440.png',
    fullPage: true,
  });
});
test('已知信息预填、规划提问预算与旧答案补全复核，不自动发起修复请求', async ({ page }) => {
  const p = research(1, true),
    original = structuredClone(p.questions[0]);
  p.questions = Array.from({ length: 5 }, (_, i) => ({
    ...structuredClone(original),
    id: `budget-${i}`,
    title: `报名规则决策 ${i + 1}？`,
  }));
  const known = {
    ...structuredClone(original),
    id: 'known-1',
    title: '这个网站用来做什么？',
    choices: [],
    decisionSpec: {
      ...original.decisionSpec!,
      knownAnswer: {
        text: '活动报名网站',
        referenceId: p.evidence[0].evidenceId,
        quote: p.evidence[0].excerpt,
      },
    },
    decision: { ...original.decision!, generation: 'known' as const },
  };
  p.questions.push(known);
  let repairs = 0;
  await page.route('**/api/ai/decision-options', async (route) => {
    repairs++;
    const b = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        operationId: b.operationId,
        questionId: b.question.id,
        contextId: b.context.id,
        questions: decisionCases[1].questions,
        issues: [],
        promptVersion: 'test',
      },
    });
  });
  await put(page, p);
  const main = page.getByRole('main', { name: 'AI帮我规划' });
  await expect(main.getByTestId('planning-question')).toHaveCount(3);
  expect(repairs).toBe(0);
  const knownItem = await openRecorded(page, known.title);
  await expect(knownItem).toContainText('已根据你的资料填写，可修改');
  await expect(knownItem.getByRole('group', { name: '业务选项' })).toHaveCount(0);
  await knownItem.getByRole('button', { name: '修改已知信息' }).click();
  await expect(knownItem.getByRole('textbox', { name: /自己的回答/ })).toHaveValue('活动报名网站');
  const item = main.getByTestId('planning-question').first();
  await item.getByRole('radio', { name: /停止接受新报名/ }).check();
  await item.getByRole('button', { name: '保存这个决定' }).click();
  // Restore a legacy broken option shape as a historical fixture, keeping its actual saved answer.
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].response?.choiceIds)
    .toEqual(['close']);
  const saved = await read<Exploration>(page, p.id);
  saved.questions[0].choices = [];
  await put(page, saved);
  const stale = page
    .getByTestId('planning-question')
    .filter({ has: page.getByRole('heading', { name: '报名规则决策 1？', exact: true }) });
  await expect(stale.getByTestId('decision-answer-review')).toBeVisible();
  await stale.getByRole('button', { name: '重新生成选项' }).click();
  await expect(page.getByTestId('decision-answer-review').first()).toContainText('原回答需复核');
  await expect
    .poll(async () => (await read<Exploration>(page, p.id)).questions[0].decision?.optionsVersion)
    .toBe(2);
  const repaired = (await read<Exploration>(page, p.id)).questions[0];
  expect(repaired.answer).toBe('停止接受新报名');
  expect(repaired.response?.optionsVersion).toBe(1);
  expect(repairs).toBe(1);
});
