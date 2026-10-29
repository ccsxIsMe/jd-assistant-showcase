import { expect, test } from 'vitest';
import { createExample, demoSupplement } from '../../src/lib/workbench/example';
import { ingestAI } from '../../src/lib/workbench/ai-apply';
import {
  applySuggestion,
  editItem,
  setItemState,
  validateReference,
} from '../../src/lib/workbench/domain';
import { newItem, now, uid } from '../../src/lib/workbench/model';
import { aiOutputSchema, type AIRequest } from '../../src/lib/workbench/ai-contract';
test('真实DeepSeek：先连接，再验证四任务、来源、人工确认、锁定和过期', async () => {
  const baseURL = 'http://127.0.0.1:3000';
  const connection = await fetch(baseURL + '/api/ai/connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  expect(connection.status).toBe(200);
  expect((await connection.json()).ok).toBe(true);
  let w = createExample();
  w.mode = 'real';
  const records: { task: string; promptVersion: string; status: number; requestId: string }[] = [];
  async function call(action: AIRequest['action'], intent = '', targetId: string | null = null) {
    const base = structuredClone(w);
    const req: AIRequest = {
      action,
      mode: 'real',
      context: {
        id: w.id,
        revision: w.revision,
        title: w.title,
        sources: w.sources,
        items: w.items,
        questions: w.questions,
        decisions: w.activity.slice(0, 50).map((a) => ({ text: a.text, at: a.at })),
      },
      targetId,
      intent,
    };
    const res = await fetch(baseURL + '/api/workbench', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(65000),
    });
    const json = await res.json();
    if (!res.ok)
      throw new Error(
        `Live ${action} failed: ${res.status} ${json.code ?? ''} ${json.error ?? ''}`,
      );
    expect(json.workspaceId).toBe(w.id);
    expect(json.baseRevision).toBe(w.revision);
    const data = aiOutputSchema.parse(json.data);
    records.push({
      task: json.task,
      promptVersion: json.promptVersion,
      status: res.status,
      requestId: json.requestId,
    });
    return { base, req, data };
  }
  let result = await call('extract');
  w = ingestAI(w, result.base, result.req, result.data);
  expect(w.items.length).toBeGreaterThan(0);
  expect(w.items.every((i) => i.status === 'pending')).toBe(true);
  for (const item of w.items)
    for (const ref of item.refs) expect(validateReference(w.sources, ref).verified).toBe(true);
  expect(w.questions.some((q) => /技术栈|框架|Vue|React/.test(q.title + q.detail))).toBe(true);
  const supplement = {
    id: uid(),
    title: '本地测试人工确认的技术栈与范围（虚构）',
    type: 'supplement' as const,
    person: '测试中的人工决定（虚构）',
    createdAt: now(),
    removed: false,
    versions: [{ revision: 1, text: demoSupplement, createdAt: now() }],
  };
  w.sources.push(supplement);
  for (const i of [...w.items])
    w = setItemState(
      w,
      i.id,
      /数据库|后端开发|全栈|Vue|全部功能/.test(i.title + i.text) ? 'excluded' : 'confirmed',
    );
  const pages = w.items.find((i) => i.kind === 'task' && i.status === 'confirmed');
  expect(pages).toBeTruthy();
  const skill = newItem(
    'requirement',
    'React与TypeScript开发能力',
    '使用React和TypeScript进行前端开发；Vue不是必备条件。',
  );
  skill.status = 'confirmed';
  skill.taskIds = [pages!.id];
  skill.refs = [
    {
      sourceId: supplement.id,
      sourceRevision: 1,
      excerpt: demoSupplement,
      start: 0,
      verified: true,
    },
  ];
  w.items.push(skill);
  w.questions = w.questions.map((q) => ({
    ...q,
    status: 'resolved',
    answer: '测试中的人工确认：使用React/TypeScript；岗位仅负责前端，后端数据库由现有团队承担。',
  }));
  result = await call('questions');
  const beforeAnswers = w.questions.filter((q) => q.status === 'resolved').map((q) => q.title);
  expect(result.data.questions.every((q) => !beforeAnswers.includes(q.title))).toBe(true);
  w = ingestAI(w, result.base, result.req, result.data);
  result = await call('draft');
  w = ingestAI(w, result.base, result.req, result.data);
  expect(w.items.filter((i) => i.kind === 'block').length).toBeGreaterThan(0);
  expect(w.items.filter((i) => i.kind === 'block').every((i) => i.status === 'pending')).toBe(true);
  const changeSource = {
    id: uid(),
    title: '本轮范围调整（虚构）',
    type: 'supplement' as const,
    person: '本地测试操作者',
    createdAt: now(),
    removed: false,
    versions: [
      {
        revision: 1,
        text: '本轮新人只交付订单列表页面，订单详情由现有团队承担；不改变其他任务和岗位条件。',
        createdAt: now(),
      },
    ],
  };
  w.sources.push(changeSource);
  result = await call(
    'suggest',
    '按照“本轮范围调整”资料，只把选中任务的交付范围收窄为订单列表页面；返回这一项独立建议。不要修改其他对象，关联JD只列影响，等待另外审阅。',
    pages!.id,
  );
  const itemTexts = w.items.map((i) => [i.id, i.text]);
  const preview = ingestAI(w, result.base, result.req, result.data);
  expect(preview.items.map((i) => [i.id, i.text])).toEqual(itemTexts);
  const suggestion = preview.suggestions.find(
    (s) => s.status === 'pending' && s.changes.length === 1 && s.changes[0].targetId === pages!.id,
  );
  expect(suggestion).toBeTruthy();
  const locked = structuredClone(preview);
  locked.items.find((i) => i.id === pages!.id)!.locked = true;
  expect(() => applySuggestion(locked, suggestion!.suggestionId)).toThrow();
  const stale = editItem(preview, pages!.id, { text: '模型返回后继续人工输入的新交付内容' });
  expect(() => applySuggestion(stale, suggestion!.suggestionId)).toThrow();
  const applied = applySuggestion(preview, suggestion!.suggestionId);
  for (const [id, text] of itemTexts.filter(([id]) => id !== pages!.id))
    expect(applied.items.find((i) => i.id === id)!.text).toBe(text);
  console.log(
    JSON.stringify({
      connection: 'passed',
      tasks: records,
      checks: [
        'accurate-citations',
        'unknown-stack-question',
        'pending-not-confirmed',
        'confirmed-to-draft',
        'selective-apply',
        'locked-rejected',
        'stale-rejected',
        'original-input-preserved',
      ],
    }),
  );
});
