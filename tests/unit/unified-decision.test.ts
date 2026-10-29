import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuidedQuestions } from '../../src/components/lab/guided-evidence';
import { newExploration } from '../../src/lib/exploration/model';
import { synchronizeLab } from '../../src/lib/lab/graph';
import {
  respondToResearchQuestion,
  answerQuestion,
  editSolution,
  editRequirement,
} from '../../src/lib/lab/operations';
import { decisionCases } from '../fixtures/decision-cases';
import {
  reconcileDecisions,
  currentDecisions,
  resolveDecision,
  appendGeneratedDecision,
  decisionIdentity,
} from '../../src/lib/decisions/records';
import { undoResearch } from '../../src/lib/exploration/journal';
import { softwareTextProject, completeSoftwareResearch } from '../../src/lib/demo/software';
import { createSnapshot } from '../../src/lib/exploration/domain';
import { materialFromSnapshot } from '../../src/lib/exploration/material';
import { importRequirementMaterial } from '../../src/lib/exploration/workbench-import';
import { newWorkspace, newItem } from '../../src/lib/workbench/model';
import { respondToWorkbenchQuestion, unresolved } from '../../src/lib/workbench/domain';
import { objectVersions } from '../../src/lib/lab/workflow';
import { orderedQuestions } from '../../src/lib/lab/guided';
function pair() {
  const p = seed();
  const q = p.questions[0];
  return [
    {
      ...q,
      id: 'a',
      title: '首版是否需要实时协作？',
      findingIds: ['feature-1'],
      evidenceIds: ['e1'],
    },
    {
      ...q,
      id: 'b',
      title: '第一阶段是否支持多人同时编辑？',
      findingIds: ['feature-1'],
      evidenceIds: ['e2'],
    },
  ];
}
it('同项目、同实体、同阶段的同义决定合并，来源和历史ID完整保留', () => {
  const qs = reconcileDecisions(pair(), 'project-1');
  expect(currentDecisions(qs)).toHaveLength(1);
  expect(resolveDecision(qs, 'b')?.id).toBe('a');
  expect(qs[0].evidenceIds).toEqual(['e1', 'e2']);
  expect(qs[0].decision?.aliasIds).toContain('b');
});
it.each(['phase', 'perspective', 'object', 'dimension'] as const)(
  '不同%s不能因文字或主题相似误合并',
  (kind) => {
    const qs = pair();
    if (kind === 'phase') qs[1].title = '后续版本是否支持多人编辑？';
    if (kind === 'perspective') qs[1].title = '参考产品是否具备多人编辑？';
    if (kind === 'object') qs[1].findingIds = ['feature-2'];
    if (kind === 'dimension') {
      qs[0].title = '角色在游戏中的作用？';
      qs[1].title = '角色采用什么美术风格？';
      qs[1].decisionSpec = { ...qs[1].decisionSpec!, topic: '视觉方向' };
    }
    expect(currentDecisions(reconcileDecisions(qs, 'project-1'))).toHaveLength(2);
  },
);
it('相同题目在不同工作区保持隔离；没有可靠实体的同义猜测不自动合并', () => {
  const qs = pair();
  expect(decisionIdentity(qs[0], 'project-1')).not.toBe(decisionIdentity(qs[0], 'project-2'));
  expect(
    currentDecisions(
      reconcileDecisions(
        qs.map((q) => ({ ...q, findingIds: [] })),
        'project-1',
      ),
    ),
  ).toHaveLength(2);
});
it('同一实时协作功能的实施选择与人数/方式维度不合并，也不覆盖声明的维度', () => {
  const qs = pair();
  qs[1].title = '首版实时协作的人数上限是多少？';
  expect(currentDecisions(reconcileDecisions(qs, 'p'))).toHaveLength(2);
  qs[1].title = qs[0].title;
  qs[1].decisionSpec = {
    ...qs[1].decisionSpec!,
    scope: {
      dimension: '协作容量',
      phase: 'mvp',
      perspective: 'our_product',
      objectIds: ['feature-1'],
    },
  };
  expect(currentDecisions(reconcileDecisions(qs, 'p'))).toHaveLength(2);
});
it('只有一处已回答时沿用原答案；冲突答案不按时间静默覆盖，旧原文不变', () => {
  const qs = pair();
  qs[1].answer = '首版先不做';
  qs[1].status = 'answered';
  const original = JSON.stringify(qs);
  let merged = reconcileDecisions(qs, 'project-1');
  expect(merged[0].answer).toBe('首版先不做');
  expect(merged[0].status).toBe('answered');
  expect(JSON.stringify(qs)).toBe(original);
  qs[0].answer = '首版需要';
  qs[0].status = 'answered';
  merged = reconcileDecisions(qs, 'project-1');
  expect(currentDecisions(merged)).toHaveLength(1);
  expect(merged[0].decision?.answerNeedsReview).toBe(true);
  expect(merged[0].decision?.mergedAnswers?.map((v) => v.answer)).toEqual(
    expect.arrayContaining(['首版需要', '首版先不做']),
  );
});
it('未知/暂缓提示文字不是第二个业务答案，仅一处已答时沿用其版本不要求重填', () => {
  const qs = pair();
  qs[0].answer = '用户尚不确定';
  qs[0].response = { kind: 'uncertain', choiceIds: [], text: '' };
  qs[1].answer = '首版不做';
  qs[1].status = 'answered';
  qs[1].response = {
    kind: 'custom',
    choiceIds: [],
    text: '首版不做',
    optionsVersion: 2,
    questionVersion: 2,
  };
  const merged = reconcileDecisions(qs, 'p');
  expect(merged[0].answer).toBe('首版不做');
  expect(merged[0].decision?.answerNeedsReview).toBe(false);
  expect(merged[0].decision?.optionsVersion).toBe(2);
});
it('已排除记录与另一处已答冲突时仍只显示一次复核，不隐藏历史冲突', () => {
  const p = seed(),
    qs = pair();
  qs[0].status = 'excluded';
  qs[0].answer = '用户原来排除这个问题';
  qs[1].status = 'answered';
  qs[1].answer = '用户曾选择首版做';
  p.questions = reconcileDecisions(qs, p.id);
  expect(orderedQuestions(p)).toHaveLength(1);
  expect(orderedQuestions(p)[0].decision?.answerNeedsReview).toBe(true);
});
it('同阶段重试合并引用而不新增同义记录，不覆盖已回答内容', () => {
  const qs = reconcileDecisions(pair(), 'project-1');
  qs[0].answer = '用户自定义范围';
  qs[0].status = 'answered';
  const next = appendGeneratedDecision(qs, { ...pair()[1], id: 'late' }, 'project-1');
  expect(next).toHaveLength(2);
  expect(next[0].answer).toBe('用户自定义范围');
});
it('重复提交不重复记录，别名改答写到同一记录，撤销不覆盖无关修改', () => {
  let p = seed();
  p.findings.push({
    id: 'feature-1',
    revision: 1,
    kind: 'feature',
    title: '协作范围',
    description: '固定测试功能',
    behavior: '',
    outcome: '',
    basis: 'inferred',
    priority: 'medium',
    phase: 'mvp',
    status: 'pending',
    locked: false,
    evidenceIds: [],
    parentId: null,
    origin: 'user',
  });
  p.questions = reconcileDecisions(
    pair().map((q) => ({ ...q, evidenceIds: [] })),
    p.id,
  );
  const beforeAliasVersion = objectVersions(p)['question:b'];
  p = respondToResearchQuestion(p, 'b', {
    kind: 'custom',
    choiceIds: [],
    text: '首版先验证单人流程',
  });
  expect(objectVersions(p)['question:b']).not.toBe(beforeAliasVersion);
  const count = p.operations?.length;
  p = respondToResearchQuestion(p, 'a', {
    kind: 'custom',
    choiceIds: [],
    text: '首版先验证单人流程',
  });
  expect(p.operations?.length).toBe(count);
  expect(p.questions[0].answer).toBe('首版先验证单人流程');
  p.title = '无关的新标题';
  p = undoResearch(p, p.operations!.at(-1)!.id);
  expect(p.title).toBe('无关的新标题');
  expect(resolveDecision(p.questions, 'b')?.answer).toBe('');
});
it('已回答的工作台决策不会被历史别名的旧待回答状态再次阻塞确认', () => {
  let w = newWorkspace('岗位作用范围');
  const item = newItem('task', '首版协作任务', '固定测试交付');
  w.items.push(item);
  w.questions = reconcileDecisions(
    pair().map((q) => ({
      id: q.id,
      title: q.title,
      detail: q.detail,
      choices: q.choices,
      kind: 'potential' as const,
      important: true,
      targetIds: [item.id],
      refs: [],
      status: 'open' as const,
      answer: '',
      reason: '',
      createdAt: new Date().toISOString(),
    })),
    w.id,
  );
  w = respondToWorkbenchQuestion(w, 'b', {
    kind: 'custom',
    choiceIds: [],
    text: '首版不做，后续再评估',
  });
  expect(w.questions[1].status).toBe('open');
  expect(unresolved(w)).toHaveLength(0);
  w.questions[0].decision!.answerNeedsReview = true;
  expect(unresolved(w)).toHaveLength(1);
  w = respondToWorkbenchQuestion(w, 'a', {
    kind: 'custom',
    choiceIds: [],
    text: '首版不做，后续再评估',
  });
  expect(unresolved(w)).toHaveLength(0);
});
function seed() {
  const p = synchronizeLab(newExploration('唯一回答入口验收'));
  p.questions = [
    {
      id: 'q',
      ...decisionCases[1].questions[0],
      findingIds: [],
      evidenceIds: [],
      status: 'open',
      answer: '',
    },
  ];
  return p;
}
it('同一问题不再同时渲染新版选择题与旧回答框', () => {
  const p = seed();
  const html = renderToStaticMarkup(
    createElement(GuidedQuestions, {
      project: p,
      update: () => true,
      readonly: false,
      onEdit: () => {},
      onFocus: () => {},
    }),
  );
  expect(html).toContain('decision-input');
  expect(html).not.toContain('问题回答：');
});
it('旧入口改答不能留下与当前答案冲突的选择记录', () => {
  let p = respondToResearchQuestion(seed(), 'q', {
    kind: 'choice',
    choiceIds: ['waitlist'],
    text: '',
  });
  p = answerQuestion(p, 'q', '先登记下一场通知意向', 'answered');
  expect(p.questions[0].response).toMatchObject({ kind: 'custom', text: '先登记下一场通知意向' });
});
it('清除当前答案保留可撤销历史，不修改原始资料', () => {
  let p = respondToResearchQuestion(seed(), 'q', {
    kind: 'custom',
    choiceIds: [],
    text: '用户保存的决定',
  });
  const sources = JSON.stringify(p.sources);
  p = respondToResearchQuestion(p, 'q', null);
  expect(p.questions[0].answer).toBe('');
  expect(p.questions[0].response).toBeUndefined();
  p = undoResearch(p, p.operations!.at(-1)!.id);
  expect(p.questions[0].answer).toBe('用户保存的决定');
  expect(JSON.stringify(p.sources)).toBe(sources);
});
it('旧文本入口允许的4000字原文迁入统一回答，不被3000字截断', () => {
  const text = '原'.repeat(4000);
  const p = answerQuestion(seed(), 'q', text, 'answered');
  expect(p.questions[0].response?.text).toBe(text);
});
it('导入的别名循环或悬空引用被拒绝，不能成为隐藏的第二份当前答案', () => {
  const qs = pair();
  qs[0].decision = { ...reconcileDecisions(qs, 'p')[0].decision!, canonicalId: 'missing' };
  expect(() => reconcileDecisions(qs, 'p')).toThrow('引用不存在');
});
it('已回答、自定义与暂缓决定随快照进入岗位，不要求重写；旧快照不变', () => {
  let p = completeSoftwareResearch(
    softwareTextProject({
      fixture: 'software-engineer',
      version: 1,
      instanceId: crypto.randomUUID(),
      kind: 'demo',
      seed: 'complete',
    }),
    new Set(),
  );
  const q = {
    ...seed().questions[0],
    id: 'inherited-decision',
    findingIds: [p.findings.find((f) => f.kind === 'feature')!.id],
  };
  p.questions.push(q);
  p = respondToResearchQuestion(p, q.id, {
    kind: 'custom',
    choiceIds: [],
    text: '首版先采用人工确认，自动处理待后续验证',
  });
  for (const id of p.lab!.activeSolutionIds) p = editSolution(p, id, { status: 'confirmed' });
  for (const r of p.lab!.requirements.filter((r) =>
    p.lab!.activeSolutionIds.includes(r.solutionId),
  ))
    p = editRequirement(p, r.id, { status: 'confirmed' });
  const snapshot = createSnapshot(p, 'draft'),
    before = JSON.stringify(snapshot),
    m = materialFromSnapshot(snapshot);
  const w = importRequirementMaterial(
    newWorkspace('软件工程师'),
    m,
    m.features.map((f) => f.id),
    true,
  );
  const inherited = w.questions.find(
    (q) => q.decision?.inheritedFrom?.questionId === 'inherited-decision',
  )!;
  expect(inherited.answer).toBe('首版先采用人工确认，自动处理待后续验证');
  expect(inherited.response?.kind).toBe('custom');
  expect(inherited.status).toBe('open');
  expect(inherited.decision?.inheritedFrom?.snapshotId).toBe(snapshot.snapshotId);
  if (inherited.decisionSpec?.scope)
    expect(inherited.decisionSpec.scope.objectIds).toEqual(inherited.targetIds);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(w.items.filter((i) => i.kind === 'task').every((i) => i.status === 'pending')).toBe(true);
});
