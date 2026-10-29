import { describe, expect, it } from 'vitest';
import { createExample, exampleResponse } from '../../src/lib/workbench/example';
import { createCompletedExample } from '../../src/lib/workbench/completed-example';
import { ingestAI, validateAIResult } from '../../src/lib/workbench/ai-apply';
import {
  addSuggestions,
  applySuggestion,
  confirmationIssues,
  contextKey,
  editItem,
  makeChange,
  mergeTasks,
  rejectSuggestion,
  reorderTask,
  reviseSource,
  restoreVersion,
  saveVersion,
  setItemState,
  splitTask,
  suggestionStale,
  undoOperation,
  validateReference,
  jdBody,
} from '../../src/lib/workbench/domain';
import {
  fields,
  now,
  uid,
  workspaceSchema,
  type ItemFields,
  type Suggestion,
  type Workspace,
} from '../../src/lib/workbench/model';
import { emptyAI, type AIRequest } from '../../src/lib/workbench/ai-contract';
function seed() {
  let w = createExample();
  const req: AIRequest = {
    action: 'extract',
    mode: 'example',
    context: w,
    targetId: null,
    intent: '',
  };
  w = ingestAI(w, w, req, exampleResponse(req));
  return w;
}
function suggestion(w: Workspace, ids: string[]): Suggestion {
  return {
    suggestionId: uid(),
    workspaceId: w.id,
    baseRevision: w.revision,
    contextKey: contextKey(w, ids[0], '修改范围'),
    intent: '修改范围',
    createdAt: now(),
    changes: ids.map((id) => {
      const i = w.items.find((i) => i.id === id)!;
      return makeChange(
        i,
        { ...fields(i), text: '只负责前端页面与接口接入。' },
        '根据人工意图建议修改',
      );
    }),
    preconditions: [],
    status: 'pending',
    groupReason: ids.length > 1 ? '必须一起生效' : '独立建议',
    error: '',
  };
}
describe('岗位对象、引用与人工确认', () => {
  it('提取全部待确认，引用准确定位，技术栈未擅自确定', () => {
    const w = seed();
    expect(w.items.every((i) => i.status === 'pending')).toBe(true);
    expect(w.items.flatMap((i) => i.refs).every((r) => r.verified)).toBe(true);
    expect(w.questions.some((q) => q.title.includes('React'))).toBe(true);
    for (const i of w.items)
      for (const r of i.refs) {
        const s = w.sources.find((s) => s.id === r.sourceId)!;
        expect(s.versions[0].text.slice(r.start!, r.start! + r.excerpt.length)).toBe(r.excerpt);
      }
  });
  it('伪造引用标为待核实，不编造位置', () => {
    const w = seed();
    const ref = {
      sourceId: w.sources[0].id,
      sourceRevision: 1,
      excerpt: '不在原文中的句子',
      start: 0,
      verified: true,
    };
    expect(validateReference(w.sources, ref)).toMatchObject({ verified: false, start: null });
  });
  it('确认后修改转需复核，明确修改并确认才恢复', () => {
    let w = seed();
    const id = w.items[0].id;
    w = setItemState(w, id, 'confirmed');
    w = editItem(w, id, { text: '更新了实际交付结果。' });
    expect(w.items.find((i) => i.id === id)!.status).toBe('review');
    w = editItem(w, id, { text: '明确确认新的实际交付结果。' }, true);
    expect(w.items.find((i) => i.id === id)!.status).toBe('confirmed');
  });
  it('资料新版本保留历史并使依赖需复核，移除不丢历史', () => {
    let w = seed();
    const source = w.sources[0];
    const original = source.versions[0].text;
    const dependent = w.items.find((i) => i.refs.some((r) => r.sourceId === source.id))!;
    w = setItemState(w, dependent.id, 'confirmed');
    w = reviseSource(w, source.id, '项目已经调整，需要重新讨论页面工作范围。');
    expect(w.sources[0].versions[0].text).toBe(original);
    expect(w.items.find((i) => i.id === dependent.id)!.status).toBe('review');
    expect(w.items.find((i) => i.id === dependent.id)!.refs[0].sourceRevision).toBe(1);
    w = reviseSource(w, source.id, '', true);
    expect(w.sources[0].removed).toBe(true);
    expect(w.sources[0].versions).toHaveLength(2);
  });
  it('拆分、合并和排序保留原内容、引用和修改记录', () => {
    let w = seed();
    const task = w.items[0];
    w = splitTask(w, task.id);
    const parts = w.items.filter((i) => i.title.startsWith(task.title + ' · 拆分'));
    expect(parts).toHaveLength(2);
    expect(w.items.find((i) => i.id === task.id)!.status).toBe('excluded');
    expect(parts[0].refs).toEqual(task.refs);
    w = mergeTasks(
      w,
      parts.map((i) => i.id),
    );
    const merged = w.items.at(-1)!;
    expect(merged.refs).toHaveLength(task.refs.length * 2);
    expect(parts.every((p) => w.items.find((i) => i.id === p.id)!.status === 'excluded')).toBe(
      true,
    );
    w = reorderTask(w, merged.id, -1);
    expect(w.activity.length).toBeGreaterThan(0);
  });
});
describe('局部建议的事务与撤销', () => {
  it('预览不改内容；应用独立建议不改未选中正文', () => {
    let w = seed();
    const before = structuredClone(w);
    const id = w.items[0].id;
    const s = suggestion(w, [id]);
    w = addSuggestions(w, [s]);
    expect(w.items).toEqual(before.items);
    w = applySuggestion(w, s.suggestionId);
    expect(w.items.find((i) => i.id === id)!.text).toContain('只负责前端');
    for (const item of before.items.filter((i) => i.id !== id))
      expect(w.items.find((i) => i.id === item.id)!.text).toBe(item.text);
  });
  it('绕过界面也不能改锁定项，锁定不代表确认', () => {
    let w = seed();
    const id = w.items[0].id;
    const s = suggestion(w, [id]);
    w = addSuggestions(w, [s]);
    w.items.find((i) => i.id === id)!.locked = true;
    const before = structuredClone(w);
    expect(() => applySuggestion(w, s.suggestionId)).toThrow('锁定');
    expect(w).toEqual(before);
    expect(w.items[0].status).toBe('pending');
  });
  it('目标修改后的迟到建议过期，不覆盖输入；无关修改不导致过期', () => {
    let w = seed();
    const s = suggestion(w, [w.items[0].id]);
    const base = structuredClone(w);
    w = editItem(w, w.items[1].id, { text: '无关任务最新人工内容' });
    expect(suggestionStale(w, s)).toBe(false);
    w = editItem(w, w.items[0].id, { text: 'AI期间输入的新内容' });
    w = addSuggestions(w, [s]);
    expect(w.suggestions[0].status).toBe('stale');
    expect(() => applySuggestion(w, s.suggestionId)).toThrow();
    expect(w.items[0].text).toBe('AI期间输入的新内容');
    expect(base.items[0].text).not.toBe(w.items[0].text);
  });
  it('重复应用被阻止；必要关联组任一锁定则整体不改', () => {
    let w = seed();
    const group = suggestion(
      w,
      w.items
        .filter((i) => i.kind === 'task')
        .slice(0, 2)
        .map((i) => i.id),
    );
    w = addSuggestions(w, [group]);
    w.items[1].locked = true;
    const before = structuredClone(w.items);
    expect(() => applySuggestion(w, group.suggestionId)).toThrow();
    expect(w.items).toEqual(before);
    w.items[1].locked = false;
    w = applySuggestion(w, group.suggestionId);
    expect(() => applySuggestion(w, group.suggestionId)).toThrow('重复');
  });
  it('拒绝后记录保留，相同上下文不重复插入', () => {
    let w = seed();
    const s = suggestion(w, [w.items[0].id]);
    w = addSuggestions(w, [s]);
    w = rejectSuggestion(w, s.suggestionId);
    w = addSuggestions(w, [{ ...s, suggestionId: uid() }]);
    expect(w.suggestions).toHaveLength(1);
    expect(w.suggestions[0].status).toBe('rejected');
  });
  it('撤销仅恢复受影响内容，保留之后无关修改', () => {
    let w = seed();
    const id = w.items[0].id;
    const text = w.items[0].text;
    const s = suggestion(w, [id]);
    w = addSuggestions(w, [s]);
    w = applySuggestion(w, s.suggestionId);
    const op = w.operations[0];
    const other = w.items.find((i) => i.kind === 'task' && i.id !== id)!;
    w = editItem(w, other.id, { text: '后来修改的无关工作内容' });
    w = undoOperation(w, op.id);
    expect(w.items.find((i) => i.id === id)!.text).toBe(text);
    expect(w.items.find((i) => i.id === other.id)!.text).toBe('后来修改的无关工作内容');
  });
  it('撤销目标冲突时不回滚任何内容', () => {
    let w = seed();
    const id = w.items[0].id;
    const s = suggestion(w, [id]);
    w = addSuggestions(w, [s]);
    w = applySuggestion(w, s.suggestionId);
    const op = w.operations[0];
    w = editItem(w, id, { text: '应用后又手动编辑' });
    const before = structuredClone(w);
    expect(() => undoOperation(w, op.id)).toThrow('冲突');
    expect(w).toEqual(before);
  });
  it('排除任务只提示关联要求复核，不擅自删除能力条件', () => {
    let w = seed();
    const task = w.items.find((i) => i.title === '独立后端与数据库开发')!;
    const requirement = w.items.find((i) => i.taskIds.includes(task.id))!;
    const text = requirement.text;
    w = setItemState(w, task.id, 'excluded');
    expect(w.items.find((i) => i.id === requirement.id)!).toMatchObject({ status: 'review', text });
  });
  it('应用字段白名单拒绝额外属性', () => {
    let w = seed();
    const id = w.items[0].id;
    const s = suggestion(w, [id]);
    w = addSuggestions(w, [s]);
    expect(() =>
      applySuggestion(w, s.suggestionId, {
        [id]: { ...fields(w.items[0]), id: 'injected' } as unknown as ItemFields,
      }),
    ).toThrow();
  });
});
describe('模型边界、快照与导出', () => {
  it('恢复历史先保留近期草稿，历史快照不可变并恢复为需复核', () => {
    let w = createCompletedExample();
    const id = w.versions[0].id;
    const original = JSON.stringify(w.versions[0]);
    const block = w.items.find((i) => i.kind === 'block')!;
    w = editItem(w, block.id, { text: '恢复历史前刚刚编辑的近期正文，必须保留。' });
    const count = w.versions.length;
    w = restoreVersion(w, id);
    expect(w.versions).toHaveLength(count + 1);
    expect(w.versions[0].items.find((i) => i.id === block.id)!.text).toContain('近期正文');
    expect(JSON.stringify(w.versions.find((v) => v.id === id))).toBe(original);
    expect(w.items.find((i) => i.id === block.id)!.status).toBe('review');
    expect(w.items.find((i) => i.id === block.id)!.text).toBe(block.text);
  });
  it('模型不能修改非关联或锁定对象', () => {
    const w = seed();
    const req: AIRequest = {
      action: 'suggest',
      mode: 'example',
      context: w,
      targetId: w.items[0].id,
      intent: '精简',
    };
    const data = emptyAI();
    data.groups = [
      {
        reason: '修改',
        changes: [
          {
            targetId: w.items[1].id,
            operation: 'update',
            after: fields(w.items[1]),
            reason: '越界',
            refs: [],
          },
        ],
      },
    ];
    expect(() => validateAIResult(req, data)).toThrow('直接关联');
    data.groups[0].changes[0].targetId = w.items[0].id;
    w.items[0].locked = true;
    expect(() => validateAIResult(req, data)).toThrow('锁定');
  });
  it('草稿与确认版本区分，保存快照不可受之后编辑影响', () => {
    let w = seed();
    expect(() => saveVersion(w, 'confirmed')).toThrow('未确认');
    w = saveVersion(w, 'draft');
    const text = w.versions[0].items[0].text;
    w = editItem(w, w.items[0].id, { text: '之后的不同工作内容' });
    expect(w.versions[0].items[0].text).toBe(text);
    expect(jdBody(w)).toContain('草稿');
  });
  it('完成示例可正式确认，不编造薪资福利，数据可校验恢复', () => {
    const w = createCompletedExample();
    expect(confirmationIssues(w)).toEqual([]);
    expect(w.versions[0].kind).toBe('confirmed');
    const markdown = jdBody(w);
    expect(markdown).toContain('虚构示例');
    expect(markdown).not.toContain('五险一金');
    expect(markdown).not.toContain('sourceId');
    expect(workspaceSchema.safeParse(JSON.parse(JSON.stringify(w))).success).toBe(true);
  });
});
