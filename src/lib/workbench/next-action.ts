import type { Workspace } from './model';
import { confirmationChecks, suggestionStale } from './domain';
export function workbenchReviewChecks(w: Workspace) {
  const priority = { question: 0, reference: 1, category: 2, item: 3, 'empty-jd': 4 };
  return confirmationChecks(w).sort((a, b) => priority[a.kind] - priority[b.kind]);
}
export function workbenchNextAction(w: Workspace) {
  const active = w.items.filter((i) => i.status !== 'excluded'),
    tasks = active.filter((i) => i.kind === 'task'),
    requirements = active.filter((i) => i.kind === 'requirement'),
    blocks = active.filter((i) => i.kind === 'block'),
    pendingSuggestions = w.suggestions.filter(
      (s) => s.status === 'pending' && !suggestionStale(w, s),
    );
  const other =
    tasks.filter((i) => i.status !== 'confirmed').length +
    requirements.filter((i) => i.status !== 'confirmed').length +
    pendingSuggestions.length;
  if (!tasks.length)
    return {
      id: 'sources',
      label: w.sources.some((s) => !s.removed) ? '整理岗位任务' : '补充岗位资料',
      target: w.sources.some((s) => !s.removed)
        ? '[data-tour="workbench-extract"]'
        : '[data-tour="workbench-add-source"]',
      note: '先明确实际要完成的工作；无需先确定岗位名称和技术栈。',
      other,
    };
  if (tasks.some((i) => i.status !== 'confirmed'))
    return {
      id: 'tasks',
      label: '确认任务与职责边界',
      target: '[data-tour="workbench-confirm-task"]',
      note: '确认表示采纳这条任务，问题回答不会替代内容确认。',
      other,
    };
  if (requirements.some((i) => i.status !== 'confirmed'))
    return {
      id: 'requirements',
      label: requirements.some((i) => i.category === 'must' && i.status !== 'confirmed')
        ? '检查必要技能'
        : '核对其余岗位条件',
      target: '[data-tour="workbench-confirm-requirement"]',
      note: '必要、加分、可培养或尚未确定分别保留，不强迫猜测经验年限。',
      other,
    };
  if (!blocks.length)
    return {
      id: 'jd',
      label: '生成JD草稿',
      target: '[data-tour="workbench-generate-jd"]',
      note: '只有主动生成才形成正文，未提供的薪资和福利不会变成事实。',
      other,
    };
  if (pendingSuggestions.length)
    return {
      id: 'review',
      label: '审阅修改建议',
      target: '[data-tour="workbench-review-suggestion"]',
      note: '先比较差异，再采纳、拒绝或撤销；不会自动覆盖JD。',
      other,
    };
  const issues = workbenchReviewChecks(w);
  if (!issues.length)
    return {
      id: 'save',
      label: '保存版本或导出JD',
      target: '[data-tour="workbench-versions"]',
      note: '当前内容满足正式保存条件，仍由你主动保存。',
      other,
    };
  return {
    id: 'review-jd',
    label:
      issues[0].kind === 'question'
        ? '处理重要问题'
        : issues[0].kind === 'reference'
          ? '复核变化的依据'
          : issues[0].kind === 'category'
            ? '核对岗位条件分类'
            : '逐段核对JD正文',
    target:
      issues[0].kind === 'question'
        ? '[data-review-question-title]'
        : ['reference', 'category'].includes(issues[0].kind)
          ? '.object-card.selected [data-review-edit], .jd-block.selected [data-review-edit]'
          : '[data-tour="workbench-confirm-block"]',
    note: `${issues[0].message}。${issues[0].instruction}`,
    other: issues.length,
  };
}
