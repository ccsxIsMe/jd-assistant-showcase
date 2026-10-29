'use client';
import {
  InteractiveGuide,
  type TutorialLaunch,
  type TutorialStep,
} from '../guidance/interactive-guide';
import type { Exploration } from '@/lib/exploration/model';
export function ResearchGuide({
  project: p,
  launch,
  ui,
  enabled,
}: {
  project: Exploration;
  launch: TutorialLaunch;
  ui: (patch: Partial<NonNullable<Exploration['lab']>['ui']>) => void;
  enabled: boolean;
}) {
  const lab = p.lab!,
    plan = lab.ui.researchMode === 'plan',
    chosen = lab.activeSolutionIds.length > 0;
  const generated = lab.runs.some(
    (r) => r.stage === (plan ? 'propose_roles' : 'link_evidence') && r.status === 'succeeded',
  );
  const steps: TutorialStep[] = [
    {
      id: 'sources',
      title: '先说想法，资料可以稍后补齐',
      description:
        '不需要技术栈或岗位名称。写一句目标，或添加公开链接、图片和文档，先看真实解析状态。',
      target: plan ? '[data-tour="lab-goal"]' : '[data-tour="lab-add-source"]',
      complete: p.sources.some((s) => !s.removed && ['ready', 'partial'].includes(s.status)),
    },
    {
      id: 'analysis',
      title: plan ? '让AI先整理候选方向' : '按需要启动关联分析',
      description: '按钮才会请求分析；真实模式会先确认发送范围。失败保留成功阶段，可以取消和重试。',
      target: plan ? '[data-tour="lab-plan-start"]' : '[data-tour="lab-analysis"]',
      complete: generated,
    },
    {
      id: 'evidence',
      title: '看看结论来自哪里',
      description: '打开一条核心证据，检查原文与位置。次要资料可以展开，重要冲突必须保留。',
      target: '[data-tour="lab-evidence"]',
      complete: !!lab.ui.evidenceViewed,
      unavailable: '暂无可核对证据；请先完成解析或补充已核对文字。',
    },
    {
      id: 'solution',
      title: '比较方案与成立条件',
      description: '根据目标比较功能范围与岗位分工，选择或组合；不确定时可以明确保留未知。',
      target: lab.solutions.length
        ? '[data-tour="lab-select-plan"]'
        : '[data-tour="lab-generate-roles"]',
      complete: chosen,
    },
    {
      id: 'handoff',
      title: '保存研究，再进入岗位共创',
      description:
        '核对选定范围并保存快照。导入工作台后的任务和要求仍待确认，原始证据和快照可追溯。',
      target: plan
        ? '[data-tour="lab-package"], [data-tour="lab-import"]'
        : '[data-tour="lab-confirm-solution"], [data-tour="lab-confirm-requirement"], [data-tour="lab-import-selection"], [data-tour="lab-import"]',
      complete: !!p.snapshots.length,
    },
  ];
  function prepare(id: string) {
    if (plan)
      ui({
        researchView: 'guided',
        planningScreen:
          id === 'sources' || id === 'analysis'
            ? 'input'
            : id === 'handoff' && lab.researchGuide.packageSignature
              ? 'handoff'
              : 'results',
      });
    else
      ui({
        researchView: 'guided',
        researchStep:
          id === 'sources'
            ? 'materials'
            : id === 'analysis' || id === 'evidence'
              ? 'evidence'
              : id === 'solution'
                ? 'roles'
                : lab.researchGuide.importRequirementIds.length
                  ? 'handoff'
                  : 'roles',
      });
  }
  return (
    <InteractiveGuide
      scope="lab"
      steps={steps}
      prepare={prepare}
      launch={launch}
      enabled={enabled}
      auto={!lab.ui.guided}
    />
  );
}
