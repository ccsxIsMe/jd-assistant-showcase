import { describe, expect, it } from 'vitest';
import { newItem, newWorkspace, now, type Question } from '../../src/lib/workbench/model';
import {
  confirmationChecks,
  confirmationIssues,
  saveVersion,
  setItemState,
} from '../../src/lib/workbench/domain';
import { workbenchNextAction, workbenchReviewChecks } from '../../src/lib/workbench/next-action';

function workspace() {
  const w = newWorkspace('软件工程师 · 人工核对测试');
  const task = newItem('task', '完成页面交付');
  const requirement = newItem('requirement', '界面实现能力');
  task.status = requirement.status = 'confirmed';
  w.items = [task, requirement, newItem('block', '主要职责', '完成页面交付与验收。')];
  return w;
}
function question(status: Question['status'] = 'open'): Question {
  return {
    id: 'q-review',
    title: '本岗位是否承担上线后的值守？',
    detail: '这会影响职责范围。',
    status,
    important: true,
    kind: 'human',
    answer: '',
    reason: '',
    refs: [],
    targetIds: [],
    createdAt: now(),
  };
}

describe('JD核对待办与实际确认规则一致', () => {
  it('未确认正文提供具体段落入口和正确计数，不将导航当作确认', () => {
    const w = workspace();
    w.items.push(newItem('block', '协作方式', '按项目协作。'));
    const before = structuredClone(w);
    expect(workbenchNextAction(w)).toMatchObject({
      id: 'review-jd',
      label: '逐段核对JD正文',
      target: '[data-tour="workbench-confirm-block"]',
      other: 2,
    });
    expect(workbenchReviewChecks(w).map((c) => c.itemId)).toEqual(
      w.items.slice(2).map((i) => i.id),
    );
    expect(workbenchReviewChecks(w)[0].instruction).toContain('确认段落');
    expect(w).toEqual(before);
    expect(() => saveVersion(w, 'confirmed')).toThrow();
  });
  it('重要问题优先定位到现有回答入口，已回答问题不重复出现', () => {
    const w = workspace();
    w.questions = [question(), { ...question('resolved'), id: 'answered', answer: '不承担' }];
    expect(workbenchNextAction(w)).toMatchObject({
      label: '处理重要问题',
      target: '[data-review-question-title]',
      other: 2,
    });
    const check = workbenchReviewChecks(w)[0];
    expect(check.questionId).toBe('q-review');
    expect(workbenchReviewChecks(w).some((c) => c.questionId === 'answered')).toBe(false);
  });
  it('暂缓的重要问题保留未知并允许草稿，不能被引导自动视为已解决', () => {
    const w = workspace();
    w.questions = [question('deferred')];
    expect(workbenchReviewChecks(w)[0].instruction).toContain('保存草稿');
    const draft = saveVersion(w, 'draft');
    expect(draft.versions[0].questions[0].status).toBe('deferred');
    expect(() => saveVersion(w, 'confirmed')).toThrow();
  });
  it('未知条件和失效依据有不同编辑入口，保留原正式保存校验与提示', () => {
    const w = workspace();
    w.items[1].category = 'unknown';
    w.items[1].refs = [
      { sourceId: 'missing', sourceRevision: 1, excerpt: '已失效资料', start: 0, verified: true },
    ];
    const checks = workbenchReviewChecks(w);
    expect(checks[0]).toMatchObject({ kind: 'reference', itemId: w.items[1].id });
    expect(checks.find((c) => c.kind === 'category')?.actionLabel).toBe('核对条件分类');
    expect(confirmationIssues(w)).toEqual([
      '界面实现能力的条件分类仍未知',
      '主要职责尚未确认',
      '界面实现能力的依据需复核',
    ]);
    expect(confirmationChecks(w).map((c) => c.message)).toEqual(confirmationIssues(w));
    expect(() => saveVersion(w, 'confirmed')).toThrow();
  });
  it('逐段人工确认后才进入保存；排除内容不再次要求确认', () => {
    let w = workspace();
    const excluded = newItem('block', '不采用的段落');
    excluded.status = 'excluded';
    w.items.push(excluded);
    w = setItemState(w, w.items[2].id, 'confirmed');
    expect(workbenchReviewChecks(w)).toEqual([]);
    expect(workbenchNextAction(w).id).toBe('save');
    expect(saveVersion(w, 'confirmed').versions[0].kind).toBe('confirmed');
  });
});
