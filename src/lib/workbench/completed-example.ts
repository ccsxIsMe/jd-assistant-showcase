import { createExample, demoSupplement, exampleResponse } from './example';
import { ingestAI } from './ai-apply';
import { editItem, saveVersion, setItemState } from './domain';
import { now, uid, type Workspace } from './model';
import type { AIRequest } from './ai-contract';
export function createCompletedExample(): Workspace {
  let w = createExample();
  w.title += ' · 完成示例';
  const request = (action: AIRequest['action']): AIRequest => ({
    action,
    mode: 'example',
    context: { id: w.id, revision: w.revision, title: w.title, sources: w.sources, items: w.items },
    targetId: null,
    intent: '',
  });
  let req = request('extract');
  w = ingestAI(w, w, req, exampleResponse(req));
  const source = {
    id: uid(),
    title: '技术栈与岗位范围补充（虚构完成示例）',
    type: 'supplement' as const,
    person: '虚构示例操作者录入；非真实审批',
    createdAt: now(),
    removed: false,
    versions: [{ revision: 1, text: demoSupplement, createdAt: now() }],
  };
  w.sources.push(source);
  for (const item of [...w.items]) {
    if (item.title.includes('数据库')) w = setItemState(w, item.id, 'excluded');
    else if (item.title.includes('Vue')) {
      w = editItem(
        w,
        item.id,
        {
          title: 'React与TypeScript开发能力',
          text: '使用React和TypeScript完成前端页面开发及接口接入；Vue不作为必备条件。',
          refs: [
            {
              sourceId: source.id,
              sourceRevision: 1,
              excerpt: demoSupplement,
              verified: true,
              start: 0,
            },
          ],
        },
        true,
      );
    } else w = setItemState(w, item.id, 'confirmed');
  }
  w.questions = w.questions.map((q) => ({
    ...q,
    status: 'resolved',
    answer: '虚构完成示例：已按补充材料明确前端范围及React/TypeScript技术栈。',
  }));
  req = request('draft');
  w = ingestAI(w, w, req, exampleResponse(req));
  for (const item of w.items.filter((i) => i.kind === 'block'))
    w = setItemState(w, item.id, 'confirmed');
  w = saveVersion(w, 'confirmed');
  w.ui.view = 'jd';
  return w;
}
