import { SOFTWARE_OBJECTIVE, SOFTWARE_SOURCES, SOFTWARE_REQUIREMENTS } from './software-content';
import type { AnalysisRequest } from '../exploration/analysis';
import type { AnalysisOutput } from '../exploration/model';
import type { LabStageRequest, LinkOutput, RoleOutput } from '../lab/ai-contract';
import { evidenceNodeId, findingNodeId } from '../lab/graph';
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
function valid(input: AnalysisRequest) {
  for (const source of SOFTWARE_SOURCES) {
    const actual = input.sources.find((s) => s.title === source.title);
    if (!actual || normalize(actual.versions.at(-1)!.text) !== normalize(source.text))
      throw new Error(
        '软件工程师示例资料已改变或范围不足，预置结果不适用；已有编辑保留，可手工继续或使用真实AI。',
      );
  }
  for (const s of input.sources)
    if (
      s.kind === 'text' &&
      !SOFTWARE_SOURCES.some((v) => v.title === s.title) &&
      normalize(s.versions.at(-1)!.text) !== normalize(SOFTWARE_OBJECTIVE)
    )
      throw new Error('新资料超出软件工程师预置范围，未套用旧答案。');
}
export function softwareFeatures(input: AnalysisRequest): AnalysisOutput {
  valid(input);
  const evidence = (key: string, part: string) => {
    const title = SOFTWARE_SOURCES.find((s) => s.key === key)!.title,
      source = input.sources.find((s) => s.title === title)!;
    const e = input.evidence.find((e) => e.sourceId === source.id && e.excerpt.includes(part));
    if (!e) throw new Error('本次软件示例证据不足，未生成候选。');
    return e.evidenceId;
  };
  const main = evidence('idea', '首版需要'),
    tech = evidence('idea', '本次演示资料明确选择'),
    a = evidence('capacity-a', '只有管理员'),
    b = evidence('capacity-b', '所有已登录成员');
  const base = {
    parentKey: null,
    priority: 'high' as const,
    phase: 'mvp' as const,
    basis: 'explicit' as const,
    rationale: '依据本次任务原文形成讨论候选，岗位能力仍需人确认。',
    uncertainty: '具体边界与验收方式待核对。',
  };
  return {
    overview: {
      goal: SOFTWARE_OBJECTIVE,
      problem: '需要把软件工程师的工作拆成具体界面、接口、数据与交付能力。',
      users: '小团队的问题提交者与负责人',
      outcome: '形成可验收的软件任务与逐条岗位能力。',
      constraints: '本演示已选React/TypeScript、Node.js；数据库品牌、预算、年限和工期未知。',
      evidenceIds: [main, tech],
      inferredFields: ['problem', 'users', 'outcome'],
    },
    findings: [
      {
        ...base,
        key: 'signup',
        kind: 'feature',
        title: '问题表单与React界面',
        description:
          '完成问题创建、列表、状态反馈及表单校验，使用本演示资料明确选择的React与TypeScript。',
        behavior: '创建问题、浏览列表与状态反馈',
        outcome: '可复验的界面和交互样例',
        evidenceIds: [main, tech],
      },
      {
        ...base,
        key: 'capacity',
        kind: 'feature',
        title: 'Node.js接口与权限边界',
        description: '提供问题状态变更接口，处理输入和权限校验；哪种权限规则生效仍待人工决定。',
        behavior: '输入校验、权限校验与状态变更',
        outcome: '接口行为和错误反馈可验证',
        evidenceIds: [tech, a, b],
      },
      {
        ...base,
        key: 'export',
        kind: 'feature',
        title: '问题数据、搜索与CSV导出',
        description: '存储问题和操作记录，按条件查询并导出列表；数据库品牌尚未确认。',
        behavior: '保存、查询与导出问题记录',
        outcome: '可核对的数据关系和导出样例',
        evidenceIds: [main],
      },
      {
        ...base,
        key: 'handover',
        kind: 'condition',
        basis: 'inferred',
        title: '测试与持续交付（专业推断）',
        description:
          '状态变更与权限需要可重复验证，建议讨论自动化测试和交付检查；CI工具不是已确认事实。',
        behavior: '验证异常与回归',
        outcome: '有条件的工程质量候选',
        evidenceIds: [a],
      },
      {
        ...base,
        key: 'scope-conflict',
        kind: 'conflict',
        basis: 'observed',
        title: '首版权限规则待核实',
        description:
          '同一首版的说明A仅允许管理员改状态，说明B允许全部已登录成员改状态，需要人明确生效规则。',
        behavior: '管理员与全部成员的权限边界不一致',
        outcome: '人工选择当前假设并保留双方证据',
        evidenceIds: [a, b],
      },
    ],
    questions: [
      {
        title: '首版谁可以修改问题状态？',
        detail: '两份同一阶段材料不一致，不能用模型替负责人批准。',
        findingKeys: ['capacity', 'scope-conflict'],
        evidenceIds: [a, b],
        choices: [
          {
            id: 'rbac',
            label: '仅管理员可改状态',
            impact: '需要在接口落实管理员权限并覆盖越权测试。',
          },
          {
            id: 'open',
            label: '所有已登录成员可改',
            impact: '仍需登录校验和操作记录，职责边界不同。',
          },
        ],
      },
      {
        title: '数据库与部署平台是否已有约束？',
        detail: '可以暂缓，数据库品牌和CI平台未知时不写成硬性条件。',
        findingKeys: [],
        evidenceIds: [],
      },
    ],
    notice: '示例项目｜虚构材料｜预置分析结果；软件工程师能力候选未经真实AI生成。',
  };
}
export function softwareLinks(input: LabStageRequest): LinkOutput {
  valid(input.analysis);
  const f = (title: string) => input.analysis.confirmedFindings.find((f) => f.title === title),
    conflict = f('首版权限规则待核实'),
    ui = f('问题表单与React界面'),
    api = f('Node.js接口与权限边界');
  const relations: LinkOutput['relations'] = [];
  if (conflict)
    relations.push({
      sourceNodeId: evidenceNodeId(conflict.evidenceIds[0]),
      targetNodeId: evidenceNodeId(conflict.evidenceIds[1]),
      relationType: 'conflicts_with',
      evidenceRefs: conflict.evidenceIds,
      leftEvidenceIds: [conflict.evidenceIds[0]],
      rightEvidenceIds: [conflict.evidenceIds[1]],
      rationale: conflict.description,
      uncertainty: '同一阶段权限说明的有效性待人工核对。',
    });
  if (ui && api)
    relations.push({
      sourceNodeId: findingNodeId(ui.id),
      targetNodeId: findingNodeId(api.id),
      relationType: 'weakly_related',
      evidenceRefs: [...new Set([...ui.evidenceIds, ...api.evidenceIds])],
      leftEvidenceIds: [],
      rightEvidenceIds: [],
      rationale: '界面与接口属于相关交付范围，但不能据语义相关判断具体人员分工。',
      uncertainty: '候选关联，未经人工核对。',
    });
  return {
    relations: relations.filter(
      (r) =>
        !input.deletedRelations.some(
          (d) =>
            d.sourceNodeId === r.sourceNodeId &&
            d.targetNodeId === r.targetNodeId &&
            d.relationType === r.relationType,
        ),
    ),
    questions: [],
    notice: '示例项目｜虚构材料｜预置分析结果；候选关系可删除和撤销。',
  };
}
export function softwareRoles(input: LabStageRequest): RoleOutput {
  valid(input.analysis);
  if (input.analysis.questions.some((q) => q.response?.kind === 'custom'))
    throw new Error(
      '自定义回答已保存；新范围没有预置答案，可手工修改或使用真实AI，不会重置当前编辑。',
    );
  const expected = softwareFeatures(input.analysis).findings;
  if (
    input.analysis.confirmedFindings.some((f) => {
      const e = expected.find((e) => e.title === f.title);
      return e && e.description !== f.description;
    })
  )
    throw new Error('功能已有人工修改，预置岗位不覆盖新编辑。');
  const titles = {
      signup: '问题表单与React界面',
      capacity: 'Node.js接口与权限边界',
      export: '问题数据、搜索与CSV导出',
      handover: '测试与持续交付（专业推断）',
    },
    find = (key: string) =>
      input.analysis.confirmedFindings.find(
        (f) => f.title === titles[key as keyof typeof titles] && f.status !== 'excluded',
      );
  const core = ['signup', 'capacity', 'export'].flatMap((key) =>
      find(key) ? [find(key)!.id] : [],
    ),
    refs = [
      ...new Set(
        core.flatMap(
          (id) => input.analysis.confirmedFindings.find((f) => f.id === id)!.evidenceIds,
        ),
      ),
    ];
  if (!core.length)
    return { solutions: [], questions: [], notice: '没有可用软件任务，不强造岗位。' };
  const requirements = SOFTWARE_REQUIREMENTS.flatMap((r) => {
    const f = find(r.feature),
      related = r.feature === 'handover' ? find('capacity') : f;
    return f && related
      ? [
          {
            key: r.key,
            roleKey: 'delivery',
            title: r.title,
            description: r.text,
            requirementType: r.type,
            relatedFeatureIds: [related.id],
            evidenceIds: f.evidenceIds,
            inferenceIds: r.feature === 'handover' ? [f.id] : [],
            rationale:
              r.feature === 'handover'
                ? '专业能力建议：状态和权限需要回归验证，具体CI平台未知。'
                : '岗位能力建议来自本次软件任务；React/TypeScript与Node.js由本案例资料明确选择。',
            uncertainty: '能力要求默认待确认，具体边界与本人项目证据仍需核对。',
          },
        ]
      : [];
  });
  const base = {
    description: '围绕问题追踪系统比较交付职责；不凭截图推断人数、年限和薪资。',
    rationale: '来源为本次界面、接口、数据任务以及明确的演示技术选择。',
    assumptions: ['权限规则等待人决定', '数据库品牌、预算与交付时间未知'],
    openQuestions: ['现有团队能承担哪些接口与运维工作？', '谁负责验收与维护？'],
    relatedFeatureIds: core,
    relatedEvidenceIds: refs,
  };
  return {
    solutions: [
      {
        ...base,
        key: 'services',
        title: '现有服务组合 · 暂不新增招聘',
        hiringNeed: 'not-needed',
        advantages: ['先验证流程，减少定制建设'],
        disadvantages: ['需核实服务的权限与导出限制'],
        roles: [
          {
            key: 'operator',
            title: '现有团队配置与验收（非新增招聘）',
            headcount: null,
            rationale: '先核对现有工具是否已满足任务。',
          },
        ],
        requirements: [],
        productPlan: {
          goal: '用现有服务验证问题追踪流程',
          priorityFeatureIds: core,
          deferredFeatureIds: [],
          difference: '暂不建设完整定制应用，不强造招聘要求。',
          complexity: '服务适配限制和成本需核实。',
          capabilityNotes: ['工具配置、权限验收与记录管理'],
        },
      },
      {
        ...base,
        key: 'engineer',
        title: '软件工程师（Web应用方向）',
        hiringNeed: 'candidate',
        advantages: ['围绕同一业务明确界面、接口与数据的交付责任'],
        disadvantages: ['需要核对单个角色是否覆盖实际任务范围'],
        roles: [
          {
            key: 'delivery',
            title: '软件工程师（Web应用方向）',
            headcount: null,
            rationale: '以可验收的软件任务讨论能力，人数仍需评估。',
          },
        ],
        requirements,
        productPlan: {
          goal: '交付问题表单、状态接口、查询与导出',
          priorityFeatureIds: core,
          deferredFeatureIds: [],
          difference:
            '本案例已选React/TypeScript与Node.js，强调可验证的代码、接口、SQL和测试能力。',
          complexity: '涉及界面、接口与数据一致性；不据此承诺工期。',
          capabilityNotes: SOFTWARE_REQUIREMENTS.map((r) => r.title),
        },
      },
      {
        ...base,
        key: 'split',
        title: '前后端分工 · 明确协作契约',
        hiringNeed: 'unknown',
        advantages: ['能按团队已有能力划分深度责任'],
        disadvantages: ['接口契约、联调和跨职责验收成本更高'],
        roles: [
          {
            key: 'delivery',
            title: '前端与接口协作工程师（候选）',
            headcount: null,
            rationale: '是否拆分岗位取决于现有团队和真实工作量。',
          },
        ],
        requirements,
        productPlan: {
          goal: '拆分界面与服务职责并明确接口契约',
          priorityFeatureIds: core,
          deferredFeatureIds: [],
          difference: '围绕代码评审、接口定义和回归验收分工，不自动推断需要两人。',
          complexity: '协作成本较高，具体人数和排期未知。',
          capabilityNotes: ['界面实现与类型边界', '接口契约、数据与权限', '联调与异常路径测试'],
        },
      },
    ],
    questions: [],
    notice: '示例项目｜虚构材料｜预置分析结果；具体能力可审阅，不代表用户已确认。',
  };
}
