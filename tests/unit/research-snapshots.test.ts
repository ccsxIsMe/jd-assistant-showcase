import { describe, expect, it } from 'vitest';
import {
  newExploration,
  makeId,
  type AnalysisRun,
  type Finding,
} from '../../src/lib/exploration/model';
import {
  createSource,
  paragraphs,
  sourceChanged,
  createSnapshot,
  applyAnalysis,
  semanticSignature,
  changeFinding,
  compareSnapshots,
} from '../../src/lib/exploration/domain';
import { analysisRequestFor, exampleAnalysis } from '../../src/lib/exploration/analysis';
import { fullResearch, forkResearch, researchSignature } from '../../src/lib/exploration/research';
import { recordResearchChange, undoResearch } from '../../src/lib/exploration/journal';
import { materialFromSnapshot, validateMaterial } from '../../src/lib/exploration/material';
import {
  importRequirementMaterial,
  upstreamPlan,
  applyUpstreamPlan,
} from '../../src/lib/exploration/workbench-import';
import { newWorkspace, fields, newItem } from '../../src/lib/workbench/model';
import { editItem, toggleLock } from '../../src/lib/workbench/domain';

function seed() {
  let p = newExploration('原型产品研究');
  p.initialObjective = '为小团队做实时预览和文件导出，不复制支付社区。';
  const source = createSource('text', '实际用户说明');
  source.status = 'ready';
  source.versions[0].text = '需要实时预览。\n需要文件导出。\n不需要支付和社区。';
  source.versions[0].paragraphs = paragraphs(source.versions[0].text);
  p = sourceChanged(p, source, source.versions[0]);
  const output = exampleAnalysis(analysisRequestFor(p));
  const run: AnalysisRun = {
    id: makeId(),
    at: new Date().toISOString(),
    requestId: makeId(),
    promptVersion: 'exploreRequirements@1.1.0',
    mode: 'example',
    baseSignature: semanticSignature(p),
    applied: false,
    output,
    modelConfig: {
      provider: 'mock',
      model: 'built-in-product-example',
      configurationId: 'example@1',
    },
    parserVersions: { pdfjs: '6.4.299' },
  };
  p.runs.push(run);
  p = applyAnalysis(
    p,
    run,
    output.findings.map((f) => f.key),
    true,
  );
  p.overviewConfirmed = true;
  p = changeFinding(p, p.findings[0].id, { status: 'confirmed' });
  return p;
}
function candidate(p: ReturnType<typeof seed>, name: string): Finding {
  return {
    ...structuredClone(p.findings[0]),
    id: makeId(),
    revision: 1,
    title: name,
    description: name,
    status: 'pending',
    parentId: null,
    basis: 'inferred',
    evidenceIds: [],
    origin: 'user',
  };
}

