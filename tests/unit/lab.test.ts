import { describe, it, expect } from 'vitest';
import { newExploration, makeId, explorationSchema } from '../../src/lib/exploration/model';
import {
  createSource,
  paragraphs,
  textEvidence,
  createSnapshot,
  sourceChanged,
} from '../../src/lib/exploration/domain';
import {
  synchronizeLab,
  assertLab,
  visibleGraph,
  validateEdge,
  evidenceChain,
  findingNodeId,
  digest,
} from '../../src/lib/lab/graph';
import { graphNodeSchema, annotationSchema, roleRequirementSchema } from '../../src/lib/lab/model';
import {
  moveNode,
  collapseNode,
  deleteRelation,
  restoreRelation,
  editFindingNode,
  chooseSolutions,
  editSolution,
  editRequirement,
  addAnnotation,
  updateAnnotation,
  editRelationType,
  pinEvidence,
} from '../../src/lib/lab/operations';
import {
  buildLabRequest,
  beginStage,
  mergeStageResult,
  objectVersions,
} from '../../src/lib/lab/workflow';
import { mockFeatures, mockLinks, mockRoles } from '../../src/lib/lab/mock';
import {
  validateRoleResult,
  validateLinkResult,
  labResultSchema,
} from '../../src/lib/lab/ai-contract';
import { undoResearch, redoResearch } from '../../src/lib/exploration/journal';
import { forkResearch } from '../../src/lib/exploration/research';
import { materialFromSnapshot, validateMaterial } from '../../src/lib/exploration/material';
import {
  importRequirementMaterial,
  upstreamPlan,
  applyUpstreamPlan,
} from '../../src/lib/exploration/workbench-import';
import { newWorkspace, workspaceSchema } from '../../src/lib/workbench/model';
import { syntheticLab } from '../fixtures/lab';
function seed() {
  const p = newExploration('演示研究');
  for (const [kind, title, text] of [
    ['url', '演示产品页面', '多人协作：支持一起编辑设计。\n文件导出：支持文件导出。'],
    ['text', '模糊需求', '希望一起编辑并导出成果，技术栈未知。'],
    ['text', '当前补充', '第一阶段先做单人编辑和文件导出，实时同步未决定。'],
    ['text', '旧模板', '首版必须支持多人协作，旧模板有效性待核实。'],
  ] as const) {
    const s = createSource(kind, title);
    s.status = 'ready';
    s.versions[0].text = text;
    s.versions[0].paragraphs = paragraphs(text, kind === 'url' ? 'extracted' : 'user');
    p.sources.push(s);
    p.evidence.push(...textEvidence(s, s.versions[0]));
  }
  return synchronizeLab(p);
}
function stage(
  p: ReturnType<typeof seed>,
  task: 'derive_features' | 'link_evidence' | 'propose_roles',
) {
  const input = buildLabRequest(p, task);
  const start = beginStage(p, task, input.inputVersions, [], 'test@1');
  const result =
    task === 'derive_features'
      ? { stage: task, output: mockFeatures(input) }
      : task === 'link_evidence'
        ? { stage: task, output: mockLinks(input) }
        : { stage: task, output: mockRoles(input) };
  return mergeStageResult(start.project, start.run.id, input, result, {
    requestId: makeId(),
    promptVersion: 'test@1',
    mode: 'example',
    modelConfigId: 'test',
  });
}
function complete() {
  let p = seed();
  for (const task of ['derive_features', 'link_evidence', 'propose_roles'] as const)
    p = stage(p, task);
  return p;
}
function image() {
  let p = seed();
  const s = createSource('image', '真实尺寸的测试图');
  s.status = 'ready';
  Object.assign(s.versions[0], {
    assetId: 'image-asset',
    width: 1000,
    height: 600,
    mime: 'image/png',
  });
  p.sources.push(s);
  p = synchronizeLab(p);
  return addAnnotation(p, {
    sourceId: s.id,
    sourceRevision: 1,
    shapeType: 'rectangle',
    normalizedGeometry: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
    label: '区域说明',
    status: 'pending',
    createdBy: 'example',
    assetId: 'image-asset',
    originalWidth: 1000,
    originalHeight: 600,
  });
}
describe('需求实验室：结构、证据与关系', () => {
  it('图像候选未核对前不会送入文字分析，接受后以可追溯标注文字进入而非原图像素', () => {
    let p = image();
    const a = p.lab!.annotations[0];
    expect(
      buildLabRequest(p, 'derive_features').analysis.evidence.some(
        (e) => e.evidenceId === a.evidenceId,
      ),
    ).toBe(false);
    p = updateAnnotation(p, a.id, { status: 'accepted' });
    const input = buildLabRequest(p, 'derive_features');
    expect(input.analysis.evidence).toContainEqual(
      expect.objectContaining({
        evidenceId: a.evidenceId,
        excerpt: '区域说明',
        verificationStatus: 'verified',
      }),
    );
    expect(JSON.stringify(input)).not.toContain('data:image');
  });
  it('七种节点、阶段结果和方案通过真实Schema，普通证据聚合', () => {
    const p = complete();
    expect(new Set(p.lab!.nodes.map((n) => n.type)).size).toBe(7);
    expect(() => assertLab(p)).not.toThrow();
    expect(explorationSchema.safeParse(p).success).toBe(true);
    expect(visibleGraph(seed().lab!).nodes.every((n) => n.type === 'source')).toBe(true);
    expect(graphNodeSchema.safeParse({ ...p.lab!.nodes[0], type: 'unknown' }).success).toBe(false);
    expect(
      roleRequirementSchema.safeParse({ ...p.lab!.requirements[0], title: undefined }).success,
    ).toBe(false);
  });
  it('缺失节点与无效证据被拒绝，不能只靠高置信分数成为强关联', () => {
    const p = complete(),
      edge = p.lab!.edges[0];
    expect(() => validateEdge(p, p.lab!, { ...edge, targetNodeId: 'missing' })).toThrow();
    expect(() => validateEdge(p, p.lab!, { ...edge, evidenceRefs: ['missing'] })).toThrow();
    const weak = p.lab!.edges.find((e) => e.relationType === 'weakly_related')!;
    expect(weak.strengthClass).toBe('weak');
    expect(() => validateEdge(p, p.lab!, { ...weak, strengthClass: 'strong' })).toThrow();
    expect(() =>
      validateLinkResult(buildLabRequest(p, 'link_evidence'), {
        ...mockLinks(buildLabRequest(p, 'link_evidence')),
        relations: [{ ...weak, confidence: 1 }],
      }),
    ).toThrow();
  });
  it('冲突必须有两边证据、依据和范围，不能伪造另一方', () => {
    const p = complete(),
      edge = p.lab!.edges.find((e) => e.relationType === 'conflicts_with')!;
    expect(edge.strengthClass).toBe('conflict');
    expect(edge.status).toBe('pending');
    expect(() => validateEdge(p, p.lab!, { ...edge, rightEvidenceIds: [] })).toThrow();
    expect(() =>
      validateEdge(p, p.lab!, { ...edge, rightEvidenceIds: edge.leftEvidenceIds }),
    ).toThrow();
    expect(() =>
      validateEdge(p, p.lab!, { ...edge, status: 'verified', verifiedByUser: false }),
    ).toThrow();
  });
  it('删除关系形成排除标记，相同分析不恢复；撤销与重做没有重复边', () => {
    let p = complete();
    const edge = p.lab!.edges.find((e) => e.relationType === 'weakly_related')!;
    p = deleteRelation(p, edge.id);
    const op = p.operations!.at(-1)!;
    p = stage(p, 'link_evidence');
    expect(p.lab!.edges.find((e) => e.id === edge.id)!.status).toBe('deleted');
    p = undoResearch(p, op.id);
    p = synchronizeLab(p);
    expect(p.lab!.edges.find((e) => e.id === edge.id)!.status).toBe(edge.status);
    expect(p.lab!.edges.filter((e) => e.id === edge.id)).toHaveLength(1);
    p = redoResearch(p, op.id);
    expect(p.lab!.edges.find((e) => e.id === edge.id)!.status).toBe('deleted');
    p = restoreRelation(p, edge.id);
    expect(p.lab!.edges.filter((e) => e.id === edge.id)).toHaveLength(1);
  });
  it('修改关系类型保留原类型排除记录，重投影不重复生成旧关系', () => {
    let p = complete();
    const e = p.lab!.edges.find((e) => e.relationType === 'weakly_related')!;
    p = editRelationType(p, e.id, 'depends_on');
    p = synchronizeLab(p);
    expect(p.lab!.edges.find((v) => v.id === e.id)!.status).toBe('deleted');
    expect(
      p.lab!.edges.filter(
        (v) => v.relationType === 'depends_on' && v.sourceNodeId === e.sourceNodeId,
      ),
    ).toHaveLength(1);
  });
  it('旧来源版本证据不能变成新依据，失效关系降级待复核', () => {
    let p = complete();
    const s = structuredClone(p.sources[0]);
    p = sourceChanged(p, s, {
      ...s.versions[0],
      revision: 2,
      paragraphs: paragraphs('新的资料说明'),
      text: '新的资料说明',
    });
    p = synchronizeLab(p);
    expect(
      p.lab!.nodes.some(
        (n) => n.type === 'evidence' && n.content.sourceId === s.id && n.status !== 'verified',
      ),
    ).toBe(true);
    expect(
      buildLabRequest(p, 'link_evidence').analysis.evidence.every(
        (e) => e.sourceId !== s.id || e.sourceRevision === 2,
      ),
    ).toBe(true);
  });
  it('模型角色范围与重复要求校验，不接受排除功能', () => {
    const p = complete(),
      input = buildLabRequest(p, 'propose_roles'),
      out = mockRoles(input);
    out.solutions[0].requirements[0].evidenceIds = ['missing'];
    expect(() => validateRoleResult(input, out)).toThrow();
    expect(
      labResultSchema.safeParse({ stage: 'propose_roles', output: { solutions: [{}] } }).success,
    ).toBe(false);
  });
});
describe('标注、局部历史与布局', () => {
  it('跨资料证据可主动收回资料节点，引用保留，撤销恢复独立展示', () => {
    let p = complete();
    const evidence = p.lab!.nodes.find((n) => n.type === 'evidence' && n.content.independent)!;
    p = pinEvidence(p, evidence.evidenceIds[0], false);
    expect(visibleGraph(p.lab!).nodes.some((n) => n.id === evidence.id)).toBe(false);
    expect(p.evidence.some((e) => e.evidenceId === evidence.evidenceIds[0])).toBe(true);
    p = synchronizeLab(undoResearch(p, p.operations!.at(-1)!.id));
    expect(visibleGraph(p.lab!).nodes.some((n) => n.id === evidence.id)).toBe(true);
  });
  it.each([20, 100, 300] as const)('%i节点合成研究：布局和引用合法，新增保留已有坐标', (size) => {
    const p = syntheticLab(size);
    expect(p.lab!.nodes).toHaveLength(size);
    expect(() => assertLab(p)).not.toThrow();
    const moved = moveNode(p, p.lab!.nodes[0].id, { x: 70, y: 80 });
    const expanded = collapseNode(moved, moved.lab!.nodes[0].id);
    expect(expanded.lab!.nodes[0].collapsed).toBe(false);
    expect(() => assertLab(expanded)).not.toThrow();
    const stable = p.lab!.nodes.map((n) => [n.id, n.layoutPosition]);
    const s = createSource('text', '新增合成资料');
    s.status = 'ready';
    s.versions[0].text = '局部新增';
    s.versions[0].paragraphs = paragraphs('局部新增');
    p.sources.push(s);
    p.evidence.push(...textEvidence(s, s.versions[0]));
    const next = synchronizeLab(p);
    for (const [id, pos] of stable)
      expect(next.lab!.nodes.find((n) => n.id === id)!.layoutPosition).toEqual(pos);
  });
  it('非法或缺尺寸坐标拒绝，AI不能直接确认，尺寸必须绑定原图', () => {
    const p = image(),
      a = p.lab!.annotations[0];
    expect(
      annotationSchema.safeParse({
        ...a,
        normalizedGeometry: { x: 0.9, y: 0, width: 0.3, height: 0.1 },
      }).success,
    ).toBe(false);
    expect(annotationSchema.safeParse({ ...a, originalWidth: undefined }).success).toBe(false);
    expect(() => addAnnotation(p, { ...a, status: 'accepted', createdBy: 'ai' })).toThrow();
    expect(() => addAnnotation(p, { ...a, originalWidth: 900 })).toThrow();
  });
  it('接受只确认区域；移动和调整尺寸、删除、撤销各自保留其他标注', () => {
    let p = image();
    const a = p.lab!.annotations[0];
    p = updateAnnotation(p, a.id, { status: 'accepted' });
    expect(p.lab!.annotations[0].status).toBe('accepted');
    p = updateAnnotation(p, a.id, { geometry: { x: 0.3, y: 0.4, width: 0.2, height: 0.3 } });
    const original = p.evidence.find((e) => e.evidenceId === a.evidenceId)!.excerpt;
    p = deleteRelation(p, p.lab!.edges[0].id);
    const unrelated = p.lab!.edges[0].status;
    p = updateAnnotation(p, a.id, { status: 'deleted' });
    p = undoResearch(p, p.operations!.at(-1)!.id);
    expect(p.lab!.annotations[0].normalizedGeometry).toEqual({
      x: 0.3,
      y: 0.4,
      width: 0.2,
      height: 0.3,
    });
    expect(p.evidence.find((e) => e.evidenceId === a.evidenceId)!.excerpt).toBe(original);
    expect(p.lab!.edges[0].status).toBe(unrelated);
  });
  it('来源更新后标注需复核，禁止套用到新版', () => {
    let p = image();
    const a = p.lab!.annotations[0],
      s = structuredClone(p.sources.find((s) => s.id === a.sourceId)!);
    p = sourceChanged(p, s, { ...s.versions[0], revision: 2 });
    p = synchronizeLab(p);
    expect(p.lab!.annotations[0].status).toBe('stale');
    expect(() => updateAnnotation(p, a.id, { status: 'accepted' })).toThrow();
  });
  it('拖动后新增、展开和聚焦都不重排已有坐标，撤销只恢复对应节点', () => {
    let p = complete();
    const id = p.lab!.nodes[0].id,
      id2 = p.lab!.nodes[1].id;
    p = moveNode(p, id, { x: 100, y: 200 });
    const op = p.operations!.at(-1)!;
    p = moveNode(p, id2, { x: 900, y: 800 });
    p = collapseNode(p, id2);
    const before = p.lab!.nodes.map((n) => [n.id, n.layoutPosition]);
    const s = createSource('text', '新增资料');
    s.status = 'ready';
    s.versions[0].paragraphs = paragraphs('新增信息');
    s.versions[0].text = '新增信息';
    p.sources.push(s);
    p.evidence.push(...textEvidence(s, s.versions[0]));
    p = synchronizeLab(p);
    for (const [id, pos] of before)
      expect(p.lab!.nodes.find((n) => n.id === id)!.layoutPosition).toEqual(pos);
    const chain = evidenceChain(p.lab!, `requirement:${p.lab!.requirements[0].id}`);
    expect(chain.has(`requirement:${p.lab!.requirements[0].id}`)).toBe(true);
    p = undoResearch(p, op.id);
    expect(p.lab!.nodes.find((n) => n.id === id2)!.layoutPosition).toEqual({ x: 900, y: 800 });
  });
  it('推断被接受后仍是AI来源，锁定要求不允许编辑', () => {
    let p = complete();
    const f = p.findings.find((f) => f.basis === 'inferred')!;
    p = editFindingNode(p, f.id, { status: 'confirmed' });
    const n = p.lab!.nodes.find((n) => n.id === findingNodeId(f.id))!;
    expect(n.originType).toBe('ai_inference');
    expect(n.acceptedByUser).toBe(true);
    const r = p.lab!.requirements[0];
    p = editRequirement(p, r.id, { locked: true });
    expect(() => editRequirement(p, r.id, { title: '覆盖' })).toThrow();
  });
});
describe('并发、快照与工作台闭环', () => {
  it('后台结果不覆盖编辑，拖动无关节点不让阶段全失效，迟到响应只应用一次', () => {
    let p = stage(seed(), 'derive_features');
    const input = buildLabRequest(p, 'propose_roles'),
      start = beginStage(p, 'propose_roles', input.inputVersions, [], 'v1');
    p = moveNode(start.project, p.lab!.nodes[0].id, { x: 600, y: 500 });
    const out = { stage: 'propose_roles', output: mockRoles(input) };
    const reply = {
      requestId: makeId(),
      promptVersion: 'v1',
      mode: 'example' as const,
      modelConfigId: 'test',
    };
    p = mergeStageResult(p, start.run.id, input, out, reply);
    expect(p.lab!.solutions.length).toBeGreaterThan(0);
    const count = p.lab!.requirements.length;
    p = mergeStageResult(p, start.run.id, input, out, reply);
    expect(p.lab!.requirements).toHaveLength(count);
    expect(p.lab!.nodes[0].layoutPosition).toEqual({ x: 600, y: 500 });
  });
  it('相关功能修改使岗位结果过期，已有编辑不丢失', () => {
    let p = stage(seed(), 'derive_features');
    const input = buildLabRequest(p, 'propose_roles'),
      start = beginStage(p, 'propose_roles', input.inputVersions, [], 'v1');
    p = start.project;
    for (const f of p.findings)
      p = editFindingNode(p, f.id, {
        description: '人工最新编辑',
      });
    p = mergeStageResult(
      p,
      start.run.id,
      input,
      { stage: 'propose_roles', output: mockRoles(input) },
      { requestId: makeId(), promptVersion: 'v1', mode: 'example', modelConfigId: 'test' },
    );
    expect(p.findings.some((f) => f.description === '人工最新编辑')).toBe(true);
    expect(p.lab!.runs.at(-1)!.status).toMatch(/stale|partial/);
  });
  it('输入版本不包含视图坐标，包含证据与用户决定', () => {
    let p = complete();
    const before = objectVersions(p);
    p = moveNode(p, p.lab!.nodes[0].id, { x: 500, y: 500 });
    expect(objectVersions(p)).toEqual(before);
    const f = p.findings[0];
    p = editFindingNode(p, f.id, { description: '改变需求' });
    expect(digest(objectVersions(p))).not.toBe(digest(before));
  });
  it('不可变快照完整保存布局、标注与角色，派生副本不串项目', () => {
    let p = complete();
    p = chooseSolutions(p, [p.lab!.solutions[0].id]);
    p = moveNode(p, p.lab!.nodes[0].id, { x: 50, y: 80 });
    const snap = createSnapshot(p, 'draft', new Set()),
      before = JSON.stringify(snap);
    p = moveNode(p, p.lab!.nodes[0].id, { x: 500, y: 800 });
    expect(JSON.stringify(snap)).toBe(before);
    const fork = forkResearch(snap, '独立副本', true);
    expect(fork.lab!.nodes[0].projectId).toBe(fork.id);
    expect(fork.lab!.nodes[0].layoutPosition).toEqual({ x: 50, y: 80 });
    expect(() => assertLab(fork)).not.toThrow();
  });
  it('确认方案、部分要求导入为待确认，保留快照来源；上游新版本不会覆盖', () => {
    let p = complete();
    const solution = p.lab!.solutions[0];
    p = chooseSolutions(p, [solution.id]);
    p = editSolution(p, solution.id, { status: 'confirmed' });
    const r = p.lab!.requirements.find((r) => r.solutionId === solution.id)!;
    p = editRequirement(p, r.id, { status: 'confirmed' });
    const m = materialFromSnapshot(createSnapshot(p, 'draft', new Set()));
    m.roleData!.requirements = m.roleData!.requirements.filter((v) => v.id === r.id);
    const features = m.features.filter((f) => r.relatedFeatureIds.includes(f.id)).map((f) => f.id);
    const w = importRequirementMaterial(newWorkspace('测试岗位'), m, features, true);
    expect(workspaceSchema.safeParse(w).success).toBe(true);
    const req = w.items.find((i) => i.kind === 'requirement')!;
    expect(req.status).toBe('pending');
    expect(req.researchLink!.roleOrigin!.requirementId).toBe(r.id);
    const saved = JSON.stringify(w);
    p = editFindingNode(p, p.findings[0].id, { description: '上游新说明' });
    const latest = materialFromSnapshot(
      createSnapshot({ ...p, snapshots: [createSnapshot(p, 'draft')] }, 'draft'),
    );
    expect(() =>
      upstreamPlan(w, w.researchImports![0], { ...latest, lineageRootId: m.lineageRootId }),
    ).not.toThrow();
    expect(JSON.stringify(w)).toBe(saved);
    let updatedResearch = editRequirement(p, r.id, { description: '新版独立岗位要求' });
    updatedResearch = editRequirement(updatedResearch, r.id, { status: 'confirmed' });
    const updatedMaterial = {
      ...materialFromSnapshot(createSnapshot(updatedResearch, 'draft')),
      lineageRootId: m.lineageRootId,
    };
    const plan = upstreamPlan(w, w.researchImports![0], updatedMaterial),
      entry = plan.entries.find((e) => e.roleRequirementId === r.id)!;
    expect(entry).toBeDefined();
    const synced = applyUpstreamPlan(w, w.researchImports![0].id, updatedMaterial, plan, [
      entry.featureId,
    ]);
    expect(synced.items.find((i) => i.id === req.id)!.text).toContain('新版独立岗位要求');
    expect(JSON.stringify(w)).toBe(saved);
    const locked = structuredClone(w);
    locked.items.find((i) => i.id === req.id)!.locked = true;
    expect(() =>
      applyUpstreamPlan(
        locked,
        w.researchImports![0].id,
        updatedMaterial,
        upstreamPlan(locked, locked.researchImports![0], updatedMaterial),
        [entry.featureId],
      ),
    ).toThrow('锁定');
  });
  it('无确认方案不允许导入，伪造要求证据或缺失来源版本拒绝', () => {
    const p = complete(),
      m = materialFromSnapshot(createSnapshot(p, 'draft'));
    expect(() =>
      importRequirementMaterial(
        newWorkspace('岗位'),
        m,
        m.features.map((f) => f.id),
        true,
      ),
    ).toThrow();
    m.roleData!.requirements[0].evidenceIds = ['missing'];
    expect(() => validateMaterial(m)).toThrow();
  });
});
