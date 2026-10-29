import type { AnalysisRequest } from '../exploration/analysis';
import type { AnalysisOutput } from '../exploration/model';
import type { LabStageRequest, RoleOutput } from './ai-contract';
export function characterDesignContext(data: AnalysisRequest) {
  const evidence = data.evidence.find(
    (e) =>
      e.evidenceType === 'user-description' &&
      /游戏.{0,8}角色|角色.{0,8}(设计|原画|建模)/i.test(e.excerpt),
  );
  return evidence;
}
// An explicitly labelled, bounded domain demo. These are candidate professional suggestions,
// never fabricated source facts and never a fallback after a real-model error.
export function characterDesignFeatures(data: AnalysisRequest): AnalysisOutput {
  const e = characterDesignContext(data);
  if (!e) throw new Error('当前文字不属于角色设计演示范围。');
  return {
    overview: {
      goal: e.excerpt.slice(0, 2500),
      problem: '需要先明确角色设计的交付形态与验收，而非泛泛讨论软件开发分工。',
      users: '角色的使用方与目标玩家待确认',
      outcome: '明确2D或3D角色作品及所需能力',
      constraints: '画风、角色数量、预算、工期与工具偏好未知',
      evidenceIds: [e.evidenceId],
      inferredFields: ['problem', 'users', 'outcome', 'constraints'],
    },
    findings: [
      {
        key: 'character',
        parentKey: null,
        kind: 'feature',
        title: '游戏角色视觉设计与交付',
        description:
          '根据用户提出的角色设计目标，讨论角色形象、设计表达和可交付作品；2D与3D边界尚未确认。',
        behavior: e.excerpt,
        outcome: '交付可审阅的角色设计作品，具体格式待定',
        basis: 'explicit',
        priority: 'high',
        phase: 'mvp',
        evidenceIds: [e.evidenceId],
        rationale: '用户原文确实提出角色设计；没有据此确认美术风格或软件品牌。',
        uncertainty: '2D/3D、风格、角色数量与引擎接入范围待确认。',
      },
    ],
    questions: [
      {
        title: '这次希望交付2D原画，还是3D角色？',
        detail:
          '2D主要评估绘画与造型表达；3D还涉及建模、材质及可能的引擎交付。可以保留未知，不替你决定。',
        findingKeys: ['character'],
        evidenceIds: [e.evidenceId],
        choices: [
          {
            id: 'art-2d',
            label: '2D角色原画与设定',
            impact: '侧重审美、绘画基本功、造型、配色和数字绘画工具。',
          },
          { id: 'art-3d', label: '3D角色资产', impact: '侧重三维造型、拓扑、UV、材质和交付规范。' },
        ],
      },
    ],
    notice: '演示规则候选，非真实AI分析。下列专业能力为建议，不是用户资料已确认的事实。',
  };
}
export function characterDesignRoles(input: LabStageRequest): RoleOutput {
  const e = characterDesignContext(input.analysis),
    feature = input.analysis.confirmedFindings.find(
      (f) => f.kind === 'feature' && /角色/.test(f.title) && f.status !== 'excluded',
    );
  if (!e || !feature)
    return {
      solutions: [],
      questions: [],
      notice: '角色设计资料或功能已改变，保留人工内容，不套用旧候选。',
    };
  const common = {
    rationale: '用户明确提出游戏角色设计；具体能力由交付形态作专业推断，均待确认。',
    assumptions: ['角色数量、画风和预算尚未确定', '工具品牌只是候选，不是既定技术要求'],
    advantages: ['可用相近风格作品和过程稿核对实际能力'],
    disadvantages: ['未明确交付形态前无法确定完整工作量与协作边界'],
    openQuestions: ['希望交付2D还是3D？', '是否还包括绑定、动画或引擎接入？'],
    relatedFeatureIds: [feature.id],
    relatedEvidenceIds: [e.evidenceId],
    hiringNeed: 'candidate' as const,
  };
  function plan(
    key: string,
    title: string,
    description: string,
    items: { title: string; description: string; kind: 'must' | 'bonus' | 'trainable' }[],
  ) {
    return {
      ...common,
      key,
      title,
      description,
      roles: [
        {
          key: 'artist',
          title,
          headcount: null,
          rationale: '岗位方向是候选，准确人数需结合角色数量和工作量确认。',
        },
      ],
      requirements: items.map((r, i) => ({
        key: `${key}-${i}`,
        roleKey: 'artist',
        title: r.title,
        description: r.description,
        requirementType: r.kind,
        relatedFeatureIds: [feature!.id],
        evidenceIds: [e!.evidenceId],
        inferenceIds: [],
        rationale: '专业能力建议：由角色设计工作所需交付推导，不是来源原话。',
        uncertainty: '必要性和工具选择等待用户确认；不推断薪资、学历或工作年限。',
      })),
      productPlan: {
        goal: description,
        priorityFeatureIds: [feature!.id],
        deferredFeatureIds: [],
        difference:
          key === '2d'
            ? '交付角色设定和2D表达，不默认包含完整3D资产。'
            : '交付可使用的3D角色资产，需另行核对绑定动画范围。',
        complexity: '取决于风格、数量与交付标准，不编造工期或费用。',
        capabilityNotes: items.map((r) => r.title),
      },
    };
  }
  return {
    solutions: [
      plan('2d', '2D角色原画设计（候选）', '先完成角色设定、轮廓探索、配色与三视图候选。', [
        {
          title: '审美与角色设计表达',
          description:
            '通过同类画风作品说明轮廓、比例、配色和角色辨识度；“审美在线”应落实到可审阅作品。',
          kind: 'must',
        },
        {
          title: '绘画与造型基本功',
          description: '用过程稿验证人体结构、透视、明暗与材质表达，围绕目标角色风格判断。',
          kind: 'must',
        },
        {
          title: '2D数字绘画软件实践',
          description:
            '能使用Photoshop（PS）、Krita等同类工具完成分层绘画与交付；品牌仅作候选，不强制指定PS。',
          kind: 'must',
        },
        {
          title: '角色设定与规范交付',
          description: '根据确认的需求提交迭代稿、三视图和必要的服饰道具细节；具体清单待确认。',
          kind: 'must',
        },
        {
          title: '3D辅助构图与造型',
          description:
            '会用Blender或同类3D辅助工具做姿态、透视参考可作为加分项；不默认要求完整3D角色制作。',
          kind: 'bonus',
        },
      ]),
      plan(
        '3d',
        '3D角色制作（候选）',
        '先明确高低模、材质和目标运行环境，避免把建模等同于完整动画制作。',
        [
          {
            title: '角色三维造型与审美',
            description: '以同类角色作品验证体块、比例、解剖结构与造型表达。',
            kind: 'must',
          },
          {
            title: '建模与雕刻工具实践',
            description:
              'Blender、Maya、ZBrush等为工具候选，按团队约束确认，不要求同时精通全部品牌。',
            kind: 'must',
          },
          {
            title: '拓扑、UV与材质',
            description: '能说明拓扑、UV、贴图与材质的制作过程，并按确认的资产规范交付。',
            kind: 'must',
          },
          {
            title: '引擎导出与资产检查',
            description: '目标引擎未知，先保留具体导出格式、面数与贴图规格待确认。',
            kind: 'trainable',
          },
          {
            title: '2D设定理解与协作',
            description: '可通过设定图说明如何还原设计；绑定和动画只有纳入范围时再要求。',
            kind: 'bonus',
          },
        ],
      ),
    ],
    questions: [],
    notice: '演示规则候选，非真实AI分析。能力建议具体展示，必要性、来源属性和确认状态分开管理。',
  };
}
