import { requirementMaterialSchema, type RequirementMaterial } from './material-model';
import { fullResearch } from './research';
import { evidenceValid } from './domain';
import { snapshotSchema, timestamp, type Snapshot } from './model';
import { currentDecisions } from '../decisions/records';
export function validateMaterial(raw: unknown): RequirementMaterial {
  const m = requirementMaterialSchema.parse(raw);
  if (m.roleData) {
    const d = m.roleData;
    if (
      new Set(d.solutions.map((s) => s.id)).size !== d.solutions.length ||
      new Set(d.requirements.map((r) => r.id)).size !== d.requirements.length
    )
      throw new Error('岗位方案或要求ID重复。');
    if (d.selectedSolutionIds.some((id) => !d.solutions.some((s) => s.id === id)))
      throw new Error('所选岗位方案不存在。');
    if (
      d.solutions.some(
        (s) =>
          s.productPlan &&
          [...s.productPlan.priorityFeatureIds, ...s.productPlan.deferredFeatureIds].some(
            (id) => !(m.structureNodes ?? m.features).some((f) => f.id === id),
          ),
      )
    )
      throw new Error('产品方案包含不存在的功能引用。');
    for (const r of d.requirements) {
      const s = d.solutions.find((s) => s.id === r.solutionId);
      if (
        !s ||
        !s.roles.some((role) => role.key === r.roleKey) ||
        r.projectId !== m.explorationId ||
        r.evidenceIds.some((id) => !m.evidenceRecords.some((e) => e.evidenceId === id)) ||
        [...r.relatedFeatureIds, ...r.inferenceIds].some(
          (id) => !(m.structureNodes ?? m.features).some((f) => f.id === id),
        )
      )
        throw new Error('岗位要求引用无效。');
    }
  }
  const findings = m.structureNodes ?? [...m.features, ...m.scenarios, ...m.assumptions];
  const views = [...m.features, ...m.scenarios, ...m.assumptions];
  if (
    m.features.some((f) => f.kind !== 'feature') ||
    m.scenarios.some((f) => f.kind !== 'scenario')
  )
    throw new Error('功能或场景分组类型不正确。');
  if (
    m.structureNodes &&
    views.some(
      (f) =>
        !m.structureNodes!.some(
          (node) => node.id === f.id && JSON.stringify(node) === JSON.stringify(f),
        ),
    )
  )
    throw new Error('功能证据与需求结构节点不一致。');
  if (m.features.some((f) => f.status === 'excluded' || f.basis === 'excluded'))
    throw new Error('明确排除的功能不能伪装成可导入功能。');
  if (
    m.structureNodes &&
    new Set(m.structureNodes.map((f) => f.id)).size !== m.structureNodes.length
  )
    throw new Error('需求结构节点ID重复。');
  for (const f of findings) {
    const seen = new Set([f.id]);
    let parent = f.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error('需求资料包含循环关系。');
      seen.add(parent);
      const target = findings.find((node) => node.id === parent);
      if (!target) throw new Error('需求结构引用不存在的父节点。');
      parent = target.parentId;
    }
  }
  const sourceIds = new Set(m.sourceRecords.map((s) => s.id));
  const evidenceIds = new Set(m.evidenceRecords.map((e) => e.evidenceId));
  if (
    sourceIds.size !== m.sourceRecords.length ||
    evidenceIds.size !== m.evidenceRecords.length ||
    new Set(m.sourceManifest.map((s) => s.sourceId)).size !== m.sourceManifest.length ||
    new Set(m.openQuestions.map((q) => q.id)).size !== m.openQuestions.length ||
    new Set(m.features.map((f) => f.id)).size !== m.features.length
  )
    throw new Error('需求资料ID冲突。');
  if (
    m.sourceManifest.length !== m.sourceRecords.length ||
    m.sourceManifest.some(
      (s) =>
        !m.sourceRecords.some(
          (r) => r.id === s.sourceId && r.versions.at(-1)!.revision === s.revision,
        ),
    )
  )
    throw new Error('需求资料来源清单与版本不一致。');
  if (
    m.evidenceRecords.some(
      (e) =>
        e.sourceId &&
        (!sourceIds.has(e.sourceId) ||
          !m.sourceRecords.some(
            (s) => s.id === e.sourceId && s.versions.some((v) => v.revision === e.sourceRevision),
          )),
    )
  )
    throw new Error('证据指向不存在的来源版本。');
  if (
    [
      ...m.evidenceRefs,
      ...findings.flatMap((f) => f.evidenceIds),
      ...views.flatMap((f) => f.evidenceIds),
      ...m.overview.evidenceIds,
      ...m.openQuestions.flatMap((q) => q.evidenceIds),
    ].some((id) => !evidenceIds.has(id))
  )
    throw new Error('需求资料证据引用缺失。');
  const allIds = new Set(findings.map((f) => f.id));
  if (m.openQuestions.some((q) => q.findingIds.some((id) => !allIds.has(id))))
    throw new Error('待确认问题关联不存在的需求节点。');
  if ([...m.confirmedItems, ...m.unconfirmedItems].some((id) => !allIds.has(id)))
    throw new Error('需求资料确认状态引用不存在的条目。');
  if (
    findings.some(
      (f) =>
        (m.confirmedItems.includes(f.id) && f.status !== 'confirmed') ||
        (m.unconfirmedItems.includes(f.id) && !['pending', 'review'].includes(f.status)),
    )
  )
    throw new Error('需求资料确认状态不一致。');
  for (const e of m.evidenceRecords) {
    if (e.location.kind === 'text') {
      const location = e.location;
      const source = m.sourceRecords.find((s) => s.id === e.sourceId);
      const paragraph = source?.versions
        .find((v) => v.revision === e.sourceRevision)
        ?.paragraphs.find((p) => p.id === location.paragraphId);
      if (
        !paragraph ||
        location.end <= location.start ||
        location.end > paragraph.text.length ||
        paragraph.text.slice(location.start, location.end) !== e.excerpt
      )
        throw new Error('需求资料原文位置或引用不匹配。');
    }
  }
  return m;
}
export function materialFromSnapshot(raw: Snapshot): RequirementMaterial {
  const s = snapshotSchema.parse(raw);
  const r = fullResearch(s);
  const active = r.findings.filter((f) => f.status !== 'excluded' && f.basis !== 'excluded');
  const covered = active.filter((f) =>
    ['feature', 'scenario', 'risk', 'condition', 'goal', 'conflict'].includes(f.kind),
  );
  return validateMaterial({
    ...(r.demo ? { demo: r.demo } : {}),
    format: 'product-requirements-material',
    schemaVersion: 1,
    snapshotId: s.snapshotId,
    explorationId: s.explorationId,
    lineageRootId: s.lineage?.rootSnapshotId ?? s.snapshotId,
    snapshotVersion: s.version,
    title: s.title,
    objective: r.overview.goal,
    targetUsers: r.overview.users,
    overview: r.overview,
    scenarios: active.filter((f) => f.kind === 'scenario'),
    features: active.filter((f) => f.kind === 'feature'),
    structureNodes: r.findings,
    constraints: [
      ...r.sources
        .filter((source) => !source.removed && source.title === '规划约束（用户补充）')
        .map((source) => source.versions.at(-1)!.text),
      r.overview.constraints,
      ...active.filter((f) => f.kind === 'condition').map((f) => f.description),
    ].filter(Boolean),
    openQuestions: currentDecisions(r.questions),
    evidenceRefs: [
      ...new Set([...r.overview.evidenceIds, ...active.flatMap((f) => f.evidenceIds)]),
    ],
    assumptions: active.filter((f) => f.basis === 'inferred' || f.kind === 'risk'),
    confirmedItems: covered.filter((f) => f.status === 'confirmed').map((f) => f.id),
    unconfirmedItems: covered
      .filter((f) => ['pending', 'review'].includes(f.status))
      .map((f) => f.id),
    sourceManifest: r.sources.map((source) => {
      const v = source.versions.at(-1)!;
      return {
        sourceId: source.id,
        revision: v.revision,
        title: source.title,
        kind: source.kind,
        status: source.status,
        url: v.normalizedUrl ?? v.originalUrl ?? '',
        fetchedAt: v.fetchedAt ?? '',
        removed: source.removed,
      };
    }),
    sourceRecords: r.sources,
    evidenceRecords: r.evidence,
    createdAt: s.createdAt,
    exportedAt: timestamp(),
    mode: s.mode,
    modeNotice: s.mode === 'example' ? '演示数据，非真实AI分析' : '真实AI候选，仍需人工核实',
    ...(r.demo
      ? {
          fixtureNotice: `示例项目｜虚构材料｜${s.mode === 'example' ? '预置分析结果' : '真实AI重分析'}`,
        }
      : {}),
    snapshotKind: s.kind,
    archiveLimitations: [
      ...r.archive.limitations,
      '轻量产品需求资料不包含原始图片、PDF、视频二进制；请保留完整研究包，或在本机源快照中查看原件。',
    ],
    ...(r.lab
      ? {
          roleData: {
            solutions: r.lab.solutions,
            requirements: r.lab.requirements,
            selectedSolutionIds: r.lab.activeSolutionIds,
          },
        }
      : {}),
  });
}
export function materialFeatureEvidenceState(m: RequirementMaterial, featureId: string) {
  const f = m.features.find((f) => f.id === featureId);
  if (!f) return 'missing';
  return f.evidenceIds.every((id) =>
    m.evidenceRecords.some(
      (e) => e.evidenceId === id && evidenceValid({ sources: m.sourceRecords }, e),
    ),
  ) &&
    (f.evidenceIds.length > 0 || f.basis === 'inferred')
    ? 'current'
    : 'review';
}