describe('完整研究快照与派生', () => {
  it('确认快照仍归档未确认、排除、原始输入、原始分析和人工记录', () => {
    const p = seed();
    p.findings[1].status = 'review';
    p.findings[2].status = 'excluded';
    const failed = createSource('document', '损坏文档');
    failed.status = 'error';
    failed.error = '文件损坏，尚未解析';
    p.sources.push(failed);
    const snapshot = createSnapshot(p, 'confirmed', new Set());
    expect(snapshot.research?.findings.map((f) => f.status)).toEqual([
      'confirmed',
      'review',
      'excluded',
    ]);
    expect(
      snapshot.research?.sources.some((s) => s.status === 'error' && s.error.includes('损坏')),
    ).toBe(true);
    expect(snapshot.research?.runs).toHaveLength(1);
  });
  it('完整快照各部分独立，不把过程压成摘要，也不写入API Key', () => {
    const p = seed();
    const before = structuredClone(p);
    const changed = structuredClone(p);
    changed.findings[1].description = '人工补充导出验收条件';
    const recorded = recordResearchChange(before, changed, '人工修改功能');
    const s = createSnapshot(recorded, 'confirmed', new Set());
    expect(s.research?.originalObjective).toBe(p.initialObjective);
    expect(s.research?.findings).toHaveLength(3);
    expect(s.findings).toHaveLength(1);
    expect(s.research?.runs[0].output.findings).toHaveLength(3);
    expect(s.research?.operations.at(-1)?.after.findings[0].description).toBe(
      '人工补充导出验收条件',
    );
    expect(s.research?.runs[0].modelConfig?.configurationId).toBe('example@1');
    expect(JSON.stringify(s)).not.toContain('DEEPSEEK_API_KEY');
    recorded.findings[0].description = '后续编辑';
    expect(s.research!.findings[0].description).not.toBe('后续编辑');
  });
  it('派生恢复保存的完整状态，复制建立独立谱系，旧快照不变', () => {
    const p = seed();
    const v1 = createSnapshot(p, 'confirmed', new Set());
    const saved = structuredClone(v1);
    const derived = forkResearch(v1, 'V1上的新研究');
    expect(derived.findings).toHaveLength(3);
    expect(derived.runs).toHaveLength(1);
    const v2 = createSnapshot(derived, 'draft', new Set());
    expect(v2.lineage?.parentSnapshotId).toBe(v1.snapshotId);
    expect(v2.lineage?.rootSnapshotId).toBe(v1.lineage?.rootSnapshotId);
    const copied = forkResearch(v1, '独立副本', true);
    copied.findings[0].description = '只修改副本';
    const copy = createSnapshot(copied, 'draft', new Set());
    expect(copy.lineage?.rootSnapshotId).toBe(copy.snapshotId);
    expect(copy.lineage?.copiedFromSnapshotId).toBe(v1.snapshotId);
    expect(v1).toEqual(saved);
  });
  it('完整历史比较包括未确认项，不只比较最终确认摘要', () => {
    let p = seed();
    const v1 = createSnapshot(p, 'confirmed', new Set());
    p = changeFinding(p, p.findings[1].id, { description: '未确认的导出格式变更' });
    const v2 = createSnapshot(p, 'confirmed', new Set());
    expect(compareSnapshots(v1, v2).changed).toHaveLength(1);
    expect(v1.findings.map((f) => f.id)).not.toContain(p.findings[1].id);
  });
  it('旧快照只恢复真实保存的数据，并明确缺失过程限制', () => {
    const s = createSnapshot(seed(), 'confirmed', new Set());
    delete s.research;
    const state = fullResearch(s);
    expect(state.runs).toEqual([]);
    expect(state.archive.limitations.join()).toContain('旧格式');
  });
  it('缺失附件记录限制而不伪称归档，内容签名不因普通视图切换变化', () => {
    const p = seed();
    p.sources[0].versions[0].assetId = 'missing-file';
    const s = createSnapshot(p, 'confirmed', new Set());
    expect(s.research!.archive.missingAssetIds).toContain('missing-file');
    expect(s.research!.archive.limitations.join()).toContain('不能宣称完整归档');
    const signature = researchSignature(p);
    p.ui.view = 'structure';
    expect(researchSignature(p)).toBe(signature);
  });
});

