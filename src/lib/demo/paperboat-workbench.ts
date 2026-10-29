import { emptyAI, type AIRequest, type AIResult } from '../workbench/ai-contract';
import { fields } from '../workbench/model';
export function paperboatWorkbenchResponse(req: AIRequest): AIResult {
  const out = emptyAI(),
    items = req.context.items;
  out.notice =
    '示例项目｜虚构材料｜预置分析结果；本次仅按已确认内容进行可复验的整理，非真实模型理解。';
  if (req.action === 'extract') {
    if (items.some((i) => i.kind !== 'block')) {
      out.notice += ' 已有导入候选，保留当前任务和要求，不重复生成。';
      return out;
    }
    throw new Error('请从纸舟研究快照导入明确的候选任务；不从任意改写资料套用旧模板。');
  }
  if (req.action === 'questions') {
    out.notice += ' 当前问题保留，不重复生成已存在的问题。';
    return out;
  }
  if (req.action === 'draft') {
    if (items.some((i) => i.kind === 'block'))
      throw new Error('已有JD请进入局部审阅，不覆盖现有草稿。');
    const confirmed = items.filter(
      (i) => i.kind !== 'block' && i.status === 'confirmed' && i.category !== 'omit',
    );
    if (!confirmed.length) throw new Error('请先确认岗位任务与要求。');
    for (const [title, part] of [
      ['主要职责', confirmed.filter((i) => i.kind === 'task')],
      ['必要条件', confirmed.filter((i) => i.kind === 'requirement' && i.category === 'must')],
      ['加分项', confirmed.filter((i) => i.kind === 'requirement' && i.category === 'bonus')],
      ['可入职后培养', confirmed.filter((i) => i.kind === 'requirement' && i.category === 'train')],
      ['待明确条件', confirmed.filter((i) => i.kind === 'requirement' && i.category === 'unknown')],
    ] as const) {
      if (!part.length) continue;
      out.blocks.push({
        title,
        text: part.map((i) => `- ${i.text}`).join('\n'),
        taskIds: [...new Set(part.flatMap((i) => (i.kind === 'task' ? [i.id] : i.taskIds)))],
        requirementIds: part.filter((i) => i.kind === 'requirement').map((i) => i.id),
        refs: part.flatMap((i) =>
          i.refs.map(({ sourceId, sourceRevision, excerpt }) => ({
            sourceId,
            sourceRevision,
            excerpt,
          })),
        ),
      });
    }
    return out;
  }
  const target = items.find((i) => i.id === req.targetId);
  if (!target || target.locked) throw new Error('请选择未锁定的对象，锁定项不会被修改。');
  if (!/精简/.test(req.intent))
    throw new Error(
      '纸舟预置局部建议只覆盖“精简”演示，其他意图已保留，可人工编辑或主动使用真实AI。',
    );
  const text =
    target.text
      .split(/\n|。/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join('。') + '。';
  if (text === target.text) {
    out.notice += ' 当前内容已足够简洁，没有新增差异。';
    return out;
  }
  out.groups.push({
    reason: '预置精简建议：只处理所选对象，事实与来源不扩写。',
    changes: [
      {
        targetId: target.id,
        operation: 'update',
        after: { ...fields(target), text },
        reason: '按现有文字截取前两段表达，不将此操作包装成真实模型分析；采纳前请人工核对。',
        refs: target.refs.map(({ sourceId, sourceRevision, excerpt }) => ({
          sourceId,
          sourceRevision,
          excerpt,
        })),
      },
    ],
  });
  return out;
}
