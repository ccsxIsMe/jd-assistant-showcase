import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/ai/adapter', () => ({ callDeepSeekJSON: vi.fn() }));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { finalizeDecisionQuestions, repairQuestionBatch } from '../../src/lib/ai/decision-service';
import {
  normalizeDecisionOutput,
  inspectDecision,
  decisionFingerprint,
  initializeDecision,
  stampDecisionResponse,
  type DecisionQuestion,
} from '../../src/lib/decisions/quality';
import { caseContext, decisionCases } from '../fixtures/decision-cases';
import { newExploration, makeId } from '../../src/lib/exploration/model';
import { synchronizeLab } from '../../src/lib/lab/graph';
import {
  applyResearchDecisionRepair,
  respondToResearchQuestion,
} from '../../src/lib/lab/operations';
import {
  researchDecisionContext,
  workbenchDecisionContext,
  contextFingerprint,
} from '../../src/lib/decisions/context';
import { buildLabRequest } from '../../src/lib/lab/workflow';
import {
  createSnapshot,
  createSource,
  paragraphs,
  textEvidence,
} from '../../src/lib/exploration/domain';
import { undoResearch } from '../../src/lib/exploration/journal';
import { newWorkspace } from '../../src/lib/workbench/model';
import {
  applyWorkbenchDecisionRepair,
  respondToWorkbenchQuestion,
  undoOperation,
} from '../../src/lib/workbench/domain';
import { POST } from '../../src/app/api/ai/decision-options/route';
const response = () => ({
  patches: [{ targetId: 'q', questions: decisionCases[1].questions }],
  notice: '仅补全本题',
});
beforeEach(() => {
  vi.mocked(callDeepSeekJSON).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
it.each([
  ['missing', {}],
  ['null', { choices: null }],
  ['empty', { choices: [] }],
  [
    'auxiliary',
    {
      choices: ['其他，请填写', '我不确定', '以上都不适用', '暂时跳过'].map((label, i) => ({
        id: `a-${i}`,
        label,
        impact: '辅助入口',
      })),
    },
  ],
  [
    'duplicate',
    {
      choices: [
        { id: 'a', label: '相同业务方向', impact: '同一结果' },
        { id: 'b', label: '相同业务方向', impact: '同一结果' },
      ],
    },
  ],
  ['nested', { options: { items: [{ title: '无法识别嵌套' }] } }],
  ['wrong-type', { choices: 42 }],
] as const)('无效选项%s明确未完成，不当成就绪选择题', (_name, extra) => {
  const out = normalizeDecisionOutput({
    questions: [{ title: '如何处理当前范围？', ...extra }],
  }) as { questions: DecisionQuestion[] };
  expect(inspectDecision(out.questions[0]).ready).toBe(false);
});
it('受控options/title/effect别名转换后选项可见，ID基于内容而非下标', () => {
  const raw = {
    questions: [
      {
        title: '如何交付？',
        options: [
          { title: '先验证单一核心流程', effect: '控制首版范围' },
          { title: '同时验证多个协作流程', effect: '增加协作边界核对' },
        ],
      },
    ],
  };
  const a = normalizeDecisionOutput(raw) as { questions: DecisionQuestion[] };
  expect(inspectDecision(a.questions[0]).generation).toBe('ready');
  const b = normalizeDecisionOutput({
    questions: [{ ...raw.questions[0], options: [...raw.questions[0].options].reverse() }],
  }) as typeof a;
  expect(a.questions[0].choices![0].id).toBe(b.questions[0].choices![1].id);
});
it('一个方向显示建议，复合问题即使有选项也不伪装成单选', () => {
  expect(
    inspectDecision({
      title: '是否先聚焦这一范围？',
      choices: [decisionCases[1].questions[0].choices![0]],
    }).generation,
  ).toBe('suggestion');
  expect(
    inspectDecision({
      title: decisionCases[0].original,
      choices: [...decisionCases[0].questions[0].choices!],
    }).ready,
  ).toBe(false);
});
it('多选按稳定ID保存，单选不能伪装成多选，过期问题版本被拒绝', () => {
  const q = initializeDecision(decisionCases[1].questions[0]);
  expect(() =>
    stampDecisionResponse(q, { kind: 'choice', choiceIds: ['close', 'waitlist'], text: '' }),
  ).toThrow('一个');
  q.decisionSpec!.selection = 'multiple';
  expect(
    stampDecisionResponse(q, { kind: 'choice', choiceIds: ['close', 'waitlist'], text: '' })
      .choiceIds,
  ).toEqual(['close', 'waitlist']);
  expect(() =>
    stampDecisionResponse(q, {
      kind: 'choice',
      choiceIds: ['close'],
      text: '',
      questionVersion: 5,
    }),
  ).toThrow('问题版本');
});
it.each([0, 1, 2])('场景%s缺失选项只做一次局部修复，复合题按真实主题拆分', async (index) => {
  const c = decisionCases[index];
  vi.mocked(callDeepSeekJSON).mockImplementation(async (call) => {
    const input = call.input as { targets: { targetId: string }[] };
    return {
      patches: [{ targetId: input.targets[0].targetId, questions: c.questions }],
      notice: '固定测试返回',
    };
  });
  const out = await finalizeDecisionQuestions(
    [{ title: c.original, detail: '待形成有区别的方向' }],
    caseContext(index),
    'real',
    new AbortController().signal,
  );
  expect(out).toHaveLength(c.questions.length);
  expect(out.every((q) => inspectDecision(q).ready)).toBe(true);
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(callDeepSeekJSON).mock.calls[0][0].input)).not.toContain(
    'confirmed',
  );
});
it('补全仍无选项时保留失败状态，不无限重试或返回示例', async () => {
  vi.mocked(callDeepSeekJSON).mockResolvedValue({ patches: [], notice: '无法比较' });
  const output = await finalizeDecisionQuestions(
    [{ title: '当前范围怎么选？' }],
    caseContext(1),
    'real',
    new AbortController().signal,
  );
  expect(output[0].decision?.generation).toBe('failed');
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
it('另一主题被否定的同名方向不能错误屏蔽当前问题', async () => {
  const ctx = caseContext(1);
  ctx.answers = [
    {
      id: 'other-topic',
      title: '另一项目交付条件？',
      topic: '其他主题',
      answer: '未采纳',
      status: 'open',
      response: {
        kind: 'none',
        choiceIds: [],
        text: '',
        optionSnapshot: decisionCases[1].questions[0].choices,
      },
    },
  ];
  vi.mocked(callDeepSeekJSON).mockResolvedValue(response());
  const result = await repairQuestionBatch(
    [{ id: 'q', question: { id: 'q', title: decisionCases[1].original } }],
    ctx,
    'real',
    new AbortController().signal,
  );
  expect(result.get('q')?.questions).toHaveLength(1);
});
it('已有回答、未知、跳过和同主题不再重复生成；已知原文可填写但不授予确认', async () => {
  const ctx = caseContext(1);
  ctx.answers = [
    {
      id: 'old',
      title: decisionCases[1].original,
      topic: '满额处理',
      answer: '尚未决定',
      status: 'open',
      response: { kind: 'uncertain', choiceIds: [], text: '' },
    },
  ];
  const output = await finalizeDecisionQuestions(
    [{ title: decisionCases[1].original }],
    ctx,
    'real',
    new AbortController().signal,
  );
  expect(output).toEqual([]);
  expect(callDeepSeekJSON).not.toHaveBeenCalled();
  const knownContext = caseContext(0);
  knownContext.facts = [
    { id: 'known', text: '本次明确只设计主要可操作角色，其他交互角色暂缓。', revision: '1' },
  ];
  const known = {
    title: '角色承担什么作用？',
    decisionSpec: {
      topic: '角色作用',
      selection: 'single' as const,
      explanation: '已提供用途',
      requiredNow: false,
      requiredReason: '',
      knownAnswer: {
        text: '主要可操作角色',
        referenceId: 'known',
        quote: '本次明确只设计主要可操作角色',
      },
    },
  };
  const result = await finalizeDecisionQuestions(
    [known],
    knownContext,
    'real',
    new AbortController().signal,
  );
  expect(result[0].decision?.generation).toBe('known');
  expect(result[0]).not.toHaveProperty('status', 'confirmed');
  expect(callDeepSeekJSON).not.toHaveBeenCalled();
});
function research() {
  const p = synchronizeLab(newExploration('活动报名研究'));
  const s = createSource('text', '用户想法');
  s.status = 'ready';
  s.versions[0].text = decisionCases[1].facts;
  s.versions[0].paragraphs = paragraphs(s.versions[0].text, 'user');
  p.sources.push(s);
  p.evidence.push(...textEvidence(s, s.versions[0]));
  p.questions.push({
    id: 'q',
    title: decisionCases[1].original,
    detail: '首版未定',
    findingIds: [],
    evidenceIds: [],
    status: 'open',
    answer: '',
  });
  return synchronizeLab(p);
}
it('关联回答变更使补全过期，无关问题回答不使其无故失效', () => {
  let p = research();
  p.questions[0].decisionSpec = initializeDecision(decisionCases[1].questions[0]).decisionSpec;
  p.questions.push(
    { ...structuredClone(p.questions[0]), id: 'related', title: '相同决策的补充说明？' },
    {
      ...structuredClone(p.questions[0]),
      id: 'unrelated',
      title: '另一事项如何处理？',
      decisionSpec: { ...p.questions[0].decisionSpec!, topic: '无关事项' },
    },
  );
  const expected = decisionFingerprint(p.questions[0]),
    contextVersion = contextFingerprint(researchDecisionContext(p, p.questions[0]));
  p = respondToResearchQuestion(p, 'unrelated', {
    kind: 'custom',
    choiceIds: [],
    text: '与本题无关的新回答',
  });
  expect(contextFingerprint(researchDecisionContext(p, p.questions[0]))).toBe(contextVersion);
  expect(() =>
    applyResearchDecisionRepair(p, 'q', expected, contextVersion, decisionCases[1].questions),
  ).not.toThrow();
  p = respondToResearchQuestion(p, 'related', {
    kind: 'custom',
    choiceIds: [],
    text: '同一决策的新限定',
  });
  expect(() =>
    applyResearchDecisionRepair(p, 'q', expected, contextVersion, decisionCases[1].questions),
  ).toThrow('迟到');
});
it('自定义原文与选项版本进入后续模型上下文，不确定保留open并有暂定建议', () => {
  let p = research();
  p.questions[0] = {
    ...p.questions[0],
    ...initializeDecision(decisionCases[1].questions[0]),
    recommendation: { choiceId: 'waitlist', reason: '可以保留候补意向供核对' },
  };
  const text = '  用户自己的原文：先登记下一场意向，保留换行\n不承诺本场名额  ';
  p = respondToResearchQuestion(p, 'q', { kind: 'custom', choiceIds: [], text });
  expect(buildLabRequest(p, 'propose_roles').analysis.questions[0].response?.text).toBe(text);
  p = respondToResearchQuestion(p, 'q', { kind: 'uncertain', choiceIds: [], text: '' });
  expect(p.questions[0].status).toBe('open');
  expect(p.questions[0].decision?.provisional?.label).toBe('转入候补名单');
  p = respondToResearchQuestion(p, 'q', {
    kind: 'none',
    choiceIds: [],
    text: '希望重新考虑按场次通知',
  });
  expect(p.questions[0].response?.optionSnapshot).toHaveLength(3);
  expect(p.questions[0].response?.optionsVersion).toBe(1);
});
it('被否定版本不能原样补回；重复补全请求共享一次模型请求', async () => {
  const ctx = caseContext(1);
  ctx.answers = [
    {
      id: 'old',
      title: decisionCases[1].original,
      topic: '满额',
      answer: '都不适用',
      status: 'open',
      response: {
        kind: 'none',
        choiceIds: [],
        text: '',
        optionsVersion: 1,
        optionSnapshot: decisionCases[1].questions[0].choices,
      },
    },
  ];
  vi.mocked(callDeepSeekJSON).mockResolvedValue(response());
  const result = await repairQuestionBatch(
    [{ id: 'q', question: { id: 'q', title: decisionCases[1].original } }],
    ctx,
    'real',
    new AbortController().signal,
  );
  expect(result.get('q')?.questions).toEqual([]);
  const base = {
    operationId: makeId(),
    context: caseContext(1),
    mode: 'real',
    consent: true,
    question: { id: 'q', title: '本轮应如何处理？', detail: '', answer: '', status: 'open' },
  };
  vi.mocked(callDeepSeekJSON)
    .mockReset()
    .mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response();
    });
  const req = () =>
    new Request('http://localhost/api/ai/decision-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base),
    });
  const [a, b] = await Promise.all([POST(req()), POST(req())]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
it('补全期间提交答案使迟到结果过期，快照不变；修复拆题可撤销', () => {
  let p = research();
  const fingerprint = decisionFingerprint(p.questions[0]),
    ctx = contextFingerprint(researchDecisionContext(p, p.questions[0]));
  p = respondToResearchQuestion(p, 'q', {
    kind: 'custom',
    choiceIds: [],
    text: '我刚录入的新决定',
  });
  expect(() =>
    applyResearchDecisionRepair(p, 'q', fingerprint, ctx, decisionCases[1].questions),
  ).toThrow('迟到');
  const snapshot = createSnapshot(p, 'draft');
  p.snapshots.push(snapshot);
  const before = JSON.stringify(snapshot);
  p = applyResearchDecisionRepair(
    p,
    'q',
    decisionFingerprint(p.questions[0]),
    contextFingerprint(researchDecisionContext(p, p.questions[0])),
    decisionCases[0].questions,
  );
  expect(p.questions).toHaveLength(2);
  expect(p.questions[0].decision?.answerNeedsReview).toBe(true);
  expect(JSON.stringify(p.snapshots[0])).toBe(before);
  p = undoResearch(p, p.operations!.at(-1)!.id);
  expect(p.questions).toHaveLength(1);
  expect(p.questions[0].answer).toBe('我刚录入的新决定');
});
it('工作台选项保存、拒绝版本与局部修复使用同一规则，并能撤销拆题', () => {
  let w = newWorkspace('软件工程师');
  w.questions.push({
    id: 'q',
    title: '工作范围是什么？',
    detail: '',
    kind: 'potential',
    important: false,
    targetIds: [],
    refs: [],
    status: 'open',
    answer: '',
    reason: '',
    createdAt: new Date().toISOString(),
  });
  w = applyWorkbenchDecisionRepair(
    w,
    'q',
    decisionFingerprint(w.questions[0]),
    contextFingerprint(workbenchDecisionContext(w, w.questions[0])),
    decisionCases[2].questions,
  );
  w = respondToWorkbenchQuestion(w, 'q', { kind: 'choice', choiceIds: ['service'], text: '' });
  expect(w.questions[0].answer).toBe('服务接口与数据处理');
  expect(w.questions[0].response?.optionSnapshot).toHaveLength(3);
  const old = w.questions[0].response!;
  w = applyWorkbenchDecisionRepair(
    w,
    'q',
    decisionFingerprint(w.questions[0]),
    contextFingerprint(workbenchDecisionContext(w, w.questions[0])),
    decisionCases[0].questions,
  );
  expect(w.questions[0].response).toEqual(old);
  expect(w.questions[0].decision?.answerNeedsReview).toBe(true);
  expect(() => stampDecisionResponse(w.questions[0], old)).toThrow('版本');
  w = undoOperation(w, w.operations[0].id);
  expect(w.questions).toHaveLength(1);
  expect(w.questions[0].response).toEqual(old);
});