describe('结构关系、确认和撤销', () => {
  it('拒绝循环和不存在的父节点，确认后改关系转需复核', () => {
    let p = seed();
    p = changeFinding(p, p.findings[0].id, { parentId: p.findings[1].id });
    expect(p.findings[0].status).toBe('review');
    expect(() => changeFinding(p, p.findings[1].id, { parentId: p.findings[0].id })).toThrow(
      '循环',
    );
    expect(() => changeFinding(p, p.findings[1].id, { parentId: 'missing' })).toThrow('不存在');
  });
  it('撤销只恢复相关对象，保留无关人工编辑；新编辑冲突拒绝', () => {
    let p = seed();
    p = changeFinding(p, p.findings[0].id, { description: '第一个修改' });
    const op = p.operations!.at(-1)!;
    p = changeFinding(p, p.findings[1].id, { description: '无关修改保留' });
    const undone = undoResearch(p, op.id);
    expect(undone.findings[0].description).not.toBe('第一个修改');
    expect(undone.findings[1].description).toBe('无关修改保留');
    const conflict = changeFinding(p, p.findings[0].id, { description: '新的编辑不能丢失' });
    expect(() => undoResearch(conflict, op.id)).toThrow('新编辑');
  });
  it('连续撤销保留单调节点版本，添加节点可以撤销', () => {
    let p = seed();
    const original = p.findings[0].description;
    p = changeFinding(p, p.findings[0].id, { description: 'A' });
    const a = p.operations!.at(-1)!.id;
    p = changeFinding(p, p.findings[0].id, { description: 'B' });
    const beforeRevision = p.findings[0].revision;
    p = undoResearch(p, p.operations!.at(-1)!.id);
    p = undoResearch(p, a);
    expect(p.findings[0].description).toBe(original);
    expect(p.findings[0].revision).toBeGreaterThan(beforeRevision);
    const next = structuredClone(p);
    next.findings.push(candidate(p, '新场景'));
    const recorded = recordResearchChange(p, next, '新增场景');
    expect(undoResearch(recorded, recorded.operations!.at(-1)!.id).findings).toHaveLength(
      p.findings.length,
    );
  });
});

