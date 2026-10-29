import { newWorkspace, now, uid, fields, type Workspace, type WorkItem } from './model';
import { emptyAI, localRef, type AIRequest, type AIResult } from './ai-contract';
import { allowedTargetItems } from './ai-scope';
import { paperboatWorkbenchResponse } from '../demo/paperboat-workbench';
const sourceData = [
  {
    title: '项目负责人说明',
    person: '项目负责人（虚构）',
    type: 'person' as const,
    text: '我们要做一个内部订单管理系统，需要完成订单列表、订单详情和基础操作页面。',
  },
  {
    title: '技术负责人说明',
    person: '技术负责人（虚构）',
    type: 'person' as const,
    text: '后端团队已经有人，接口和数据库由现有团队负责。新人主要负责前端页面开发、接口接入和联调。',
  },
  {
    title: '旧JD模板',
    person: '历史招聘文档（虚构）',
    type: 'old-jd' as const,
    text: '独立负责前后端开发和数据库设计；同时熟练掌握Vue和React；承担系统全部功能建设。',
  },
];
export function createExample(): Workspace {
  const w = newWorkspace('内部订单管理系统前端工程师', true);
  w.sources = sourceData.map((s) => ({
    id: uid(),
    title: s.title,
    person: s.person,
    type: s.type,
    createdAt: now(),
    removed: false,
    versions: [{ revision: 1, text: s.text, createdAt: now() }],
  }));
  w.activity.push({ id: uid(), text: '创建虚构示例；尚未提取、确认岗位内容', at: now() });
  return w;
}
function cite(req: AIRequest, sourceId: string, excerpt: string) {
  const s = req.context.sources.find((s) => s.id === sourceId)!;
  return { sourceId, sourceRevision: s.versions.at(-1)!.revision, excerpt };
}
export function exampleResponse(req: AIRequest): AIResult {
  if (req.context.demo) return paperboatWorkbenchResponse(req);
  const out = emptyAI();
  out.notice = '示例演示/预置响应，不代表真实AI理解；所有内容仍须人工确认。';
  const sources = req.context.sources.filter((s) => !s.removed);
  const items = req.context.items;
  if (req.action === 'extract') {
    if (!sources.length) throw new Error('请先录入资料。');
    const project = sources.find((s) => s.versions.at(-1)!.text.includes('订单列表'));
    const tech = sources.find((s) => s.versions.at(-1)!.text.includes('后端团队已经有人'));
    const old = sources.find((s) => s.type === 'old-jd');
    if (!project || !tech || !old)
      throw new Error(
        '预置整理仅支持内置订单系统示例的三份材料。其他岗位请手动整理，或切换真实模式。',
      );
    out.tasks = [
      {
        key: 'pages',
        title: '订单页面建设',
        text: '完成订单列表、订单详情与基础操作页面，形成可使用的前端界面。',
        scope: '前端页面；具体交互细节待澄清',
        category: 'must',
        refs: [cite(req, project.id, project.versions.at(-1)!.text)],
        taskKeys: [],
      },
      {
        key: 'api',
        title: '接口接入与联调',
        text: '接入既有后端接口，与后端团队完成接口联调和页面数据呈现。',
        scope: '前端接口接入，不代表负责接口服务实现',
        category: 'must',
        refs: [cite(req, tech.id, '新人主要负责前端页面开发、接口接入和联调。')],
        taskKeys: [],
      },
      {
        key: 'database',
        title: '独立后端与数据库开发',
        text: '独立负责后端开发和数据库设计。',
        scope: '旧模板内容，与技术负责人说明可能不一致，待人工决定',
        category: 'must',
        refs: [cite(req, old.id, '独立负责前后端开发和数据库设计')],
        taskKeys: [],
      },
    ];
    out.requirements = [
      {
        key: 'framework',
        title: 'Vue与React技术栈要求',
        text: '同时熟练掌握Vue和React。实际技术栈尚未确认。',
        scope: '来自旧模板，需要说明实际用途',
        category: 'must',
        refs: [cite(req, old.id, '同时熟练掌握Vue和React')],
        taskKeys: ['pages'],
      },
      {
        key: 'db-skill',
        title: '独立数据库设计能力',
        text: '能够独立设计数据库。是否属于本岗位条件需由用人负责人决定。',
        scope: '依赖后端与数据库任务范围',
        category: 'must',
        refs: [cite(req, old.id, '独立负责前后端开发和数据库设计')],
        taskKeys: ['database'],
      },
      {
        key: 'communication',
        title: '前后端协作与接口联调能力',
        text: '能够就接口字段、异常处理与联调问题与后端团队沟通。',
        scope: '实际工作情境：接口接入和联调',
        category: 'must',
        refs: [cite(req, tech.id, '新人主要负责前端页面开发、接口接入和联调。')],
        taskKeys: ['api'],
      },
    ];
    out.questions = [
      {
        title: '后端与数据库是否纳入本岗位？',
        detail:
          '旧JD要求全栈建设；技术负责人说明后端已有团队。建议明确岗位边界，资料差异不代表任何一方已确认。',
        important: true,
        targetIds: [],
        refs: [
          cite(req, old.id, '独立负责前后端开发和数据库设计'),
          cite(req, tech.id, '后端团队已经有人，接口和数据库由现有团队负责。'),
        ],
      },
      {
        title: '实际使用Vue还是React？',
        detail:
          '旧模板同时要求两种框架，项目资料尚未说明实际技术栈。请补充负责人反馈，并决定必备与加分条件。',
        important: true,
        targetIds: [],
        refs: [cite(req, old.id, '同时熟练掌握Vue和React')],
      },
    ];
    return out;
  }
  if (req.action === 'questions') {
    for (const i of items.filter(
      (i) => i.kind === 'requirement' && i.status !== 'excluded' && !i.taskIds.length,
    ))
      out.questions.push({
        title: `建议确认「${i.title}」的用途`,
        detail: '该要求没有关联任务；这不等于要求错误，请说明工作情境或关联任务。',
        important: false,
        targetIds: [i.id],
        refs: i.refs.map(({ sourceId, sourceRevision, excerpt }) => ({
          sourceId,
          sourceRevision,
          excerpt,
        })),
      });
    out.notice += out.questions.length
      ? ''
      : ' 当前规则未发现无关联要求；不代表资料不存在其他差异。';
    return out;
  }
  if (req.action === 'draft') {
    if (items.some((i) => i.kind === 'block'))
      throw new Error('已有JD请选中段落进行局部更新；示例模式不会覆盖现有正文。');
    const usable = items.filter((i) => i.status === 'confirmed' && i.category !== 'omit');
    if (!usable.length) throw new Error('请至少确认一项任务或要求，再生成示例草稿。');
    out.blocks = [
      {
        title: '岗位概述',
        text: req.context.title.includes('订单')
          ? '参与内部订单管理系统的前端建设，与现有后端团队协作，完成已确认的页面开发与接口接入工作。'
          : '围绕已确认的岗位职责，与相关团队协作，完成约定的工作与交付。',
        taskIds: usable.filter((i) => i.kind === 'task').map((i) => i.id),
        requirementIds: [],
        refs: [],
      },
    ];
    for (const [title, filter] of [
      ['主要职责', (i: WorkItem) => i.kind === 'task'],
      ['必要条件', (i: WorkItem) => i.kind === 'requirement' && i.category === 'must'],
      ['加分项', (i: WorkItem) => i.kind === 'requirement' && i.category === 'bonus'],
      ['可入职后培养', (i: WorkItem) => i.kind === 'requirement' && i.category === 'train'],
      ['待明确的岗位条件', (i: WorkItem) => i.kind === 'requirement' && i.category === 'unknown'],
    ] as const) {
      const list = usable.filter(filter);
      if (list.length)
        out.blocks.push({
          title,
          text: list.map((i) => `- ${i.text}`).join('\n'),
          taskIds: [...new Set(list.flatMap((i) => (i.kind === 'task' ? [i.id] : i.taskIds)))],
          requirementIds: list.filter((i) => i.kind === 'requirement').map((i) => i.id),
          refs: list.flatMap((i) =>
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
  if (!target) throw new Error('请先选择任务、要求或JD段落。');
  if (target.locked) throw new Error('选中内容已锁定，请先由人解锁。');
  if (req.scope === 'selected' && target.kind === 'block') {
    const usable = items.filter(
      (i) => i.kind !== 'block' && i.status === 'confirmed' && i.category !== 'omit',
    );
    const list = usable.filter((i) => {
      if (/职责|工作任务/.test(target.title)) return i.kind === 'task';
      if (/必要/.test(target.title)) return i.kind === 'requirement' && i.category === 'must';
      if (/加分/.test(target.title)) return i.kind === 'requirement' && i.category === 'bonus';
      if (/培养/.test(target.title)) return i.kind === 'requirement' && i.category === 'train';
      return target.taskIds.includes(i.id) || target.requirementIds.includes(i.id);
    });
    const text = list.map((i) => `- ${i.text}`).join('\n') || '暂无已确认内容，待补充。';
    if (text !== target.text)
      out.groups.push({
        reason: '示例更新：只同步已确认内容到所选段落，须人工审阅。',
        changes: [
          {
            targetId: target.id,
            operation: 'update',
            after: { ...fields(target), text },
            reason: '按当前已确认条目形成差异预览；自定义改写请使用真实模式或人工编辑。',
            refs: list.flatMap((i) =>
              i.refs.map(({ sourceId, sourceRevision, excerpt }) => ({
                sourceId,
                sourceRevision,
                excerpt,
              })),
            ),
          },
        ],
      });
    out.notice += out.groups.length
      ? ' 更新建议已进入审阅，原文尚未改变。'
      : ' 所选段落与已确认内容一致，无需更新。';
    return out;
  }
  const supported = /前端|后端|数据库|React|TypeScript|Vue|精简|澄清|关联|页面|接口/.test(
    req.intent,
  );
  if (!supported)
    throw new Error(
      '该自由请求超出预置示例范围。可尝试“只负责前端页面和接口接入，不负责后端与数据库”，或使用人工编辑/真实模式。',
    );
  const supplement = sources.find(
    (s) => /React/.test(s.versions.at(-1)!.text) && /TypeScript/.test(s.versions.at(-1)!.text),
  );
  const citation = supplement ? [cite(req, supplement.id, supplement.versions.at(-1)!.text)] : [];
  const related = allowedTargetItems(req);
  for (const i of related.filter((i) => !i.locked)) {
    let after = { ...fields(i) };
    let operation: 'update' | 'exclude' = 'update';
    let reason = '根据用户输入的岗位边界提出局部修改，须人工审阅。';
    if (i.title.includes('数据库') && /不负责|不承担|前端|排除|关联/.test(req.intent)) {
      operation = 'exclude';
      after = {
        ...after,
        scope: '按本次用户意图建议不纳入岗位；需人确认',
        category: i.kind === 'requirement' ? 'omit' : i.category,
      };
      reason = '该内容与拟确认的前端范围可能不一致，建议排除；这不是程序判定技能无用。';
    } else if (/技术栈|Vue|React/.test(i.title) && supplement) {
      after = {
        ...after,
        title: 'React与TypeScript开发能力',
        text: '使用React和TypeScript完成前端页面开发与接口接入；Vue不作为必备条件。',
      };
      reason = '用户补充了实际技术栈；保留原始资料，等待本次修改确认。';
    } else if (i.kind === 'block' && /必要|加分|培养/.test(i.title))
      after = {
        ...after,
        text:
          i.text
            .split('\n')
            .filter((line) => !/数据库|后端开发|全栈/.test(line))
            .map((line) =>
              supplement && /Vue/.test(line)
                ? '- 使用React和TypeScript完成前端页面开发和接口接入；Vue不作为必备条件。'
                : line,
            )
            .join('\n') || '岗位条件需根据已确认的前端任务重新补充。',
      };
    else if (i.kind === 'block' && /概述/.test(i.title))
      after = {
        ...after,
        text: '参与内部订单管理系统前端建设，负责页面交付及既有接口接入，与现有后端团队完成联调。',
      };
    else if (i.kind === 'block')
      after = {
        ...after,
        text:
          '- 负责订单管理系统的前端页面开发、接口接入与联调。\n- 后端接口与数据库由现有团队负责，本岗位不独立承担后端和数据库开发。' +
          (supplement
            ? '\n- 使用React和TypeScript；Vue不作为必备条件。'
            : '\n- 实际技术栈待负责人确认。'),
      };
    else if (i.id === target.id && /精简/.test(req.intent))
      after = { ...after, text: i.text.split('。')[0] + '。' };
    else if (i.id === target.id)
      after = {
        ...after,
        scope: '仅负责前端页面开发、接口接入与联调；后端和数据库由既有团队负责。',
      };
    else continue;
    if (operation === 'update' && JSON.stringify(after) === JSON.stringify(fields(i))) continue;
    out.groups.push({
      reason: '独立建议 · 可单独审阅',
      changes: [
        {
          targetId: i.id,
          operation,
          after,
          reason,
          refs: citation.length
            ? citation
            : i.refs.map(({ sourceId, sourceRevision, excerpt }) => ({
                sourceId,
                sourceRevision,
                excerpt,
              })),
        },
      ],
    });
  }
  if (out.groups.length > 1 && /一起|成组|同步/.test(req.intent))
    out.groups = [
      {
        reason: '必要关联建议组：根据本次同步意图，共同审阅并作为一个事务生效。',
        changes: out.groups.flatMap((group) => group.changes),
      },
    ];
  if (!out.groups.length) out.notice += ' 没有可修改的未锁定关联内容。';
  return out;
}
export const demoSupplement =
  '当前项目使用React和TypeScript，Vue不是必备条件；该岗位不承担独立后端和数据库开发。';
export function exampleRefs(w: Workspace) {
  return w.sources.flatMap((s) => s.versions.map((v) => localRef(s.id, v.revision, v.text)));
}
