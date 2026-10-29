import { describe, it, expect } from 'vitest';
import { syntheticLab } from '../fixtures/lab';
import { newExploration, explorationSchema } from '../../src/lib/exploration/model';
import {
  saveProductIdea,
  savePlanningConstraints,
  choosePlanningSolution,
  respondToResearchQuestion,
  confirmPlanningPackage,
  editFindingNode,
  editRequirement,
} from '../../src/lib/lab/operations';
import { synchronizeLab, assertLab, visibleGraph } from '../../src/lib/lab/graph';
import {
  planningSignature,
  planningTasks,
  conflictSignature,
  packageSignature,
  readPlanningConstraints,
} from '../../src/lib/lab/planning';
import { buildLabRequest, beginStage, mergeStageResult } from '../../src/lib/lab/workflow';
import { mockFeatures, mockLinks, mockRoles } from '../../src/lib/lab/mock';
import { labPromptVersions, validateRoleResult } from '../../src/lib/lab/ai-contract';
import { undoResearch } from '../../src/lib/exploration/journal';
import {
  createSource,
  paragraphs,
  textEvidence,
  evidenceValid,
  createSnapshot,
} from '../../src/lib/exploration/domain';
import { researchSignature, forkResearch } from '../../src/lib/exploration/research';
import { materialFromSnapshot, validateMaterial } from '../../src/lib/exploration/material';
import { selectAnalysisEvidence, goalRelevance } from '../../src/lib/lab/evidence-selection';
import { newWorkspace, newItem } from '../../src/lib/workbench/model';
import { respondToWorkbenchQuestion, undoOperation } from '../../src/lib/workbench/domain';
import { workbenchNextAction } from '../../src/lib/workbench/next-action';
function seed() {
  const p = saveProductIdea(
    synchronizeLab(newExploration('规划案例')),
    '我想制作在线协作设计工具，先验证编辑和文件导出，技术栈和岗位名称未知。',
  );
  p.lab!.ui.researchMode = 'plan';
  return p;
}
function analyze(p: ReturnType<typeof seed>) {
  for (const stage of planningTasks(p)) {
    const input = buildLabRequest(p, stage),
      start = beginStage(p, stage, input.inputVersions, [], labPromptVersions[stage]);
    start.project.lab!.runs.at(-1)!.planningSignature = planningSignature(p, stage);
    const output =
      stage === 'derive_features'
        ? mockFeatures(input)
        : stage === 'link_evidence'
          ? mockLinks(input)
          : mockRoles(input);
    p = mergeStageResult(
      start.project,
      start.run.id,
      input,
      { stage, output } as Parameters<typeof mergeStageResult>[3],
      {
        requestId: crypto.randomUUID(),
        promptVersion: labPromptVersions[stage],
        mode: 'example',
        modelConfigId: 'fixed-test',
      },
    );
  }
  return p;
}
describe('双模式共享研究与自动规划', () => {
  it('旧记录缺少模式与新字段时兼容读取，不改原节点或快照', () => {
    const p = syntheticLab(20),
      raw = JSON.parse(JSON.stringify(p));
    delete raw.lab.ui.researchMode;
    delete raw.lab.ui.planningScreen;
    const next = explorationSchema.parse(raw);
    expect(next.lab!.ui.researchMode).toBe('collaborate');
    expect(next.lab!.nodes).toEqual(p.lab!.nodes);
  });
  it('一次规划完成既有三任务，不要求中间确认，不授予已确认状态', () => {
    const p = analyze(seed());
    expect(p.lab!.runs.filter((r) => r.status === 'succeeded')).toHaveLength(3);
    expect(p.lab!.solutions.length).toBeGreaterThan(0);
    expect(p.lab!.solutions.every((s) => s.status === 'pending' && s.productPlan)).toBe(true);
    expect(p.lab!.requirements.every((r) => r.status === 'pending')).toBe(true);
    expect(planningTasks(p)).toEqual([]);
    expect(p.lab!.researchGuide.sourceSignature).toBeNull();
  });
  it('切换模式与视图不改业务签名、确认、坐标和分析结果', () => {
    const p = analyze(seed());
    const signature = researchSignature(p),
      data = JSON.stringify([p.sources, p.evidence, p.findings, p.lab!.solutions, p.lab!.nodes]);
    p.lab!.ui.researchMode = 'collaborate';
    p.lab!.ui.researchView = 'board';
    p.lab!.ui.researchMode = 'plan';
    expect(researchSignature(p)).toBe(signature);
    expect(
      JSON.stringify([p.sources, p.evidence, p.findings, p.lab!.solutions, p.lab!.nodes]),
    ).toBe(data);
    expect(planningTasks(p)).toEqual([]);
  });
  it('新增资料只使必要依赖待重新分析，已有成功记录与编辑保留', () => {
    let p = analyze(seed());
    const before = structuredClone(p.lab!.runs);
    p = saveProductIdea(p, '新的目标：导出成果之前增加本地编辑验收。', 1);
    expect(planningTasks(p)).toContain('derive_features');
    expect(p.lab!.runs).toEqual(before);
    expect(p.sources[0].versions).toHaveLength(2);
  });
  it('预算与交付约束成为有来源的用户资料，重复保存不创建新版本', () => {
    let p = seed();
    p = savePlanningConstraints(p, '不超过8万元', '先在六周内验证', '暂不做支付');
    expect(readPlanningConstraints(p)).toEqual({
      budget: '不超过8万元',
      deadline: '先在六周内验证',
      constraints: '暂不做支付',
    });
    const source = p.sources.find((s) => s.title === '规划约束（用户补充）')!;
    expect(
      p.evidence.filter((e) => e.sourceId === source.id).every((e) => evidenceValid(p, e)),
    ).toBe(true);
    p = savePlanningConstraints(p, '不超过8万元', '先在六周内验证', '暂不做支付');
    expect(p.sources.find((s) => s.id === source.id)!.versions).toHaveLength(1);
    p = savePlanningConstraints(p, '', '', '');
    expect(readPlanningConstraints(p)).toEqual({ budget: '', deadline: '', constraints: '' });
    expect(p.sources.find((s) => s.id === source.id)!.versions).toHaveLength(2);
    expect(p.sources.find((s) => s.id === source.id)!.versions[0].text).toContain('8万元');
    expect(
      p.evidence
        .filter((e) => e.sourceId === source.id && e.sourceRevision === 1)
        .every((e) => e.verificationStatus === 'needs-review'),
    ).toBe(true);
  });
  it('选择、组合、不确定和均不适用都写入同一业务层，不自动选AI方案', () => {
    let p = analyze(seed());
    const ids = p.lab!.solutions.map((s) => s.id);
    p = choosePlanningSolution(p, ids, 'selected');
    expect(p.lab!.activeSolutionIds).toEqual(ids);
    expect(p.lab!.solutions.every((s) => s.status === 'pending')).toBe(true);
    p = choosePlanningSolution(p, [], 'uncertain');
    expect(p.lab!.activeSolutionIds).toEqual([]);
    expect(p.lab!.researchGuide.planChoice!.kind).toBe('uncertain');
    p = choosePlanningSolution(p, [], 'none');
    expect(p.lab!.researchGuide.planChoice!.kind).toBe('none');
  });
  it('自定义偏好不能为空；真实补充保留、可撤销', () => {
    let p = analyze(seed());
    expect(() => choosePlanningSolution(p, [], 'custom', '')).toThrow();
    p = choosePlanningSolution(p, [], 'custom', '我只希望先做离线编辑和导出');
    expect(p.lab!.researchGuide.planChoice!.text).toContain('离线编辑');
    p = undoResearch(p, p.operations!.at(-1)!.id);
    expect(p.lab!.researchGuide.planChoice).toBeUndefined();
  });
  it('问题未知与跳过持久化为不同状态，不采纳推荐；无效选项拒绝', () => {
    let p = analyze(seed());
    const q = p.questions.find((q) => q.choices?.length)!;
    expect(q).toBeTruthy();
    expect(() =>
      respondToResearchQuestion(p, q.id, { kind: 'choice', choiceIds: ['invalid'], text: '' }),
    ).toThrow();
    p = respondToResearchQuestion(p, q.id, { kind: 'uncertain', choiceIds: [], text: '' });
    expect(p.questions.find((v) => v.id === q.id)).toMatchObject({
      status: 'open',
      response: { kind: 'uncertain', choiceIds: [] },
    });
    p = respondToResearchQuestion(p, q.id, { kind: 'skipped', choiceIds: [], text: '' });
    expect(p.questions.find((v) => v.id === q.id)!.status).toBe('deferred');
    expect(() =>
      respondToResearchQuestion(p, q.id, { kind: 'none', choiceIds: [], text: '' }),
    ).toThrow('尚无可比较');
    p.questions.find((v) => v.id === q.id)!.choices = [
      { id: 'edit-first', label: '先验证编辑过程', impact: '优先验证创建与修改内容' },
      { id: 'export-first', label: '先验证导出质量', impact: '优先验证成果文件' },
    ];
    p = respondToResearchQuestion(p, q.id, { kind: 'none', choiceIds: [], text: '' });
    expect(p.questions.find((v) => v.id === q.id)!.status).toBe('open');
  });
  it('用户自己的回答被保存，问题选择仍可以按对象撤销', () => {
    let p = analyze(seed());
    const q = p.questions[0];
    p = respondToResearchQuestion(p, q.id, {
      kind: 'custom',
      choiceIds: [],
      text: '先验证移动端单人编辑，不做实时同步',
    });
    expect(p.questions.find((v) => v.id === q.id)!.answer).toContain('移动端');
    p = undoResearch(p, p.operations!.at(-1)!.id);
    expect(p.questions.find((v) => v.id === q.id)!.status).toBe('open');
  });
  it('修改功能后，模式切换不丢内容，重新规划不重复已有同名功能', () => {
    let p = analyze(seed());
    const f = p.findings.find((f) => f.kind === 'feature')!;
    p = editFindingNode(p, f.id, { description: '人工保留的交付边界' });
    p.lab!.ui.researchMode = 'collaborate';
    p.lab!.ui.researchMode = 'plan';
    p = analyze(p);
    expect(p.findings.find((v) => v.id === f.id)!.description).toBe('人工保留的交付边界');
    expect(new Set(p.findings.map((f) => f.title)).size).toBe(p.findings.length);
  });
  it('一键资料包是显式人工确认，绑定版本有效，导出含岗位方案及逐条要求', () => {
    let p = analyze(seed());
    p = choosePlanningSolution(p, [p.lab!.solutions[0].id], 'selected');
    const ids = p
      .lab!.requirements.filter((r) => r.solutionId === p.lab!.activeSolutionIds[0])
      .slice(0, 1)
      .map((r) => r.id);
    p = confirmPlanningPackage(p, ids, conflictSignature(p));
    expect(p.lab!.requirements.find((r) => r.id === ids[0])!.status).toBe('confirmed');
    expect(p.lab!.solutions[0].status).toBe('confirmed');
    expect(p.lab!.researchGuide.packageSignature).toBe(packageSignature(p));
    expect(() => assertLab(p)).not.toThrow();
    const snap = createSnapshot(p, 'draft'),
      material = validateMaterial(materialFromSnapshot(snap));
    expect(material.roleData!.solutions[0].productPlan).toBeTruthy();
    expect(material.roleData!.requirements).toHaveLength(p.lab!.requirements.length);
    const fork = forkResearch(snap, '继续');
    expect(fork.lab!.ui.researchMode).toBe('plan');
  });
  it('锁定且未确认的要求不可批量确认', () => {
    let p = syntheticLab(20);
    p.lab!.ui.researchMode = 'plan';
    p = choosePlanningSolution(p, [p.lab!.solutions[0].id], 'selected');
    const r = p.lab!.requirements[0];
    p = editRequirement(p, r.id, { locked: true });
    expect(() => confirmPlanningPackage(p, [r.id], conflictSignature(p))).toThrow();
  });
  it('重要冲突变化使先前接受假设的授权失效，明确再次确认后仍保留未决问题', () => {
    let p = syntheticLab(20);
    p.findings[0].kind = 'conflict';
    p.findings[0].priority = 'high';
    p.questions[0].findingIds = [p.findings[0].id];
    p = choosePlanningSolution(p, [p.lab!.solutions[0].id], 'selected');
    const ids = [p.lab!.requirements[0].id],
      ack = conflictSignature(p);
    expect(() => confirmPlanningPackage(p, ids, null)).toThrow('重要冲突');
    p.questions[0].title = '新增了会改变首版范围的冲突';
    expect(() => confirmPlanningPackage(p, ids, ack)).toThrow('重要冲突');
    p = confirmPlanningPackage(p, ids, conflictSignature(p));
    expect(p.questions[0].status).toBe('open');
    expect(p.lab!.researchGuide.packageSignature).toBe(packageSignature(p));
  });
  it('规划模式不能接受缺少产品范围或伪造功能引用的模型方案', () => {
    const p = analyze(seed()),
      input = buildLabRequest(p, 'propose_roles'),
      out = mockRoles(input);
    delete out.solutions[0].productPlan;
    expect(() => validateRoleResult(input, out)).toThrow('产品范围');
    const invalid = mockRoles(input);
    invalid.solutions[0].productPlan!.priorityFeatureIds = ['nonexistent'];
    expect(() => validateRoleResult(input, invalid)).toThrow();
  });
});
describe('证据收敛和工作台决策', () => {
  it('大量网页候选不全变独立节点，选择保留反例、来源与完整底层资料', () => {
    const p = newExploration('噪声网页'),
      s = createSource('url', '测试静态网页');
    s.status = 'ready';
    s.versions[0].text = [
      ...Array.from({ length: 160 }, (_, i) => `导航推荐条目${i}`),
      '第一阶段暂不支持多人协作。',
      '导出文件是核心目标。',
    ].join('\n');
    s.versions[0].paragraphs = paragraphs(s.versions[0].text, 'extracted');
    p.sources.push(s);
    p.evidence.push(...textEvidence(s, s.versions[0]));
    p.overview.goal = '导出文件';
    const before = JSON.stringify(p),
      selected = selectAnalysisEvidence(p, p.evidence, 20);
    expect(selected.length).toBeLessThanOrEqual(20);
    expect(selected.some((e) => e.excerpt.includes('暂不支持'))).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
    expect(visibleGraph(synchronizeLab(p).lab!).nodes).toHaveLength(1);
  });
  it('改变目标会更新证据优先级，没有删除任何原文', () => {
    const p = seed(),
      a = { ...p.evidence[0], excerpt: 'export files' },
      b = { ...p.evidence[0], excerpt: 'realtime collaboration' };
    p.overviewMode = 'manual';
    p.overview.goal = 'export files';
    expect(goalRelevance(p, a)).toBeGreaterThan(goalRelevance(p, b));
    p.overview.goal = 'realtime collaboration';
    expect(goalRelevance(p, b)).toBeGreaterThan(goalRelevance(p, a));
  });
  it('工作台下一步来自实际条目，不由已访问页面或教程索引决定', () => {
    const w = newWorkspace('待明确岗位');
    expect(workbenchNextAction(w).id).toBe('sources');
    const task = newItem('task', '实际交付');
    w.items.push(task);
    expect(workbenchNextAction(w).id).toBe('tasks');
    task.status = 'confirmed';
    const r = newItem('requirement', '岗位必要能力');
    w.items.push(r);
    expect(workbenchNextAction(w).label).toBe('检查必要技能');
    r.status = 'confirmed';
    expect(workbenchNextAction(w).id).toBe('jd');
    w.items.push({ ...newItem('block', '岗位概述'), status: 'confirmed' });
    expect(workbenchNextAction(w).id).toBe('save');
  });
  it('工作台自定义/未知回答保留状态且可撤销，不覆盖后来无关编辑', () => {
    let w = newWorkspace('讨论');
    const task = newItem('task', '核心工作');
    w.items.push(task);
    const other = newItem('task', '另一个工作');
    w.items.push(other);
    w.questions.push({
      id: 'q',
      title: '范围如何选择',
      choices: [
        { id: 'core', label: '先聚焦核心工作', impact: '控制本岗位的首版范围' },
        { id: 'broader', label: '同时承担相邻协作工作', impact: '需要明确协作与验收边界' },
      ],
      detail: '',
      kind: 'human',
      important: false,
      targetIds: [task.id],
      refs: [],
      status: 'open',
      answer: '',
      reason: '',
      createdAt: new Date().toISOString(),
    });
    w = respondToWorkbenchQuestion(w, 'q', { kind: 'uncertain', choiceIds: [], text: '' });
    expect(w.questions[0].status).toBe('open');
    expect(w.questions[0].response!.kind).toBe('uncertain');
    w.items.find((i) => i.id === other.id)!.text = '随后无关编辑';
    w = undoOperation(w, w.operations[0].id);
    expect(w.questions[0].response).toBeUndefined();
    expect(w.items.find((i) => i.id === other.id)!.text).toBe('随后无关编辑');
    w = respondToWorkbenchQuestion(w, 'q', { kind: 'none', choiceIds: [], text: '' });
    expect(w.questions[0].status).toBe('open');
  });
  it('岗位条件允许未知分类，但未知不得作为可保存的正式事实', () => {
    const w = newWorkspace('未知条件'),
      r = newItem('requirement', '经验要求');
    r.category = 'unknown';
    r.status = 'confirmed';
    w.items.push(
      r,
      { ...newItem('task', '实际任务'), status: 'confirmed' },
      { ...newItem('block', 'JD'), status: 'confirmed' },
    );
    expect(workbenchNextAction(w).id).toBe('review-jd');
  });
});