describe('版本化需求接口与岗位候选', () => {
  it('拒绝重复清单、悬空问题和超出原文范围的伪造定位', () => {
    const material = materialFromSnapshot(createSnapshot(seed(), 'draft', new Set()));
    const duplicate = structuredClone(material);
    duplicate.sourceManifest.push(duplicate.sourceManifest[0]);
    expect(() => validateMaterial(duplicate)).toThrow('ID冲突');
    const dangling = structuredClone(material);
    dangling.openQuestions[0].findingIds = ['不存在的需求'];
    expect(() => validateMaterial(dangling)).toThrow('不存在');
    const outOfBounds = structuredClone(material);
    const location = outOfBounds.evidenceRecords[0].location;
    if (location.kind !== 'text') throw new Error('fixture must have text evidence');
    location.end = 100000;
    expect(() => validateMaterial(outOfBounds)).toThrow('原文位置');
  });
  it('资料包含确认/未确认、证据与来源结构，拒绝伪造ID和原文', () => {
    const m = materialFromSnapshot(createSnapshot(seed(), 'draft', new Set()));
    expect(m.unconfirmedItems.length).toBeGreaterThan(0);
    expect(m.sourceManifest[0].sourceId).toBe(m.sourceRecords[0].id);
    const invalid = structuredClone(m);
    invalid.features[0].evidenceIds = ['fake'];
    expect(() => validateMaterial(invalid)).toThrow('证据');
    const quote = structuredClone(m);
    quote.evidenceRecords[0].excerpt = '伪造原话';
    expect(() => validateMaterial(quote)).toThrow('原文');
  });
  it('导入形成任务与技能讨论候选，全部待确认，原岗位未变', () => {
    const p = seed();
    const m = materialFromSnapshot(createSnapshot(p, 'draft', new Set()));
    const before = newWorkspace('既有岗位');
    const w = importRequirementMaterial(before, m, [m.features[0].id]);
    expect(before.items).toHaveLength(0);
    expect(w.items.map((i) => i.status)).toEqual(['pending', 'pending']);
    expect(w.items[0].researchLink?.featureIds).toEqual([m.features[0].id]);
    expect(w.items[0].refs[0].excerpt).toBe(w.sources[0].versions[0].text.slice(0, 2500));
    expect(w.questions.some((q) => q.title.includes('团队现有能力'))).toBe(true);
    expect(w.researchImports![0].material.snapshotId).toBe(m.snapshotId);
  });
  it('未确认功能须明确承认边界，重复导入版本被阻止', () => {
    const m = materialFromSnapshot(createSnapshot(seed(), 'draft', new Set()));
    const unconfirmed = m.features.find((f) => f.status === 'pending')!;
    expect(() => importRequirementMaterial(newWorkspace('岗位'), m, [unconfirmed.id])).toThrow(
      '尚未确认',
    );
    const w = importRequirementMaterial(newWorkspace('岗位'), m, [unconfirmed.id], true);
    expect(() => importRequirementMaterial(w, m, [unconfirmed.id], true)).toThrow('已导入');
  });
  it('检查更新不改数据，显式同步可保留人工编辑、锁定与删除关联要求', () => {
    let p = seed();
    const v1 = createSnapshot(p, 'confirmed', new Set());
    const m1 = materialFromSnapshot(v1);
    let w = importRequirementMaterial(newWorkspace('岗位'), m1, [m1.features[0].id]);
    const task = w.items.find((i) => i.kind === 'task')!;
    const skill = w.items.find((i) => i.kind === 'requirement')!;
    w = editItem(w, task.id, { text: '本地人工修改必须保留' });
    w = toggleLock(w, task.id);
    p = changeFinding(p, p.findings[0].id, { description: '上游新版本' });
    const m2 = materialFromSnapshot(createSnapshot(p, 'draft', new Set()));
    m2.lineageRootId = m1.lineageRootId;
    const original = structuredClone(w);
    const plan = upstreamPlan(w, w.researchImports![0], m2);
    expect(w).toEqual(original);
    expect(plan.entries[0].locallyEdited).toBe(true);
    expect(() =>
      applyUpstreamPlan(w, w.researchImports![0].id, m2, plan, [m1.features[0].id]),
    ).toThrow('锁定');
    p = changeFinding(p, p.findings[0].id, { status: 'excluded' });
    const removed = materialFromSnapshot(createSnapshot(p, 'draft', new Set()));
    removed.lineageRootId = m1.lineageRootId;
    const removal = upstreamPlan(w, w.researchImports![0], removed);
    const result = applyUpstreamPlan(w, w.researchImports![0].id, removed, removal, [
      m1.features[0].id,
    ]);
    expect(result.items.find((i) => i.id === task.id)!.text).toBe('本地人工修改必须保留');
    expect(result.items.find((i) => i.id === skill.id)!.status).toBe('review');
    expect(result.items.find((i) => i.id === task.id)!.locked).toBe(true);
  });
  it('迟到计划与越界目标拒绝，用户选择前不静默覆盖', () => {
    let p = seed();
    const m1 = materialFromSnapshot(createSnapshot(p, 'confirmed', new Set()));
    let w = importRequirementMaterial(newWorkspace('岗位'), m1, [m1.features[0].id]);
    p = changeFinding(p, p.findings[0].id, { description: '上游范围变化' });
    const m2 = materialFromSnapshot(createSnapshot(p, 'draft', new Set()));
    m2.lineageRootId = m1.lineageRootId;
    const plan = upstreamPlan(w, w.researchImports![0], m2);
    const task = w.items.find((i) => i.kind === 'task')!;
    w = editItem(w, task.id, { text: '计划之后继续编辑' });
    expect(() =>
      applyUpstreamPlan(w, w.researchImports![0].id, m2, plan, [m1.features[0].id]),
    ).toThrow('过期');
    const rogue = newItem('task', '不相关任务');
    w.items.push(rogue);
    const forged = upstreamPlan(w, w.researchImports![0], m2);
    forged.entries[0].itemId = rogue.id;
    forged.entries[0].revision = rogue.revision;
    expect(() =>
      applyUpstreamPlan(w, w.researchImports![0].id, m2, forged, [m1.features[0].id]),
    ).toThrow('不属于');
    expect(fields(rogue).text).toBe('');
  });
});
