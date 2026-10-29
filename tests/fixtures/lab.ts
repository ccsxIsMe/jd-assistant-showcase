import {
  newExploration,
  makeId,
  timestamp,
  type Exploration,
  type Finding,
} from '../../src/lib/exploration/model';
import { createSource, paragraphs, textEvidence } from '../../src/lib/exploration/domain';
import { synchronizeLab } from '../../src/lib/lab/graph';
export function syntheticLab(size: 20 | 100 | 300): Exploration {
  let p = newExploration(`合成性能资料 · ${size}节点 · 非真实研究`);
  const [sourceCount, featureCount, questionCount, roleCount, requirementCount] =
    size === 20 ? [5, 6, 1, 1, 2] : size === 100 ? [15, 55, 5, 2, 8] : [30, 150, 20, 10, 60];
  for (let i = 0; i < sourceCount; i++) {
    const s = createSource('text', `合成资料 ${i + 1}`);
    s.status = 'ready';
    s.versions[0].text = `合成测试说明 ${i + 1}：需要交付文件导出或编辑功能，具体边界待讨论。`;
    s.versions[0].paragraphs = paragraphs(s.versions[0].text);
    p.sources.push(s);
    p.evidence.push(...textEvidence(s, s.versions[0]));
  }
  for (let i = 0; i < featureCount; i++) {
    const f: Finding = {
      id: makeId(),
      revision: 1,
      kind: 'feature',
      title: `合成功能 ${i + 1}`,
      description: `工程性能测试 ${i + 1}，不代表真实用户需求。`,
      behavior: '按明确的范围执行操作',
      outcome: '可验收的输出',
      basis: i % 4 === 0 ? 'inferred' : 'explicit',
      priority: 'medium',
      phase: 'mvp',
      status: 'pending',
      locked: false,
      evidenceIds: [p.evidence[i % sourceCount].evidenceId],
      parentId: null,
      origin: 'ai',
      analysisMode: 'example',
      rationale: '合成数据，仅用于测试布局',
      uncertainty: '不用于实际招聘',
    };
    p.findings.push(f);
  }
  for (let i = 0; i < questionCount; i++)
    p.questions.push({
      id: makeId(),
      title: `合成待确认问题 ${i + 1}`,
      detail: '待讨论的边界',
      findingIds: [p.findings[i % featureCount].id],
      evidenceIds: [p.evidence[i % sourceCount].evidenceId],
      status: 'open',
      answer: '',
    });
  p = synchronizeLab(p);
  const solutionId = makeId(),
    at = timestamp();
  p.lab!.solutions.push({
    id: solutionId,
    projectId: p.id,
    title: '合成条件方案',
    description: '测试角色与证据链',
    rationale: '合成测试专用',
    assumptions: ['真实人员配置未知'],
    advantages: ['仅验证交互'],
    disadvantages: ['非业务数据'],
    openQuestions: ['不用于招聘判断'],
    relatedFeatureIds: p.findings.map((f) => f.id),
    relatedEvidenceIds: p.evidence.map((e) => e.evidenceId),
    roles: Array.from({ length: roleCount }, (_, i) => ({
      key: `role-${i}`,
      title: `候选角色 ${i + 1}`,
      headcount: null,
      rationale: '未确定人数',
    })),
    status: 'pending',
    revision: 1,
    generatedBy: 'example',
    createdAt: at,
    updatedAt: at,
    inputVersions: {},
  });
  for (let i = 0; i < requirementCount; i++)
    p.lab!.requirements.push({
      id: makeId(),
      projectId: p.id,
      solutionId,
      roleKey: `role-${i % roleCount}`,
      title: `合成岗位要求 ${i + 1}`,
      description: '合成测试的可追溯要求',
      requirementType: 'must',
      relatedTaskIds: [],
      relatedFeatureIds: [p.findings[i % featureCount].id],
      evidenceIds: [p.evidence[i % sourceCount].evidenceId],
      inferenceIds: [],
      status: 'pending',
      locked: false,
      revision: 1,
      originType: 'ai_inference',
      rationale: '对应合成功能',
      uncertainty: '非实际人员配置',
      createdAt: at,
      updatedAt: at,
      inputVersions: {},
    });
  p.lab!.activeSolutionIds = [solutionId];
  p.lab!.ui.guided = true;
  p.lab!.ui.rightOpen = false;
  return synchronizeLab(p);
}
