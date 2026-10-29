import { describe, it, expect } from 'vitest';
import { syntheticLab } from '../fixtures/lab';
import { newExploration, explorationSchema } from '../../src/lib/exploration/model';
import { synchronizeLab, visibleGraph } from '../../src/lib/lab/graph';
import {
  researchProgress,
  sourceSetSignature,
  groupedEvidence,
  orderedQuestions,
} from '../../src/lib/lab/guided';
import {
  markResearchCheckpoint,
  saveProductIdea,
  mergeFeatureCandidates,
  chooseImportRequirements,
  chooseSolutions,
  editSolution,
  editRequirement,
  editResearchGoal,
} from '../../src/lib/lab/operations';
import { undoResearch } from '../../src/lib/exploration/journal';
import { createSnapshot, paragraphs, sourceChanged } from '../../src/lib/exploration/domain';
import { researchSignature, forkResearch } from '../../src/lib/exploration/research';
import { boardPresentation } from '../../src/lib/lab/presentation';
describe('五阶段研究：实际状态与兼容性', () => {
  it('旧研究和快照兼容新增默认视图，不清空节点和布局', () => {
    const p = syntheticLab(20),
      raw = JSON.parse(JSON.stringify(p));
    delete raw.lab.researchGuide;
    delete raw.lab.ui.researchView;
    delete raw.lab.ui.researchStep;
    delete raw.lab.ui.boardDensity;
    delete raw.lab.ui.focusTarget;
    const migrated = explorationSchema.parse(raw);
    expect(migrated.lab!.ui.researchView).toBe('guided');
    expect(migrated.lab!.ui.researchStep).toBe('materials');
    expect(migrated.lab!.nodes).toEqual(p.lab!.nodes);
    expect(migrated.lab!.edges).toEqual(p.lab!.edges);
  });
  it('跳到最后阶段不代表完成，没有资料时禁止确认', () => {
    const p = synchronizeLab(newExploration('空研究'));
    p.lab!.ui.researchStep = 'handoff';
    expect(researchProgress(p).states.materials.done).toBe(false);
    expect(researchProgress(p).states.handoff.done).toBe(false);
    expect(() => markResearchCheckpoint(p, 'materials')).toThrow();
  });
  it('确认资料集合绑定真实来源版本，后续新增或修订会失效', () => {
    let p = syntheticLab(20);
    p = markResearchCheckpoint(p, 'materials');
    expect(researchProgress(p).states.materials.done).toBe(true);
    const original = sourceSetSignature(p),
      s = p.sources[0];
    p = sourceChanged(p, s, {
      ...s.versions[0],
      revision: 2,
      text: '实际修订资料',
      paragraphs: paragraphs('实际修订资料'),
    });
    expect(sourceSetSignature(p)).not.toBe(original);
    expect(researchProgress(p).states.materials.done).toBe(false);
  });
  it('可保留非关键未决项后继续，不要求每条证据确认', () => {
    let p = syntheticLab(20);
    p.questions.push({
      id: 'minor-question',
      title: '次要细节',
      detail: '不影响当前核心范围',
      findingIds: [],
      evidenceIds: [],
      status: 'open',
      answer: '',
    });
    p = synchronizeLab(p);
    p = markResearchCheckpoint(p, 'evidence');
    expect(researchProgress(p).states.evidence.done).toBe(true);
    expect(p.questions.find((q) => q.id === 'minor-question')!.status).toBe('open');
    expect(orderedQuestions(p).find((q) => q.id === 'minor-question')!.priority.level).toBe('low');
  });
  it('问题优先级来自范围、冲突与依赖，不使用模型置信分数', () => {
    const p = syntheticLab(20),
      q = p.questions[0];
    p.findings[0].kind = 'conflict';
    expect(orderedQuestions(p).find((row) => row.id === q.id)!.priority.level).toBe('high');
    p.findings[0].kind = 'feature';
    expect(orderedQuestions(p).find((row) => row.id === q.id)!.priority.level).toBe('medium');
  });
  it('同文证据聚合展示，原始来源和版本引用完整保留', () => {
    const p = syntheticLab(20);
    const second = p.sources[1];
    second.versions[0].text = p.sources[0].versions[0].text;
    second.versions[0].paragraphs = paragraphs(second.versions[0].text);
    const e = p.evidence[1];
    e.excerpt = p.evidence[0].excerpt;
    e.location = {
      kind: 'text',
      paragraphId: second.versions[0].paragraphs[0].id,
      start: 0,
      end: e.excerpt.length,
    };
    const before = JSON.stringify(p);
    const group = groupedEvidence(p).find((g) => g.items.length === 2)!;
    expect(new Set(group.items.map((e) => e.sourceId)).size).toBe(2);
    expect(group.items.map((e) => e.sourceRevision)).toEqual([1, 1]);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('产品构想保存为来源版本，已有新编辑时拒绝覆盖', () => {
    let p = synchronizeLab(newExploration('想法'));
    p = saveProductIdea(p, '先做文件导出');
    expect(p.sources).toHaveLength(1);
    p = saveProductIdea(p, '先做编辑再导出', 1);
    expect(p.sources[0].versions).toHaveLength(2);
    expect(() => saveProductIdea(p, '过期文字', 1)).toThrow('新版本');
    expect(p.sources[0].versions.at(-1)!.text).toBe('先做编辑再导出');
  });
  it('合并功能保留两份原始依据和来源属性，相关要求复核，可撤销', () => {
    let p = syntheticLab(20);
    const a = p.findings[0],
      b = p.findings[1];
    const proof = [...new Set([...a.evidenceIds, ...b.evidenceIds])];
    p = mergeFeatureCandidates(p, a.id, b.id);
    expect(p.findings.find((f) => f.id === a.id)!.evidenceIds).toEqual(proof);
    expect(p.findings.find((f) => f.id === a.id)!.basis).toBe('inferred');
    expect(p.findings.find((f) => f.id === b.id)!.status).toBe('excluded');
    expect(p.evidence).toHaveLength(5);
    p = synchronizeLab(undoResearch(p, p.operations!.at(-1)!.id));
    expect(p.findings.find((f) => f.id === b.id)!.status).toBe('pending');
  });
  it('锁定功能不能被合并，未经确认的要求不能选入准备导入集合', () => {
    const p = syntheticLab(20);
    p.findings[0].locked = true;
    expect(() => mergeFeatureCandidates(p, p.findings[0].id, p.findings[1].id)).toThrow();
    expect(() => chooseImportRequirements(p, [p.lab!.requirements[0].id])).toThrow();
  });
  it('选择的岗位要求编辑后，导入就绪状态自动失效', () => {
    let p = syntheticLab(20);
    const solution = p.lab!.solutions[0],
      r = p.lab!.requirements[0];
    p = chooseSolutions(p, [solution.id]);
    p = editSolution(p, solution.id, { status: 'confirmed' });
    p = editRequirement(p, r.id, { status: 'confirmed' });
    p = chooseImportRequirements(p, [r.id]);
    expect(researchProgress(p).states.roles.done).toBe(true);
    p = editRequirement(p, r.id, { description: '新的人工编辑' });
    expect(researchProgress(p).states.roles.done).toBe(false);
  });
  it('阶段、筛选和聚焦都是视图变化，不改业务签名与节点', () => {
    const p = syntheticLab(20),
      before = JSON.stringify([p.lab!.nodes, p.lab!.edges, p.findings, p.questions, p.operations]),
      signature = researchSignature(p);
    p.lab!.ui.researchStep = 'handoff';
    p.lab!.ui.researchView = 'board';
    p.lab!.ui.focusTarget = { kind: 'node', id: p.lab!.nodes[0].id };
    p.lab!.ui.filters.types = ['source'];
    expect(researchSignature(p)).toBe(signature);
    expect(
      JSON.stringify([p.lab!.nodes, p.lab!.edges, p.findings, p.questions, p.operations]),
    ).toBe(before);
  });
  it('修改产品目标后仅标记方案和要求复核，保留人工内容及原始证据', () => {
    let p = syntheticLab(20);
    const solution = p.lab!.solutions[0],
      requirement = p.lab!.requirements[0];
    p = editSolution(p, solution.id, { status: 'confirmed' });
    p = editRequirement(p, requirement.id, { status: 'confirmed', description: '人工保留的要求' });
    const proof = JSON.stringify(p.evidence);
    p = editResearchGoal(p, '先交付单人编辑与导出，再研究协作');
    expect(p.lab!.solutions[0].status).toBe('review');
    expect(p.lab!.requirements[0].status).toBe('review');
    expect(p.lab!.requirements[0].description).toBe('人工保留的要求');
    expect(JSON.stringify(p.evidence)).toBe(proof);
  });
  it('回答重点问题不会把已经查看的核心证据误标为未读', () => {
    let p = syntheticLab(20);
    p.findings[0].kind = 'conflict';
    p = markResearchCheckpoint(p, 'evidence');
    p.questions[0].status = 'answered';
    p.questions[0].answer = '首版暂缓协作，保留后续研究。';
    expect(researchProgress(p).states.evidence.done).toBe(true);
    p.questions[0].detail = '新增了必须核对的冲突内容';
    expect(researchProgress(p).states.evidence.done).toBe(false);
  });
  it.each([20, 100, 300] as const)('%i节点的核心、远景与全量投影保留全部底层对象', (size) => {
    const p = syntheticLab(size),
      before = JSON.stringify(p);
    const core = boardPresentation(p, 'core', 0.85),
      far = boardPresentation(p, 'all', 0.25),
      full = boardPresentation(p, 'all', 0.85),
      focused = boardPresentation(p, 'core', 0.85, true);
    expect(core.nodes.length).toBeLessThanOrEqual(full.nodes.length);
    expect(far.nodes.every((n) => n.type !== 'evidence')).toBe(true);
    expect(full.nodes).toEqual(visibleGraph(p.lab!).nodes);
    expect(focused.nodes).toEqual(full.nodes);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('检查点与视图进入不可变快照，派生不会改变旧记录', () => {
    let p = syntheticLab(20);
    p = markResearchCheckpoint(p, 'materials');
    p.lab!.ui.researchStep = 'evidence';
    const snap = createSnapshot(p, 'draft'),
      before = JSON.stringify(snap);
    p = markResearchCheckpoint(p, 'evidence');
    const fork = forkResearch(snap, '继续');
    expect(fork.lab!.ui.researchStep).toBe('evidence');
    expect(fork.lab!.researchGuide.sourceSignature).toBeTruthy();
    expect(JSON.stringify(snap)).toBe(before);
  });
});
