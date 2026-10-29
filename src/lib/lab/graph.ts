import {
  emptyLab,
  labSchema,
  graphNodeSchema,
  graphEdgeSchema,
  type GraphNode,
  type GraphEdge,
  type LabState,
} from './model';
import { evidenceValid } from '../exploration/domain';
import { timestamp, type Exploration } from '../exploration/model';
import { reconcileDecisions, resolveDecision } from '../decisions/records';
export const sourceNodeId = (id: string) => `source:${id}`;
export const evidenceNodeId = (id: string) => `evidence:${id}`;
export const findingNodeId = (id: string) => `finding:${id}`;
export const questionNodeId = (id: string) => `question:${id}`;
/** 轻量变更指纹，仅用于本机版本比较与去重，不是安全哈希或内容真实性证明。 */
export function digest(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}-${(hash >>> 0).toString(16)}`;
}
export function relationKey(from: string, to: string, type: GraphEdge['relationType']) {
  return `edge:${digest(type === 'conflicts_with' ? [type, ...[from, to].sort()] : [type, from, to])}`;
}
export function evidenceFingerprint(p: Exploration, ids: string[]) {
  return digest(
    ids.map((id) => {
      const e = p.evidence.find((v) => v.evidenceId === id);
      return e
        ? [
            id,
            e.sourceRevision,
            e.excerpt,
            e.location,
            p.sources.find((s) => s.id === e.sourceId)?.versions.at(-1)?.revision,
          ]
        : [id, 'missing'];
    }),
  );
}
/** 在锚点附近寻找空位，只返回新坐标，不移动已有节点。 */
export function nearbyPosition(nodes: GraphNode[], desired: { x: number; y: number }) {
  for (let ring = 0; ring < 50; ring++) {
    const offsets: { x: number; y: number }[] = [];
    for (let x = -ring; x <= ring; x++)
      for (let y = -ring; y <= ring; y++)
        if (Math.max(Math.abs(x), Math.abs(y)) === ring) offsets.push({ x, y });
    offsets.sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || a.y - b.y || a.x - b.x);
    for (const offset of offsets) {
      const position = {
        x: Math.max(0, desired.x + offset.x * 340),
        y: Math.max(0, desired.y + offset.y * 390),
      };
      if (Math.abs(position.x) > 50000 || Math.abs(position.y) > 50000) continue;
      if (
        !nodes.some(
          (n) =>
            Math.abs(n.layoutPosition.x - position.x) < 325 &&
            Math.abs(n.layoutPosition.y - position.y) < 380,
        )
      )
        return position;
    }
  }
  throw new Error('局部空间已满，请手动整理或派生新的研究。');
}
/** 强度取决于可定位证据与程序/人工核对，模型自报置信度不参与升级。 */
export function edgeStrength(
  p: Exploration,
  edge: Pick<
    GraphEdge,
    'relationType' | 'evidenceRefs' | 'leftEvidenceIds' | 'rightEvidenceIds' | 'generatedBy'
  >,
  humanVerified = false,
): GraphEdge['strengthClass'] {
  if (edge.relationType === 'conflicts_with') return 'conflict';
  if (
    [
      'inferred_from',
      'implies',
      'weakly_related',
      'related_to',
      'maps_to',
      'contains',
      'depends_on',
      'addresses',
    ].includes(edge.relationType)
  )
    return 'weak';
  if (
    !edge.evidenceRefs.length ||
    edge.evidenceRefs.some(
      (id) => !p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e)),
    )
  )
    return 'weak';
  return (edge.relationType === 'derived_from' && edge.generatedBy === 'program') || humanVerified
    ? 'strong'
    : 'weak';
}
export function validateEdge(p: Exploration, lab: LabState, edge: GraphEdge) {
  graphEdgeSchema.parse(edge);
  if (
    edge.projectId !== p.id ||
    edge.sourceNodeId === edge.targetNodeId ||
    ![edge.sourceNodeId, edge.targetNodeId].every((id) => lab.nodes.some((n) => n.id === id))
  )
    throw new Error('关系的节点不存在或不属于本研究。');
  if (
    edge.evidenceRefs.some(
      (id) =>
        !p.evidence.some(
          (e) =>
            e.evidenceId === id &&
            e.sourceId &&
            p.sources.some(
              (s) => s.id === e.sourceId && s.versions.some((v) => v.revision === e.sourceRevision),
            ),
        ),
    )
  )
    throw new Error('关系引用不存在的证据或来源版本。');
  if (edge.relationType === 'conflicts_with') {
    if (edge.status === 'verified' && !edge.verifiedByUser)
      throw new Error('冲突须经人核对双方依据。');
    if (!edge.leftEvidenceIds.length || !edge.rightEvidenceIds.length || !edge.rationale.trim())
      throw new Error('冲突须分别关联双方依据并说明同一事项、范围或时间上的不一致。');
    if (
      [...edge.leftEvidenceIds, ...edge.rightEvidenceIds].some(
        (id) => !edge.evidenceRefs.includes(id),
      )
    )
      throw new Error('冲突双方依据未包含在关系引用中。');
    if (edge.leftEvidenceIds.every((id) => edge.rightEvidenceIds.includes(id)))
      throw new Error('冲突不能只有同一份依据。');
  }
  if (
    edge.strengthClass === 'strong' &&
    edge.status !== 'deleted' &&
    edgeStrength(p, edge, edge.verifiedByUser && ['verified', 'restored'].includes(edge.status)) !==
      'strong'
  )
    throw new Error('强关联必须有已定位直接依据，不能仅依赖模型判断。');
}
/**
 * 在研究副本上同步业务对象与图谱投影；复用稳定节点 ID 和已有坐标。
 * 同步会标记失效依赖，不能用作纯视图筛选，也不能把候选变成人工确认事实。
 */
export function synchronizeLab(project: Exploration): Exploration {
  const p = structuredClone(project);
  p.questions = reconcileDecisions(p.questions, p.id);
  const lab = p.lab ?? emptyLab();
  const oldNodes = new Map(lab.nodes.map((n) => [n.id, n]));
  lab.activeSolutionIds = lab.activeSolutionIds.filter((id) =>
    lab.solutions.some((s) => s.id === id && s.status !== 'excluded'),
  );
  const nodes: GraphNode[] = [];
  const now = timestamp();
  for (const item of [...lab.solutions, ...lab.requirements]) {
    const related = 'relatedFeatureIds' in item ? item.relatedFeatureIds : [];
    for (const id of related) {
      const f = p.findings.find((f) => f.id === id);
      if (!f) continue;
      if (item.inputVersions[id] === undefined) item.inputVersions[id] = f.revision;
      else if (
        item.inputVersions[id] !== f.revision &&
        item.status !== 'excluded' &&
        item.status !== 'review'
      ) {
        item.status = 'review';
        item.revision++;
        item.updatedAt = now;
      }
    }
  }
  const uses = new Map<string, number>();
  for (const item of [...p.findings, ...p.questions, ...lab.requirements])
    for (const id of item.evidenceIds) uses.set(id, (uses.get(id) ?? 0) + 1);
  function put(
    raw: Omit<
      GraphNode,
      'createdAt' | 'updatedAt' | 'revision' | 'layoutPosition' | 'collapsed' | 'userPositioned'
    >,
    column: number,
    near?: string,
  ) {
    const old = oldNodes.get(raw.id);
    const anchor = nodes.find((n) => n.id === near) ?? lab.nodes.find((n) => n.id === near);
    const visible = (n: GraphNode) => n.type !== 'evidence' || n.content.independent;
    const hidden =
      raw.type === 'evidence' && !('independent' in raw.content && raw.content.independent);
    const desired = {
      x: anchor ? anchor.layoutPosition.x + 340 : column,
      y:
        anchor?.layoutPosition.y ??
        nodes.filter((n) => n.type === raw.type && visible(n)).length * 390,
    };
    const contentSame =
      old &&
      digest({
        ...old,
        createdAt: '',
        updatedAt: '',
        revision: 0,
        layoutPosition: { x: 0, y: 0 },
        collapsed: false,
        userPositioned: false,
      }) ===
        digest({
          ...raw,
          createdAt: '',
          updatedAt: '',
          revision: 0,
          layoutPosition: { x: 0, y: 0 },
          collapsed: false,
          userPositioned: false,
        });
    const node = graphNodeSchema.parse({
      ...raw,
      createdAt: old?.createdAt ?? now,
      updatedAt: contentSame ? old!.updatedAt : now,
      revision: old ? old.revision + (contentSame ? 0 : 1) : 1,
      layoutPosition:
        old &&
        !(old.type === 'evidence' && !old.content.independent && !hidden && !old.userPositioned)
          ? old.layoutPosition
          : hidden
            ? { x: anchor?.layoutPosition.x ?? column, y: anchor?.layoutPosition.y ?? 0 }
            : nearbyPosition(
                [...nodes, ...lab.nodes.filter((n) => n.id !== raw.id)].filter(visible),
                desired,
              ),
      collapsed: old?.collapsed ?? true,
      userPositioned: old?.userPositioned ?? false,
    });
    nodes.push(node);
  }
  for (const source of p.sources) {
    const v = source.versions.at(-1)!;
    put(
      {
        id: sourceNodeId(source.id),
        projectId: p.id,
        type: 'source',
        title: source.title,
        summary: (v.text || source.referencePurpose || source.error || '原始材料，等待标注').slice(
          0,
          800,
        ),
        sourceIds: [source.id],
        evidenceIds: p.evidence
          .filter((e) => e.sourceId === source.id && e.sourceRevision === v.revision)
          .map((e) => e.evidenceId),
        originType: source.kind === 'text' ? 'user_provided' : 'source_fact',
        status:
          source.removed || source.purpose === 'excluded'
            ? 'excluded'
            : source.status === 'error'
              ? 'failed'
              : source.status === 'idle'
                ? 'partial'
                : source.status,
        acceptedByUser: false,
        content: {
          sourceId: source.id,
          sourceType: source.kind,
          sourceRevision: v.revision,
          parseStatus: source.status,
          preview: v.text.slice(0, 1500),
          limitations: source.error,
        },
      },
      0,
    );
  }
  for (const e of p.evidence) {
    if (
      !e.sourceId ||
      !e.sourceRevision ||
      !p.sources.some(
        (s) => s.id === e.sourceId && s.versions.some((v) => v.revision === e.sourceRevision),
      )
    )
      continue;
    const current = evidenceValid(p, e);
    put(
      {
        id: evidenceNodeId(e.evidenceId),
        projectId: p.id,
        type: 'evidence',
        title: e.title || '证据片段',
        summary: e.excerpt.slice(0, 800),
        sourceIds: [e.sourceId],
        evidenceIds: [e.evidenceId],
        originType:
          e.evidenceType === 'ai-inference'
            ? 'ai_inference'
            : e.evidenceType === 'user-description'
              ? 'user_provided'
              : 'source_fact',
        status:
          p.sources.find((s) => s.id === e.sourceId)?.versions.at(-1)?.revision !== e.sourceRevision
            ? 'stale'
            : lab.annotations.some((a) => a.evidenceId === e.evidenceId && a.status === 'deleted')
              ? 'excluded'
              : current
                ? 'verified'
                : e.verificationStatus === 'needs-review'
                  ? 'pending'
                  : 'stale',
        acceptedByUser: current,
        content: {
          evidenceId: e.evidenceId,
          sourceId: e.sourceId,
          sourceRevision: e.sourceRevision,
          locatorKind: e.location.kind,
          excerpt: e.excerpt,
          independent:
            ((uses.get(e.evidenceId) ?? 0) > 1 &&
              !lab.embeddedEvidenceIds.includes(e.evidenceId)) ||
            lab.pinnedEvidenceIds.includes(e.evidenceId),
        },
      },
      370,
      sourceNodeId(e.sourceId),
    );
  }
  for (const f of p.findings) {
    const refs = p.evidence.filter((e) => f.evidenceIds.includes(e.evidenceId));
    const inferred = f.basis === 'inferred';
    const invalid = refs.some((e) => !evidenceValid(p, e));
    put(
      {
        id: findingNodeId(f.id),
        projectId: p.id,
        type: inferred ? 'inference' : 'feature',
        title: f.title,
        summary: f.description.slice(0, 800),
        sourceIds: [...new Set(refs.flatMap((e) => (e.sourceId ? [e.sourceId] : [])))],
        evidenceIds: f.evidenceIds,
        originType: inferred
          ? 'ai_inference'
          : f.basis === 'observed'
            ? 'source_fact'
            : f.status === 'confirmed'
              ? 'user_confirmed'
              : 'user_provided',
        status: invalid && f.status !== 'excluded' ? 'review' : f.status,
        acceptedByUser: f.status === 'confirmed',
        content: {
          findingId: f.id,
          basis: f.basis,
          description: f.description,
          rationale: f.rationale ?? '',
          uncertainty: f.uncertainty ?? (inferred ? '待核实' : '未提供的事实仍待确认'),
          findingKind: f.kind,
        },
      },
      inferred ? 1120 : 750,
      refs[0]?.sourceId ? sourceNodeId(refs[0].sourceId) : undefined,
    );
  }
  for (const reference of p.questions) {
    const q = resolveDecision(p.questions, reference.id)!;
    put(
      {
        id: questionNodeId(reference.id),
        projectId: p.id,
        type: 'question',
        title: q.title.slice(0, 200),
        summary: q.detail.slice(0, 800),
        sourceIds: [
          ...new Set(
            p.evidence
              .filter((e) => q.evidenceIds.includes(e.evidenceId))
              .flatMap((e) => (e.sourceId ? [e.sourceId] : [])),
          ),
        ],
        evidenceIds: q.evidenceIds,
        originType: 'ai_inference',
        status: q.decision?.answerNeedsReview ? 'review' : q.status,
        acceptedByUser: q.status === 'answered' && !q.decision?.answerNeedsReview,
        content: { questionId: q.id, detail: q.detail, answer: q.answer },
      },
      1120,
      q.findingIds[0] ? findingNodeId(q.findingIds[0]) : undefined,
    );
  }
  for (const solution of lab.solutions)
    for (const role of solution.roles) {
      put(
        {
          id: `role:${solution.id}:${role.key}`,
          projectId: p.id,
          type: 'role',
          title: role.title,
          summary: solution.description.slice(0, 800),
          sourceIds: [
            ...new Set(
              p.evidence
                .filter((e) => solution.relatedEvidenceIds.includes(e.evidenceId))
                .flatMap((e) => (e.sourceId ? [e.sourceId] : [])),
            ),
          ],
          evidenceIds: solution.relatedEvidenceIds,
          originType: 'ai_inference',
          status: solution.status,
          acceptedByUser: solution.status === 'confirmed',
          content: {
            solutionId: solution.id,
            roleKey: role.key,
            description: solution.description,
            rationale: role.rationale,
            assumptions: solution.assumptions,
          },
        },
        1510,
        solution.relatedFeatureIds[0] ? findingNodeId(solution.relatedFeatureIds[0]) : undefined,
      );
    }
  for (const r of lab.requirements) {
    put(
      {
        id: `requirement:${r.id}`,
        projectId: p.id,
        type: 'requirement',
        title: r.title,
        summary: r.description.slice(0, 800),
        sourceIds: [
          ...new Set(
            p.evidence
              .filter((e) => r.evidenceIds.includes(e.evidenceId))
              .flatMap((e) => (e.sourceId ? [e.sourceId] : [])),
          ),
        ],
        evidenceIds: r.evidenceIds,
        originType: 'ai_inference',
        status:
          r.evidenceIds.some(
            (id) => !p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e)),
          ) && r.status !== 'excluded'
            ? 'review'
            : r.status,
        acceptedByUser: r.status === 'confirmed',
        content: {
          requirementId: r.id,
          solutionId: r.solutionId,
          requirementType: r.requirementType,
          description: r.description,
          locked: r.locked,
        },
      },
      1870,
      r.relatedFeatureIds[0] ? findingNodeId(r.relatedFeatureIds[0]) : undefined,
    );
  }
  lab.nodes = nodes;
  const existing = new Map(
    lab.edges
      .filter(
        (e) =>
          nodes.some((n) => n.id === e.sourceNodeId) && nodes.some((n) => n.id === e.targetNodeId),
      )
      .map((e) => [e.id, e]),
  );
  function relation(
    from: string,
    to: string,
    type: GraphEdge['relationType'],
    refs: string[],
    rationale: string,
    by: GraphEdge['generatedBy'] = 'program',
  ) {
    if (from === to || ![from, to].every((id) => nodes.some((n) => n.id === id))) return;
    const id = relationKey(from, to, type);
    const old = existing.get(id);
    const fingerprint = evidenceFingerprint(p, refs);
    if (old) {
      if (old.status === 'deleted' && old.inputFingerprint !== fingerprint)
        old.reconsiderationAvailable = true;
      else if (old.inputFingerprint !== fingerprint) {
        old.status = 'review';
        old.strengthClass = 'weak';
        old.revision++;
        old.updatedAt = now;
      }
      if (
        old.status !== 'deleted' &&
        old.evidenceRefs.some(
          (id) => !p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e)),
        )
      ) {
        old.strengthClass = 'weak';
        old.status = 'review';
      }
      return;
    }
    const edge: GraphEdge = {
      id,
      projectId: p.id,
      sourceNodeId: from,
      targetNodeId: to,
      relationType: type,
      strengthClass: 'weak',
      status: by === 'program' && type === 'derived_from' ? 'verified' : 'pending',
      evidenceRefs: refs,
      generatedBy: by,
      rationale,
      uncertainty:
        by === 'program' && type === 'derived_from' ? '' : '候选关系，尚待核对；不代表已确认结论。',
      leftEvidenceIds: [],
      rightEvidenceIds: [],
      inputFingerprint: fingerprint,
      reconsiderationAvailable: false,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      verifiedByUser: false,
    };
    edge.strengthClass = edgeStrength(p, edge);
    existing.set(id, edge);
  }
  for (const e of p.evidence)
    if (e.sourceId)
      relation(
        evidenceNodeId(e.evidenceId),
        sourceNodeId(e.sourceId),
        'derived_from',
        [e.evidenceId],
        '证据保留实际来源与修订版本。',
      );
  for (const f of p.findings) {
    for (const id of f.evidenceIds)
      relation(
        evidenceNodeId(id),
        findingNodeId(f.id),
        f.basis === 'inferred' ? 'inferred_from' : 'supports',
        [id],
        f.rationale || '原文与候选结论的对应关系，需核对其适用范围。',
        f.origin === 'ai' ? 'ai' : 'user',
      );
    if (f.parentId)
      relation(
        findingNodeId(f.parentId),
        findingNodeId(f.id),
        'contains',
        f.evidenceIds,
        '实际父子归属关系。',
      );
  }
  for (const q of p.questions) {
    for (const id of q.findingIds)
      relation(
        questionNodeId(q.id),
        findingNodeId(id),
        'related_to',
        q.evidenceIds,
        '这个问题关联到该功能；回答不会自动确认功能。',
      );
    for (const id of q.evidenceIds)
      relation(evidenceNodeId(id), questionNodeId(q.id), 'supports', [id], '问题的资料依据。');
  }
  for (const r of lab.requirements) {
    for (const f of [...r.relatedFeatureIds, ...r.inferenceIds])
      relation(
        findingNodeId(f),
        `requirement:${r.id}`,
        'maps_to',
        r.evidenceIds,
        r.rationale,
        'ai',
      );
    relation(
      `role:${r.solutionId}:${r.roleKey}`,
      `requirement:${r.id}`,
      'contains',
      [],
      '要求属于此候选方案中的角色。',
    );
  }
  lab.edges = [...existing.values()];
  for (const annotation of lab.annotations) {
    const source = p.sources.find((s) => s.id === annotation.sourceId);
    if (
      source?.versions.at(-1)?.revision !== annotation.sourceRevision &&
      annotation.status !== 'deleted'
    )
      annotation.status = 'stale';
  }
  lab.ui.selectedNodeId =
    lab.ui.selectedNodeId && nodes.some((n) => n.id === lab.ui.selectedNodeId)
      ? lab.ui.selectedNodeId
      : null;
  p.lab = labSchema.parse(lab);
  return p;
}
/** 折叠证据只映射显示端点，不删除底层节点、证据或关系。 */
export function visibleGraph(lab: LabState) {
  const visible = lab.nodes.filter((n) => n.type !== 'evidence' || n.content.independent);
  const ids = new Set(visible.map((n) => n.id));
  const endpoint = (id: string) => {
    const n = lab.nodes.find((v) => v.id === id);
    return n?.type === 'evidence' && !n.content.independent ? sourceNodeId(n.content.sourceId) : id;
  };
  return {
    nodes: visible,
    edges: lab.edges
      .filter((e) => e.status !== 'deleted')
      .map((e) => ({
        ...e,
        displaySource: endpoint(e.sourceNodeId),
        displayTarget: endpoint(e.targetNodeId),
      }))
      .filter(
        (e) =>
          e.displaySource !== e.displayTarget &&
          ids.has(e.displaySource) &&
          ids.has(e.displayTarget),
      ),
  };
}
export function evidenceChain(lab: LabState, nodeId: string) {
  const found = new Set([nodeId]);
  const active = lab.edges.filter((e) => !['deleted', 'stale'].includes(e.status));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of active) {
      if (found.has(edge.targetNodeId) && !found.has(edge.sourceNodeId)) {
        found.add(edge.sourceNodeId);
        changed = true;
      }
      if (
        found.has(edge.sourceNodeId) &&
        ['derived_from', 'related_to', 'conflicts_with', 'addresses'].includes(edge.relationType) &&
        !found.has(edge.targetNodeId)
      ) {
        found.add(edge.targetNodeId);
        changed = true;
      }
    }
  }
  for (const n of lab.nodes.filter((n) => found.has(n.id)))
    for (const id of n.sourceIds) found.add(sourceNodeId(id));
  return found;
}
export function assertLab(p: Exploration) {
  if (!p.lab) return;
  labSchema.parse(p.lab);
  const ids = new Set(p.lab.nodes.map((n) => n.id));
  if (ids.size !== p.lab.nodes.length) throw new Error('证据板节点ID重复。');
  for (const collection of [p.lab.edges, p.lab.annotations, p.lab.solutions, p.lab.requirements])
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw new Error('证据板对象ID重复。');
  for (const e of p.evidence)
    if (
      e.sourceId &&
      !p.sources.some(
        (s) => s.id === e.sourceId && s.versions.some((v) => v.revision === e.sourceRevision),
      )
    )
      throw new Error('证据引用不存在的来源版本。');
  for (const r of p.lab.requirements) {
    const s = p.lab.solutions.find((s) => s.id === r.solutionId);
    if (
      r.projectId !== p.id ||
      !s ||
      !s.roles.some((role) => role.key === r.roleKey) ||
      [...r.relatedFeatureIds, ...r.inferenceIds].some(
        (id) => !p.findings.some((f) => f.id === id),
      ) ||
      r.evidenceIds.some((id) => !p.evidence.some((e) => e.evidenceId === id))
    )
      throw new Error('岗位要求引用无效。');
  }
  for (const edge of p.lab.edges) validateEdge(p, p.lab, edge);
  for (const n of p.lab.nodes) {
    if (n.projectId !== p.id) throw new Error('节点不属于本研究。');
    if (
      n.sourceIds.some((id) => !p.sources.some((s) => s.id === id)) ||
      n.evidenceIds.some((id) => !p.evidence.some((e) => e.evidenceId === id))
    )
      throw new Error('节点来源或证据引用失效。');
    if (
      n.type === 'source' &&
      !p.sources.some(
        (s) =>
          s.id === n.content.sourceId &&
          n.sourceIds.includes(s.id) &&
          s.versions.some((v) => v.revision === n.content.sourceRevision),
      )
    )
      throw new Error('资料节点的具体来源版本不存在。');
    if (
      n.type === 'evidence' &&
      !p.evidence.some(
        (e) =>
          e.evidenceId === n.content.evidenceId &&
          e.sourceId === n.content.sourceId &&
          e.sourceRevision === n.content.sourceRevision &&
          e.excerpt === n.content.excerpt,
      )
    )
      throw new Error('证据节点与实际证据不一致。');
    if (
      (n.type === 'feature' || n.type === 'inference') &&
      !p.findings.some((f) => f.id === n.content.findingId)
    )
      throw new Error('功能节点引用不存在的结论。');
    if (n.type === 'question' && !p.questions.some((q) => q.id === n.content.questionId))
      throw new Error('问题节点引用不存在的问题。');
    if (
      n.type === 'role' &&
      !p.lab.solutions.some(
        (s) => s.id === n.content.solutionId && s.roles.some((r) => r.key === n.content.roleKey),
      )
    )
      throw new Error('岗位节点引用不存在的方案或角色。');
    if (
      n.type === 'requirement' &&
      !p.lab.requirements.some(
        (r) => r.id === n.content.requirementId && r.solutionId === n.content.solutionId,
      )
    )
      throw new Error('要求节点引用不存在的要求或方案。');
  }
  for (const s of p.lab.solutions)
    if (
      s.projectId !== p.id ||
      s.relatedFeatureIds.some((id) => !p.findings.some((f) => f.id === id)) ||
      s.relatedEvidenceIds.some((id) => !p.evidence.some((e) => e.evidenceId === id)) ||
      (s.productPlan &&
        [...s.productPlan.priorityFeatureIds, ...s.productPlan.deferredFeatureIds].some(
          (id) => !p.findings.some((f) => f.id === id),
        ))
    )
      throw new Error('岗位方案来源引用无效。');
  for (const r of p.lab.visualResults)
    if (
      !p.sources.some(
        (s) => s.id === r.sourceId && s.versions.some((v) => v.revision === r.sourceRevision),
      )
    )
      throw new Error('视觉结果来源版本不存在。');
  for (const a of p.lab.annotations) {
    if (
      a.projectId !== p.id ||
      !p.evidence.some(
        (e) =>
          e.evidenceId === a.evidenceId &&
          e.sourceId === a.sourceId &&
          e.sourceRevision === a.sourceRevision,
      )
    )
      throw new Error('标注证据与来源版本不一致。');
    if (
      !p.sources.some(
        (s) => s.id === a.sourceId && s.versions.some((v) => v.revision === a.sourceRevision),
      )
    )
      throw new Error('标注引用不存在的来源版本。');
  }
}
export function rebindLabProject(lab: LabState, projectId: string) {
  for (const key of ['nodes', 'edges', 'annotations', 'solutions', 'requirements', 'runs'] as const)
    for (const item of lab[key]) item.projectId = projectId;
  return lab;
}
