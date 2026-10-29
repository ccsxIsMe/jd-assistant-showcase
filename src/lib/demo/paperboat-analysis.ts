import {
  PAPERBOAT_OBJECTIVE,
  PAPERBOAT_SOURCES,
  PAPERBOAT_REQUIREMENTS,
} from './paperboat-content';
import type { AnalysisRequest } from '../exploration/analysis';
import type { AnalysisOutput } from '../exploration/model';
import type { LabStageRequest, LinkOutput, RoleOutput } from '../lab/ai-contract';
import { evidenceNodeId, findingNodeId } from '../lab/graph';
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
export function validatePaperboatInput(input: AnalysisRequest) {
  for (const source of PAPERBOAT_SOURCES) {
    const actual = input.sources.find((s) => s.title === source.title);
    if (!actual || normalize(actual.versions.at(-1)!.text) !== normalize(source.text))
      throw new Error(
        '纸舟示例资料已改变或当前范围不足，预置响应不适用；编辑保留，请手工处理或主动使用真实AI。',
      );
  }
  for (const s of input.sources)
    if (
      s.kind === 'text' &&
      !PAPERBOAT_SOURCES.some((v) => v.title === s.title) &&
      normalize(s.versions.at(-1)!.text) !== normalize(PAPERBOAT_OBJECTIVE)
    )
      throw new Error('新增资料超出纸舟预置范围，不会套用旧结论；请手工审阅或使用真实AI。');
}
export function paperboatFeatures(input: AnalysisRequest): AnalysisOutput {
  validatePaperboatInput(input);
  const source = (key: string) =>
    input.sources.find((s) => s.title === PAPERBOAT_SOURCES.find((v) => v.key === key)?.title)!;
  const evidence = (key: string, part: string) => {
    const e = input.evidence.find((e) => e.sourceId === source(key).id && e.excerpt.includes(part));
    if (!e) throw new Error('演示证据不在本次范围，不能生成预置结论。');
    return e.evidenceId;
  };
  const main = evidence('idea', '首版希望'),
    a = evidence('capacity-a', '名额满后仍接受候补'),
    b = evidence('capacity-b', '名额满后立即关闭');
  const base = {
    parentKey: null,
    priority: 'high' as const,
    phase: 'mvp' as const,
    basis: 'explicit' as const,
    rationale: '对应本次用户说明原文，不将参考产品扩展能力当作当前需求。',
    uncertainty: '实施边界与验收仍需人确认。',
  };
  return {
    overview: {
      goal: PAPERBOAT_OBJECTIVE,
      problem: '小团队需要可管理的报名流程，但范围和分工未知。',
      users: '活动参与者与现有运营团队',
      outcome: '收敛首版范围、岗位与交付标准。',
      constraints: '支付、积分、聊天先不纳入；预算、交付时间和技术栈未确定。',
      evidenceIds: [main],
      inferredFields: ['problem', 'outcome'],
    },
    findings: [
      {
        ...base,
        key: 'signup',
        kind: 'feature',
        title: '活动浏览与报名',
        description: '展示活动说明并提交报名，字段、重复提交和验收样例需明确。',
        behavior: '活动浏览、报名',
        outcome: '参与者可完成报名流程',
        evidenceIds: [main],
      },
      {
        ...base,
        key: 'capacity',
        kind: 'feature',
        title: '名额与候补规则',
        description: '需要名额边界，满额后关闭或候补尚有不一致，不能替负责人决定。',
        behavior: '名额管理',
        outcome: '规则明确且可复验',
        evidenceIds: [main, a, b],
      },
      {
        ...base,
        key: 'export',
        kind: 'feature',
        title: '运营名单与CSV导出',
        description: '运营查看名单并导出文件，字段范围、权限和验收样例待确认。',
        behavior: '名单查看和导出',
        outcome: '运营可核对并导出名单',
        evidenceIds: [main],
      },
      {
        ...base,
        key: 'handover',
        kind: 'condition',
        basis: 'inferred',
        title: '交付与维护边界（推断）',
        description: '若采用定制Web，应约定运行、部署与交接；具体托管方式不是已确认事实。',
        behavior: '交付边界需核实',
        outcome: '可由团队接手',
        evidenceIds: [evidence('idea', '没有内部开发团队')],
      },
      {
        ...base,
        key: 'scope-conflict',
        kind: 'conflict',
        basis: 'observed',
        title: '首轮活动满额规则待核实',
        description: '同一首轮活动，运营说明A要求候补，交付说明B要求满额关闭；需核实哪份规则生效。',
        behavior: '候补或关闭不能同时当成确认事实',
        outcome: '由人明确本轮假设',
        evidenceIds: [a, b],
      },
    ],
    questions: [
      {
        title: '首轮满额后关闭报名，还是保留候补？',
        detail: '这是同一首轮活动的两份不同说明，双方证据均保留。',
        findingKeys: ['capacity', 'scope-conflict'],
        evidenceIds: [a, b],
        choices: [
          {
            id: 'close',
            label: '首轮满额关闭报名',
            impact: '首版不建设候补队列，仍需验证名额边界。',
          },
          {
            id: 'waitlist',
            label: '保留候补并人工补位',
            impact: '增加候补状态、通知和运营规则的核对。',
          },
        ],
      },
      {
        title: '技术选型与预算由谁确认？',
        detail: '技术栈和预算未知，可暂缓；不据截图写成必备框架或薪资事实。',
        findingKeys: [],
        evidenceIds: [],
      },
    ],
    notice: '示例项目｜虚构材料｜预置分析结果；演示数据，非真实AI分析。',
  };
}
export function paperboatLinks(input: LabStageRequest): LinkOutput {
  validatePaperboatInput(input.analysis);
  const f = (title: string) => input.analysis.confirmedFindings.find((f) => f.title === title);
  const conflict = f('首轮活动满额规则待核实'),
    signup = f('活动浏览与报名'),
    capacity = f('名额与候补规则');
  const relations: LinkOutput['relations'] = [];
  if (conflict && conflict.evidenceIds.length >= 2)
    relations.push({
      sourceNodeId: evidenceNodeId(conflict.evidenceIds[0]),
      targetNodeId: evidenceNodeId(conflict.evidenceIds[1]),
      relationType: 'conflicts_with',
      evidenceRefs: conflict.evidenceIds,
      leftEvidenceIds: [conflict.evidenceIds[0]],
      rightEvidenceIds: [conflict.evidenceIds[1]],
      rationale: conflict.description,
      uncertainty: '两份材料是否仍有效、是否同一阶段需人核实。',
    });
  if (signup && capacity)
    relations.push({
      sourceNodeId: findingNodeId(signup.id),
      targetNodeId: findingNodeId(capacity.id),
      relationType: 'weakly_related',
      evidenceRefs: [...new Set([...signup.evidenceIds, ...capacity.evidenceIds])],
      leftEvidenceIds: [],
      rightEvidenceIds: [],
      rationale: '都属于报名研究，但不能由语义相关断言实现依赖或岗位分工。',
      uncertainty: '这是待审核弱关联。',
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
    notice: '示例项目｜虚构材料｜预置分析结果；关系仍待审核。',
  };
}
export function paperboatRoles(input: LabStageRequest): RoleOutput {
  validatePaperboatInput(input.analysis);
  if (input.analysis.questions.some((q) => q.response?.kind === 'custom'))
    throw new Error(
      '自定义回答已保存；预置案例不能解释新增范围，请手工调整方案或主动用真实AI分析。',
    );
  const titles = {
    signup: '活动浏览与报名',
    capacity: '名额与候补规则',
    export: '运营名单与CSV导出',
    handover: '交付与维护边界（推断）',
  };
  const f = (key: string) =>
    input.analysis.confirmedFindings.find(
      (f) => f.title === titles[key as keyof typeof titles] && f.status !== 'excluded',
    );
  const expected = paperboatFeatures(input.analysis).findings;
  if (
    input.analysis.confirmedFindings.some((v) => {
      const original = expected.find((e) => e.title === v.title);
      return original && original.description !== v.description;
    })
  )
    throw new Error('人工功能已修改，预置岗位方案不会覆盖新编辑；可手工处理或真实分析。');
  const core = ['signup', 'capacity', 'export'].flatMap((key) => (f(key) ? [f(key)!.id] : [])),
    refs = [
      ...new Set(
        core.flatMap(
          (id) => input.analysis.confirmedFindings.find((f) => f.id === id)!.evidenceIds,
        ),
      ),
    ];
  if (!core.length)
    return { solutions: [], questions: [], notice: '当前没有可用功能，不强行生成岗位。' };
  const requirements = PAPERBOAT_REQUIREMENTS.flatMap((r) => {
    const feature = f(r.feature),
      linked = r.feature === 'handover' ? f('signup') : feature;
    return feature && linked
      ? [
          {
            key: r.key,
            roleKey: 'delivery',
            title: r.title,
            description: r.text,
            requirementType: r.type,
            relatedFeatureIds: [linked.id],
            evidenceIds: feature.evidenceIds,
            inferenceIds: r.feature === 'handover' ? [feature.id] : [],
            rationale:
              r.feature === 'handover'
                ? '基于团队缺少内部开发的交付推断，需人核实。'
                : '按实际功能形成待确认交付候选。',
            uncertainty: '岗位边界、技术选型和本人交付证据仍需核实。',
          },
        ]
      : [];
  });
  const common = {
    description: '完全虚构的方案比较；不据参考截图确定框架、薪资或准确人数。',
    rationale: '依据纸舟实际功能、团队条件和未决名额规则。',
    assumptions: ['名额规则仍需决定', '预算与交付时间未知'],
    openQuestions: ['满额后是否候补？', '谁承担维护与验收？'],
    relatedFeatureIds: core,
    relatedEvidenceIds: refs,
  };
  return {
    solutions: [
      {
        ...common,
        key: 'services',
        title: '现有服务组合 · 暂不新增招聘',
        hiringNeed: 'not-needed',
        advantages: ['先验证报名需求，降低定制负担'],
        disadvantages: ['需核实服务限制、数据导出与费用'],
        roles: [
          {
            key: 'operator',
            title: '现有运营团队配置与维护（非新增招聘）',
            headcount: null,
            rationale: '先验证现有服务是否满足首版，不建议凭空招聘完整团队。',
          },
        ],
        requirements: [],
        productPlan: {
          goal: '用现有服务验证活动报名',
          priorityFeatureIds: core,
          deferredFeatureIds: [],
          difference: '采用现有能力组合，暂不形成招聘要求。',
          complexity: '相对较低；服务约束和实际成本需核实。',
          capabilityNotes: ['运营配置与规则验收，未必需要新增开发岗位'],
        },
      },
      {
        ...common,
        key: 'web',
        title: '轻量定制Web · 明确交付边界',
        hiringNeed: 'candidate',
        advantages: ['范围和名单流程可按团队实际需要实现'],
        disadvantages: ['需要明确部署、维护和验收责任'],
        roles: [
          {
            key: 'delivery',
            title: '活动报名Web交付工程师（候选）',
            headcount: null,
            rationale: '围绕首版功能讨论交付能力，技术栈和人数仍待确认。',
          },
        ],
        requirements,
        productPlan: {
          goal: '交付活动浏览、报名与运营导出',
          priorityFeatureIds: core,
          deferredFeatureIds: [],
          difference: '定制当前首版流程，暂不承担支付、积分和聊天。',
          complexity: '中等；名额规则、托管与维护条件需核实。',
          capabilityNotes: ['页面、业务边界与导出交付；框架按明确选择确定'],
        },
      },
      {
        ...common,
        key: 'phased',
        title: '分阶段扩展 · 先交付再评估',
        hiringNeed: 'unknown',
        advantages: ['保留后续复杂运营的讨论空间'],
        disadvantages: ['需要额外的阶段边界与变更控制'],
        roles: [
          {
            key: 'delivery',
            title: '阶段性交付与系统协调（候选）',
            headcount: null,
            rationale: '是否拆分职责由后续真实范围与团队能力决定。',
          },
        ],
        requirements,
        productPlan: {
          goal: '先完成报名与导出，再决定扩展',
          priorityFeatureIds: [core[0], core.at(-1)!],
          deferredFeatureIds: core.slice(1, -1),
          difference: '先减少首轮范围，名额复杂规则分阶段核实，后续扩展不提前承诺。',
          complexity: '首轮可收敛，但阶段协调成本更高，不能据此承诺工期。',
          capabilityNotes: ['阶段验收与边界协作；未确认扩展不写成必备条件'],
        },
      },
    ],
    questions: [],
    notice: '示例项目｜虚构材料｜预置分析结果；所有方案与要求仍待人确认。',
  };
}
