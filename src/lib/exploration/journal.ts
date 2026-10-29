import { makeId, timestamp, type Exploration, type ResearchPatch } from './model';
import { emptyLab, type LabPatch, type LabState } from '../lab/model';
const labCollections = ['nodes', 'edges', 'annotations', 'solutions', 'requirements'] as const;
function labChanges(before: LabState | undefined, after: LabState | undefined) {
  if (!before && !after) return null;
  const a = before ?? emptyLab(),
    b = after ?? emptyLab();
  const left: LabPatch = { nodes: [], edges: [], annotations: [], solutions: [], requirements: [] };
  const right = structuredClone(left);
  for (const key of labCollections) {
    const diff = changes(a[key] as { id: string }[], b[key] as { id: string }[]);
    Object.assign(left, { [key]: diff.before });
    Object.assign(right, { [key]: diff.after });
  }
  for (const key of [
    'activeSolutionIds',
    'pinnedEvidenceIds',
    'embeddedEvidenceIds',
    'researchGuide',
  ] as const)
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      Object.assign(left, { [key]: a[key] });
      Object.assign(right, { [key]: b[key] });
    }
  return JSON.stringify(left) === JSON.stringify(right) ? null : { left, right };
}
function changes<T extends { id: string }>(before: T[], after: T[]) {
  const previous = new Map(before.map((v) => [v.id, v]));
  const next = new Map(after.map((v) => [v.id, v]));
  const ids = new Set(
    [...previous.keys(), ...next.keys()].filter(
      (id) => JSON.stringify(previous.get(id)) !== JSON.stringify(next.get(id)),
    ),
  );
  return { before: before.filter((v) => ids.has(v.id)), after: after.filter((v) => ids.has(v.id)) };
}
export function recordResearchChange(before: Exploration, next: Exploration, label: string) {
  const left: ResearchPatch = { findings: [], sources: [], evidence: [], questions: [] };
  const right = structuredClone(left);
  const lab = labChanges(before.lab, next.lab);
  if (lab) {
    left.lab = lab.left;
    right.lab = lab.right;
  }
  for (const key of ['findings', 'sources', 'questions'] as const) {
    const diff = changes(before[key] as { id: string }[], next[key] as { id: string }[]);
    Object.assign(left, { [key]: diff.before });
    Object.assign(right, { [key]: diff.after });
  }
  const prior = before.evidence.map((e) => ({ ...e, id: e.evidenceId }));
  const after = next.evidence.map((e) => ({ ...e, id: e.evidenceId }));
  const diff = changes(prior, after);
  left.evidence = diff.before.map(({ id, ...e }) => {
    void id;
    return e;
  });
  right.evidence = diff.after.map(({ id, ...e }) => {
    void id;
    return e;
  });
  if (
    JSON.stringify([before.overview, before.overviewConfirmed]) !==
    JSON.stringify([next.overview, next.overviewConfirmed])
  ) {
    Object.assign(left, {
      overview: before.overview,
      overviewConfirmed: before.overviewConfirmed,
      overviewRevision: before.overviewRevision,
    });
    Object.assign(right, {
      overview: next.overview,
      overviewConfirmed: next.overviewConfirmed,
      overviewRevision: next.overviewRevision,
    });
  }
  if (JSON.stringify(left) === JSON.stringify(right)) return next;
  const p = structuredClone(next);
  if ((p.operations?.length ?? 0) >= 2000)
    throw new Error('本研究修改记录达到上限，请保存快照并派生新研究；现有记录不会截断。');
  p.operations = [
    ...(p.operations ?? []).map((op) => (op.undone ? { ...op, redoable: false } : op)),
    { id: makeId(), label, at: timestamp(), before: left, after: right, undone: false },
  ];
  p.revision++;
  p.updatedAt = timestamp();
  if (p.activity[0]?.text !== label)
    p.activity.unshift({ id: makeId(), text: label, at: timestamp() });
  p.activity = p.activity.slice(0, 300);
  return p;
}
export function undoResearch(p: Exploration, operationId: string) {
  const n = structuredClone(p);
  const operation = n.operations?.find((o) => o.id === operationId);
  if (!operation || operation.undone) throw new Error('该操作不可撤销。');
  for (const key of ['findings', 'sources', 'questions', 'evidence'] as const) {
    const identity = (v: { id?: string; evidenceId?: string }) => v.id ?? v.evidenceId!;
    const before = operation.before[key];
    const after = operation.after[key];
    const ids = new Set([...before, ...after].map(identity));
    const current = n[key].filter((v) => ids.has(identity(v)));
    const comparable = (values: unknown[]) =>
      values.map((v) =>
        key === 'findings' && v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).filter(([field]) => field !== 'revision'))
          : v,
      );
    if (JSON.stringify(comparable(current)) !== JSON.stringify(comparable(after)))
      throw new Error('相关内容已有新编辑，不能用撤销覆盖；无关修改会保留。');
    const removed = new Set(
      after.filter((v) => !before.some((old) => identity(old) === identity(v))).map(identity),
    );
    if (
      (key === 'findings' &&
        n.findings.some((f) => f.parentId && removed.has(f.parentId) && !ids.has(f.id))) ||
      (key === 'sources' &&
        n.evidence.some(
          (e) =>
            e.sourceId &&
            removed.has(e.sourceId) &&
            !operation.after.evidence.some((v) => v.evidenceId === e.evidenceId),
        )) ||
      (key === 'evidence' &&
        n.findings.some(
          (f) =>
            f.evidenceIds.some((id) => removed.has(id)) &&
            !operation.after.findings.some((v) => v.id === f.id),
        ))
    )
      throw new Error('新内容依赖本次操作，不能撤销造成引用缺失。');
    const previous = new Map(
      before.map((v) => [
        identity(v),
        key === 'findings' && 'revision' in v
          ? {
              ...v,
              revision:
                Math.max(
                  v.revision as number,
                  ...current
                    .filter((item) => identity(item) === identity(v) && 'revision' in item)
                    .map((item) => (item as { revision: number }).revision),
                ) + 1,
            }
          : v,
      ]),
    );
    Object.assign(n, {
      [key]: n[key]
        .filter((v) => !removed.has(identity(v)))
        .map((v) => previous.get(identity(v)) ?? v),
    });
    for (const old of before)
      if (!n[key].some((v) => identity(v) === identity(old))) (n[key] as unknown[]).push(old);
  }
  if (operation.after.overview) {
    if (
      JSON.stringify([n.overview, n.overviewConfirmed]) !==
      JSON.stringify([operation.after.overview, operation.after.overviewConfirmed])
    )
      throw new Error('产品概览已有新修改，不能覆盖。');
    n.overview = operation.before.overview!;
    n.overviewConfirmed = operation.before.overviewConfirmed!;
    n.overviewRevision++;
  }
  if (operation.after.lab) {
    const current = n.lab ?? emptyLab();
    const before = operation.before.lab!;
    const after = operation.after.lab;
    const comparable = (row: { id: string }) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => !['revision', 'updatedAt'].includes(key)),
      );
    for (const key of labCollections) {
      const previous = before[key] as { id: string; revision: number }[];
      const expected = after[key] as { id: string; revision: number }[];
      const affected = new Set([...previous, ...expected].map((v) => v.id));
      const actual = (current[key] as { id: string; revision: number }[]).filter((v) =>
        affected.has(v.id),
      );
      const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      for (const wanted of expected) {
        const live = actual.find((a) => a.id === wanted.id),
          prior = previous.find((a) => a.id === wanted.id);
        if (!live) throw new Error('对象已删除，无法覆盖撤销。');
        const l = live as unknown as Record<string, unknown>,
          w = wanted as unknown as Record<string, unknown>,
          b = prior as unknown as Record<string, unknown> | undefined;
        const fields = b
          ? Object.keys(w).filter(
              (k) => !['revision', 'updatedAt'].includes(k) && !equal(b[k], w[k]),
            )
          : Object.keys(comparable(wanted));
        if (fields.some((k) => !equal(l[k], w[k])))
          throw new Error(`证据板${key}相关字段已有新修改，无法覆盖撤销；其他编辑保留。`);
      }
      const old = new Map(
        previous.map((v) => [
          v.id,
          {
            ...(actual.find((a) => a.id === v.id) ?? v),
            ...Object.fromEntries(
              Object.entries(v).filter(([k, value]) => {
                const w = expected.find((e) => e.id === v.id) as unknown as
                  Record<string, unknown> | undefined;
                return !w || !equal(value, w[k]);
              }),
            ),
            revision:
              Math.max(v.revision, ...actual.filter((a) => a.id === v.id).map((a) => a.revision)) +
              1,
          },
        ]),
      );
      const removed = new Set(expected.filter((v) => !old.has(v.id)).map((v) => v.id));
      const rows = (current[key] as { id: string; revision: number }[])
        .filter((v) => !removed.has(v.id))
        .map((v) => old.get(v.id) ?? v);
      for (const item of old.values()) if (!rows.some((v) => v.id === item.id)) rows.push(item);
      Object.assign(current, { [key]: rows });
    }
    for (const key of [
      'activeSolutionIds',
      'pinnedEvidenceIds',
      'embeddedEvidenceIds',
      'researchGuide',
    ] as const)
      if (after[key] && JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        if (JSON.stringify(current[key]) !== JSON.stringify(after[key]))
          throw new Error('方案或证据展开选择已有新变化。');
        Object.assign(current, { [key]: before[key] });
      }
    const nodeIds = new Set(current.nodes.map((v) => v.id));
    if (current.edges.some((e) => !nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId)))
      throw new Error('后续关系依赖此节点，无法撤销产生悬空关系。');
    n.lab = current;
  }
  operation.undone = true;
  operation.undoneAt = timestamp();
  operation.redoable = true;
  n.revision++;
  n.updatedAt = timestamp();
  n.activity.unshift({ id: makeId(), text: `撤销：${operation.label}`, at: timestamp() });
  n.activity = n.activity.slice(0, 300);
  for (const e of n.evidence)
    e.relatedFindingIds = n.findings
      .filter((f) => f.evidenceIds.includes(e.evidenceId))
      .map((f) => f.id);
  return n;
}
export function redoResearch(p: Exploration, operationId: string) {
  const n = structuredClone(p);
  const op = n.operations?.find((v) => v.id === operationId);
  if (!op?.undone || op.redoable === false)
    throw new Error('此操作不可重做，可能已有新的操作分支。');
  const before = op.before,
    after = op.after;
  op.before = after;
  op.after = before;
  op.undone = false;
  const result = undoResearch(n, operationId);
  const applied = result.operations!.find((v) => v.id === operationId)!;
  applied.before = before;
  applied.after = after;
  applied.undone = false;
  applied.undoneAt = undefined;
  result.activity[0].text = `重做：${applied.label}`;
  return result;
}
