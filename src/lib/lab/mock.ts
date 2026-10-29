import { exampleAnalysis } from '../exploration/analysis';
import { stableDecisionId } from '../decisions/quality';
import { softwareFeatures, softwareLinks, softwareRoles } from '../demo/software-analysis';
import {
  characterDesignContext,
  characterDesignFeatures,
  characterDesignRoles,
} from './domain-planning';
import { paperboatFeatures, paperboatLinks, paperboatRoles } from '../demo/paperboat-analysis';
import type { AnalysisOutput, Evidence } from '../exploration/model';
import type { LabStageRequest, LinkOutput, RoleOutput } from './ai-contract';
import { evidenceNodeId, findingNodeId } from './graph';
function featureCandidates(input: LabStageRequest): AnalysisOutput {
  const data = input.analysis;
  const evidence = data.evidence;
  if (!data.sources.some((s) => s.title.includes('演示产品页面'))) return exampleAnalysis(data);
  const by = (pattern: RegExp) => evidence.find((e) => pattern.test(e.excerpt));
  const output: AnalysisOutput = {
    overview: {
      goal: '探索面向小团队的协作设计工具，先明确首版功能和人员边界。',
      problem: '模糊构想、参考产品能力与首版范围需要区分。',
      users: '小团队设计与业务协作成员（待确认）',
      outcome: '形成可核对的产品功能与候选岗位方案。',
      constraints: '预算、技术栈、人员配置与实时同步范围尚未确认。',
      evidenceIds: evidence
        .filter((e) => e.evidenceType === 'user-description')
        .slice(0, 2)
        .map((e) => e.evidenceId),
      inferredFields: ['users', 'problem', 'outcome'],
    },
    findings: [],
    questions: [],
    notice: '演示数据，非真实AI分析。按演示资料生成可复验候选，不代表真实招聘配置。',
  };
  function feature(
    key: string,
    title: string,
    ref: Evidence | undefined,
    basis: 'explicit' | 'observed' | 'inferred',
    description: string,
    kind: 'feature' | 'risk' | 'conflict' = 'feature',
    extra: Evidence[] = [],
  ) {
    if (!ref) return;
    output.findings.push({
      key,
      parentKey: null,
      kind,
      title,
      description,
      behavior: ref.excerpt,
      outcome: '验收边界与实施方案需确认',
      basis,
      priority: 'medium',
      phase: 'mvp',
      evidenceIds: [...new Set([ref.evidenceId, ...extra.map((e) => e.evidenceId)])],
      rationale: '依据本次实际保留的演示片段及其适用范围。',
      uncertainty:
        basis === 'inferred'
          ? '技术方案和资源条件未确认，不能当作原始事实。'
          : '参考产品具备某能力，不代表本项目必须实现。',
    });
  }
  const exportRef =
    evidence.find((e) => e.evidenceType === 'user-description' && /导出/.test(e.excerpt)) ??
    by(/导出/);
  feature(
    'export',
    '文件导出',
    exportRef,
    exportRef?.evidenceType === 'user-description' ? 'explicit' : 'observed',
    '交付可导出的设计成果，输出格式和验收要求仍需确认。',
  );
  feature(
    'collaboration',
    '多人协作（参考能力）',
    evidence.find((e) => e.evidenceType === 'web-text' && /多人/.test(e.excerpt)),
    'observed',
    '参考产品介绍了多人协作，是否纳入本项目首版仍待决定。',
  );
  feature(
    'preview',
    '编辑与实时预览',
    by(/实时预览|一起编辑/),
    'inferred',
    '编辑与预览可能构成首版主流程，应先明确使用场景和交互边界。',
  );
  feature(
    'synchronization',
    '并发与同步能力（推断）',
    by(/实时|多人/),
    'inferred',
    '若选择多人实时编辑，需要评估并发更新、同步与故障恢复；当前并未确认采用何种架构。',
    'risk',
  );
  const template = by(/首版必须支持多人/),
    scope = by(/第一阶段先做单人/);
  if (template && scope)
    feature(
      'scope-conflict',
      '首版协作范围冲突待核实',
      template,
      'observed',
      '旧首版模板要求多人协作，补充说明要求先单人；请核对模板是否仍有效、两份说明是否指向同一阶段。',
      'conflict',
      [scope],
    );
  output.questions.push({
    title: '第一阶段是否必须支持多人实时同步？',
    detail: '参考产品展示能力与本项目选择分开确认；请核实旧模板与当前阶段边界。',
    findingKeys: output.findings.filter((f) => /协作|同步/.test(f.title)).map((f) => f.key),
    evidenceIds: [template, scope].flatMap((e) => (e ? [e.evidenceId] : [])),
  });
  output.questions.push({
    title: '现有团队、预算和岗位分工分别是什么？',
    detail: '信息缺失，不据截图推断准确人数或技术栈。',
    findingKeys: [],
    evidenceIds: [],
  });
  return output;
}
export function mockFeatures(input: LabStageRequest): AnalysisOutput {
  if (input.analysis.fixture === 'software-engineer@1') return softwareFeatures(input.analysis);
  if (input.analysis.fixture === 'paperboat@1') return paperboatFeatures(input.analysis);
  if (!input.analysis.fixture && characterDesignContext(input.analysis))
    return characterDesignFeatures(input.analysis);
  const output = featureCandidates(input),
    features = output.findings.filter((f) => f.kind === 'feature');
  if (!output.overview.evidenceIds.length)
    output.overview.inferredFields = (
      ['goal', 'problem', 'users', 'outcome', 'constraints'] as const
    ).filter((field) => !!output.overview[field].trim());
  const constraints = input.analysis.sources
    .find((s) => s.title === '规划约束（用户补充）')
    ?.versions.at(-1)?.text;
  if (constraints) {
    output.overview.constraints = constraints.slice(0, 3000);
    const ids = input.analysis.evidence
      .filter((e) =>
        input.analysis.sources.some(
          (s) => s.id === e.sourceId && s.title === '规划约束（用户补充）',
        ),
      )
      .map((e) => e.evidenceId);
    output.overview.evidenceIds = [...new Set([...output.overview.evidenceIds, ...ids])];
    if (ids.length)
      output.overview.inferredFields = output.overview.inferredFields.filter(
        (f) => f !== 'constraints',
      );
  }
  if (features.length) {
    const choices = features.slice(0, 3).map((f) => ({
      id: stableDecisionId(f.title),
      label: `先验证：${f.title}`,
      impact: `将“${f.title}”作为首版讨论重点，其他功能仍为候选；不确定的技术和岗位条件保持未知。`,
    }));
    output.questions.push({
      title: '首版优先验证哪项能力？',
      detail: '选择会帮助限定当前交付范围；也可以补充自己的方向或保留未知。',
      findingKeys: features.map((f) => f.key),
      evidenceIds: [...new Set(features.flatMap((f) => f.evidenceIds))],
      choices,
      ...(choices.length > 1
        ? {
            recommendation: {
              choiceId: choices[0].id,
              reason: '先验证一个可核对的功能可以减少未决范围；这只是演示建议。',
            },
          }
        : {}),
    });
  }
  return output;
}
export function mockLinks(input: LabStageRequest): LinkOutput {
  if (input.analysis.fixture === 'software-engineer@1') return softwareLinks(input);
  if (input.analysis.fixture === 'paperboat@1') return paperboatLinks(input);
  const out: LinkOutput = {
    relations: [],
    questions: [],
    notice: '演示数据，非真实AI分析。候选关系由真实演示对象连接，仍需核对。',
  };
  const conflict = input.analysis.confirmedFindings.find(
    (f) => f.kind === 'conflict' && f.evidenceIds.length >= 2,
  );
  if (conflict) {
    out.relations.push({
      sourceNodeId: evidenceNodeId(conflict.evidenceIds[0]),
      targetNodeId: evidenceNodeId(conflict.evidenceIds[1]),
      relationType: 'conflicts_with',
      evidenceRefs: conflict.evidenceIds,
      leftEvidenceIds: [conflict.evidenceIds[0]],
      rightEvidenceIds: [conflict.evidenceIds[1]],
      rationale: conflict.description,
      uncertainty: '须确认旧模板是否有效，以及时间和交付范围是否一致。',
    });
  }
  const features = input.analysis.confirmedFindings.filter(
    (f) => f.kind === 'feature' && f.status !== 'excluded',
  );
  if (features.length > 1)
    out.relations.push({
      sourceNodeId: findingNodeId(features[0].id),
      targetNodeId: findingNodeId(features[1].id),
      relationType: 'weakly_related',
      evidenceRefs: [...new Set([...features[0].evidenceIds, ...features[1].evidenceIds])],
      leftEvidenceIds: [],
      rightEvidenceIds: [],
      rationale: '两项功能属于同一产品研究，但不能由此认定实现依赖或必须由同一岗位承担。',
      uncertainty: '工作边界与依赖仍待核实。',
    });
  return out;
}
export function mockRoles(input: LabStageRequest): RoleOutput {
  if (input.analysis.fixture === 'software-engineer@1') return softwareRoles(input);
  if (!input.analysis.fixture && characterDesignContext(input.analysis))
    return characterDesignRoles(input);
  if (input.analysis.fixture === 'paperboat@1') return paperboatRoles(input);
  const features = input.analysis.confirmedFindings.filter(
    (f) => f.kind === 'feature' && f.status !== 'excluded',
  );
  if (!features.length)
    return {
      solutions: [],
      questions: [],
      notice: '演示数据，非真实AI分析。当前没有可追溯功能，先形成需求候选。',
    };
  const ids = features.map((f) => f.id),
    refs = [...new Set(features.flatMap((f) => f.evidenceIds))].slice(0, 60);
  const base = {
    description: '根据当前功能讨论分工，需结合现有团队和预算核实；不据参考截图确定人数。',
    rationale: '候选方案由本次功能与证据链提出，未将其当作已确认招聘需求。',
    assumptions: ['现有团队可承担部分工作尚未确认', '技术栈、人数和验收边界待确认'],
    advantages: ['可对照功能和交付边界逐项核对'],
    disadvantages: ['能力覆盖、协作成本与预算尚未验证'],
    openQuestions: [
      '哪些工作可由现有团队承担？',
      '第一阶段是否需要实时协作？',
      '预算与交付时间是多少？',
    ],
    relatedFeatureIds: ids,
    relatedEvidenceIds: refs,
  };
  function requirements(roleKey: string) {
    return [
      {
        key: 'delivery',
        roleKey,
        title: '围绕选定功能完成界面与导出交付',
        description: '职责候选：实现已选择的产品流程，逐项明确验收；不默认独立承担所有服务端工作。',
        requirementType: 'must' as const,
        relatedFeatureIds: ids,
        evidenceIds: refs,
        inferenceIds: [],
        rationale: '来自产品功能的交付需求，是否属于本岗位仍需人确认。',
        uncertainty: '技术栈、分工和交付范围未知。',
      },
      {
        key: 'collaboration',
        roleKey,
        title: '复杂协作与一致性经验',
        description: '只有纳入多人实时协作时才讨论此能力，不自动作为必备条件。',
        requirementType: 'bonus' as const,
        relatedFeatureIds: ids,
        evidenceIds: refs,
        inferenceIds: [],
        rationale: '功能范围可能涉及协作，属于有条件推断。',
        uncertainty: '首版是否需要实时同步未确认。',
      },
      {
        key: 'learning',
        roleKey,
        title: '学习现有工具链与团队协作方式',
        description: '可在岗位承担范围明确后讨论培养路径，不虚构培训或晋升承诺。',
        requirementType: 'trainable' as const,
        relatedFeatureIds: ids,
        evidenceIds: refs,
        inferenceIds: [],
        rationale: '交付需要适应实际团队流程，具体工具未知。',
        uncertainty: '培养条件与支持方式待确认。',
      },
    ];
  }
  return {
    solutions: [
      {
        ...base,
        key: 'focused',
        title: '职责聚焦方案（候选）',
        productPlan: {
          goal: '先验证一个可交付的最小范围',
          priorityFeatureIds: ids.slice(0, 1),
          deferredFeatureIds: ids.slice(1),
          difference: '先收敛到一项核心能力，其他功能暂缓，优先核实交付边界。',
          complexity: '相对较低：范围较小；具体成本与工期仍未知。',
          capabilityNotes: ['围绕已选流程完成界面与交付，技术栈按实际团队核实'],
        },
        roles: [
          {
            key: 'delivery',
            title: '产品实现与交付（候选）',
            headcount: null,
            rationale: '先明确可由现有团队承担的工作，再讨论该角色边界。',
          },
        ],
        requirements: requirements('delivery'),
      },
      {
        ...base,
        key: 'collaborative',
        title: '按交付职责协作方案（候选）',
        productPlan: {
          goal: '覆盖更多已提出的功能，并明确跨职责协作',
          priorityFeatureIds: ids,
          deferredFeatureIds: [],
          difference: '扩大首版候选范围，同时承担跨角色联调与协作成本。',
          complexity: '相对较高：功能与协作边界更多；不能据此确定人数。',
          capabilityNotes: [
            '复杂流程和数据一致性仅在相应功能纳入时讨论',
            '服务联调与质量验收需先核对现有团队职责',
          ],
        },
        roles: [
          {
            key: 'interface',
            title: '界面与交互实现（候选）',
            headcount: null,
            rationale: '面向已选择的产品流程。',
          },
          {
            key: 'integration',
            title: '服务与集成协作（候选）',
            headcount: null,
            rationale: '仅在现有团队无法承担且范围确有需要时讨论。',
          },
        ],
        requirements: requirements('interface').concat([
          {
            ...requirements('interface')[0],
            key: 'integration',
            roleKey: 'integration',
            title: '与现有服务进行接口联调',
            requirementType: 'must',
            description: '有条件的职责候选：核实实际服务边界与现有团队分工后再决定。',
          },
        ]),
      },
    ],
    questions: [],
    notice: '演示数据，非真实AI分析。方案、人数与岗位要求均待人工确认。',
  };
}
