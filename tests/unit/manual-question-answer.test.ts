import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { WorkbenchDecision } from '../../src/components/decisions/repairable-decision';
import { newWorkspace, now, type Question } from '../../src/lib/workbench/model';
import { initializeDecision, inspectDecision } from '../../src/lib/decisions/quality';

function question(): Question {
  return {
    id: 'manual-test',
    title: '本岗位是否承担上线后的值守？',
    detail: '',
    kind: 'human',
    important: true,
    status: 'open',
    answer: '',
    reason: '',
    targetIds: [],
    refs: [],
    createdAt: now(),
  };
}
function render(q: Question, editRequested = false) {
  const w = newWorkspace('人工问题固定验收（虚构）');
  w.questions = [q];
  return load(
    renderToStaticMarkup(
      createElement(WorkbenchDecision, {
        workspace: w,
        question: q,
        update: () => {},
        editRequested,
      }),
    ),
  );
}
describe('人工问题回答入口不依赖可选说明和模型选项', () => {
  it('从待办显式打开继承答案时进入同一个回答框，普通浏览仍可快捷确认沿用', () => {
    const q = initializeDecision({ ...question(), answer: '研究决定：运维负责值守。' });
    q.decision!.inheritedFrom = {
      projectId: 'research',
      snapshotId: 'snapshot',
      questionId: 'upstream-q',
    };
    expect(render(q).text()).toContain('确认沿用到当前岗位');
    const $ = render(q, true);
    expect($('textarea').text()).toBe(q.answer);
    expect($('textarea').length).toBe(1);
    expect(q.status).toBe('open');
  });
  it('旧人工问题只剩辅助或无效选项时保留原选项，但提供文字回答入口', () => {
    const q = {
      ...question(),
      choices: [
        { id: 'old-other', label: '其他，请填写', impact: '辅助入口' },
        { id: 'old-unsure', label: '我不确定', impact: '' },
      ],
    };
    const before = structuredClone(q),
      $ = render(q);
    expect($('textarea').length).toBe(1);
    expect($('.decision-incomplete').length).toBe(0);
    expect(q).toEqual(before);
  });
  it('没有补充说明也显示回答框、保存和未知/暂缓操作', () => {
    const q = question(),
      before = structuredClone(q),
      $ = render(q);
    expect($('textarea').length).toBe(1);
    expect(
      $('button')
        .map((_, e) => $(e).text())
        .get(),
    ).toEqual(expect.arrayContaining(['保存这个决定', '我还不确定', '暂缓这项问题']));
    expect($('.decision-incomplete').length).toBe(0);
    expect(q).toEqual(before);
  });
  it('历史复合人工问题显示原回答供复核，保留历史和生成状态', () => {
    const q = initializeDecision({
      ...question(),
      title: '岗位预算和交付时间如何确定？',
      answer: '旧决定：预算由负责人补充。',
      status: 'resolved' as const,
    });
    q.decision!.answerNeedsReview = true;
    const before = structuredClone(q),
      $ = render(q);
    expect($('textarea').text()).toBe(q.answer);
    expect($('[data-testid="decision-answer-review"]').text()).toContain('已有回答需要重新核实');
    expect($('.decision-incomplete').length).toBe(0);
    expect(q).toEqual(before);
    expect(inspectDecision(q).ready).toBe(false);
  });
  it('AI选择题缺失选项仍显示未完成，不能用人工入口伪装为生成成功', () => {
    const q = { ...question(), kind: 'potential' as const },
      $ = render(q);
    expect($('.decision-incomplete').length).toBe(1);
    expect($('textarea').length).toBe(0);
    expect(inspectDecision(q).ready).toBe(false);
  });
  it('有真实业务选项的人工问题仍展示业务卡片，不改成强制文字输入', () => {
    const q = {
        ...question(),
        choices: [
          { id: 'handoff', label: '交付后由运维值守', impact: '岗位聚焦开发交付' },
          { id: 'oncall', label: '岗位参与轮值', impact: '需要明确轮值范围和安排' },
        ],
      },
      $ = render(q);
    expect($('.decision-business-options input').length).toBe(2);
    expect($('textarea').length).toBe(0);
    expect($('.decision-incomplete').length).toBe(0);
  });
});
