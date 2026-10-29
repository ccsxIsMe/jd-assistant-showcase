import {
  synchronizeLab,
  relationKey,
  evidenceFingerprint,
  edgeStrength,
  validateEdge,
  assertLab,
  nearbyPosition,
  visibleGraph,
} from './graph';
import {
  annotationSchema,
  positionSchema,
  type Annotation,
  type GraphEdge,
  type RoleRequirement,
} from './model';
import { makeId, timestamp, type Exploration, type Rectangle } from '../exploration/model';
import {
  changeFinding,
  evidenceValid,
  removeSource,
  createSource,
  paragraphs,
  textEvidence,
  sourceChanged,
  touchExploration,
} from '../exploration/domain';
import { recordResearchChange } from '../exploration/journal';
import { sourceSetSignature, evidenceReviewSignature, researchProgress } from './guided';
import { decisionResponseSchema, type DecisionResponse } from '../decisions/schema';
import {
  decisionFingerprint,
  initializeDecision,
  replaceDecisionQuestion,
  stampDecisionResponse,
  type DecisionQuestion,
} from '../decisions/quality';
import { researchDecisionContext, contextFingerprint } from '../decisions/context';
import { conflictSignature, criticalPlanningItems, packageSignature } from './planning';
import { readPlanningConstraints } from './planning';
import { resolveDecision } from '../decisions/records';
function operation(p: Exploration, label: string, edit: (next: Exploration) => void) {
  const n = synchronizeLab(p);
  edit(n);
  const next = synchronizeLab(n);
  assertLab(next);
  return recordResearchChange(p, touchExploration(next, label), label);
}
export function markResearchCheckpoint(p: Exploration, stage: 'materials' | 'evidence') {
  return operation(
    p,
    stage === 'materials' ? '确认当前资料集合' : '确认已查看核心证据并保留未决项',
    (n) => {
      const progress = researchProgress(n);
      if (stage === 'materials') {
        if (!progress.validSources.length) throw new Error('先添加一份有效资料或产品构想。');
        n.lab!.researchGuide.sourceSignature = sourceSetSignature(n);
        n.lab!.researchGuide.sourceConfirmedAt = timestamp();
      } else {
        if (!progress.evidence.length && !n.lab!.annotations.length)
          throw new Error('尚无可核对证据，请先补充正文或标注。');
        n.lab!.researchGuide.evidenceSignature = evidenceReviewSignature(n);
        n.lab!.researchGuide.evidenceReviewedAt = timestamp();
      }
    },
  );
}
export function chooseImportRequirements(p: Exploration, ids: string[]) {
  return operation(p, '选择准备导入岗位的逐条要求', (n) => {
    const allowed = new Set(researchProgress(n).requirements.map((r) => r.id));
    if (ids.some((id) => !allowed.has(id)))
      throw new Error('只能选择已确认方案中的已确认要求，编辑后需重新确认。');
    n.lab!.researchGuide.importRequirementIds = [...new Set(ids)];
  });
}
export function editResearchGoal(p: Exploration, goal: string) {
  return operation(p, '人工调整产品目标', (n) => {
    if (!goal.trim() || goal.length > 3000) throw new Error('产品目标需为1至3000字。');
    n.overview.goal = goal.trim();
    n.overviewMode = 'manual';
    n.overviewConfirmed = false;
    n.overviewRevision++;
    for (const item of [...n.lab!.solutions, ...n.lab!.requirements])
      if (item.status !== 'excluded') {
        item.status = 'review';
        item.revision++;
        item.updatedAt = timestamp();
      }
  });
}
export function questionEvidence(p: Exploration, id: string, text: string) {
  return operation(p, '针对证据记录待核实问题', (n) => {
    const e = n.evidence.find((e) => e.evidenceId === id);
    if (!e || !text.trim() || text.length > 300)
      throw new Error('请选择证据并填写1至300字的问题。');
    if (n.questions.length >= 100) throw new Error('问题数量达到上限。');
    n.questions.push({
      id: makeId(),
      title: text.trim(),
      detail: '用户对这项具体证据提出疑问，未自动改变其他结论。',
      evidenceIds: [id],
      findingIds: n.findings.filter((f) => f.evidenceIds.includes(id)).map((f) => f.id),
      status: 'open',
      answer: '',
    });
  });
}
export function mergeFeatureCandidates(p: Exploration, targetId: string, sourceId: string) {
  return operation(p, '人工合并重复功能并保留两项原始来源', (n) => {
    const target = n.findings.find((f) => f.id === targetId && f.kind === 'feature'),
      source = n.findings.find((f) => f.id === sourceId && f.kind === 'feature');
    if (
      !target ||
      !source ||
      target.id === source.id ||
      [target, source].some((f) => f.locked || f.status === 'excluded')
    )
      throw new Error('请选择两项未锁定、未排除的不同功能。');
    if (target.description.length + source.description.length > 3900)
      throw new Error('合并文字过长，请先精简描述。');
    target.description = `${target.description}\n合并自「${source.title}」：${source.description}`;
    target.evidenceIds = [...new Set([...target.evidenceIds, ...source.evidenceIds])];
    if (target.basis !== source.basis) target.basis = 'inferred';
    target.status = 'review';
    target.revision++;
    source.status = 'excluded';
    source.revision++;
    for (const q of n.questions)
      if (q.findingIds.includes(source.id))
        q.findingIds = [...new Set([...q.findingIds, target.id])];
    for (const r of n.lab!.requirements)
      if (r.relatedFeatureIds.includes(source.id) || r.inferenceIds.includes(source.id)) {
        r.status = r.status === 'excluded' ? 'excluded' : 'review';
        r.revision++;
      }
  });
}
export function moveNode(p: Exploration, id: string, position: { x: number; y: number }) {
  // Canvas coordinates are independent of the guided research presentation.
  const current = p.lab?.nodes.find((n) => n.id === id);
  if (
    current?.userPositioned &&
    current.layoutPosition.x === position.x &&
    current.layoutPosition.y === position.y
  )
    return p;
  return operation(p, '移动证据板节点', (n) => {
    const node = n.lab!.nodes.find((v) => v.id === id);
    if (!node) throw new Error('节点不存在。');
    node.layoutPosition = positionSchema.parse(position);
    node.userPositioned = true;
    node.revision++;
    node.updatedAt = timestamp();
  });
}
export function saveProductIdea(p: Exploration, text: string, expectedRevision?: number) {
  return operation(p, '保存产品构想与来源版本', (n) => {
    const clean = text.trim();
    if (!clean || clean.length > 3000) throw new Error('请填写1至3000字的产品构想。');
    const original = n.sources.find(
      (s) => !s.removed && s.kind === 'text' && s.versions[0].text === n.initialObjective,
    );
    if (original) {
      const v = original.versions.at(-1)!;
      if (expectedRevision !== undefined && v.revision !== expectedRevision)
        throw new Error('构想来源已有新版本，请先核对，当前文字未覆盖。');
      Object.assign(
        n,
        sourceChanged(n, original, {
          revision: v.revision + 1,
          text: clean,
          paragraphs: paragraphs(clean),
          createdAt: timestamp(),
          userEdited: true,
        }),
      );
    } else {
      if (n.sources.length >= 40) throw new Error('资料达到上限。');
      const s = createSource('text', '产品构想');
      s.status = 'ready';
      s.versions[0].text = clean;
      s.versions[0].paragraphs = paragraphs(clean);
      n.sources.push(s);
      n.evidence.push(...textEvidence(s, s.versions[0]));
      if (!n.initialObjective) n.initialObjective = clean;
    }
  });
}
export function collapseNode(p: Exploration, id: string) {
  return operation(p, '展开或折叠证据板节点', (n) => {
    const node = n.lab!.nodes.find((v) => v.id === id);
    if (!node) throw new Error('节点不存在。');
    node.collapsed = !node.collapsed;
    if (!node.collapsed) {
      for (const other of n.lab!.nodes) {
        if (
          other.id === node.id ||
          other.userPositioned ||
          (other.type === 'evidence' && !other.content.independent)
        )
          continue;
        const delta = other.layoutPosition.y - node.layoutPosition.y;
        if (
          Math.abs(other.layoutPosition.x - node.layoutPosition.x) < 325 &&
          delta > 0 &&
          delta < 540
        ) {
          other.layoutPosition = nearbyPosition(
            n.lab!.nodes.filter((v) => v.id !== other.id),
            { x: other.layoutPosition.x, y: node.layoutPosition.y + 560 },
          );
          other.revision++;
          other.updatedAt = timestamp();
        }
      }
    }
    node.revision++;
    node.updatedAt = timestamp();
  });
}
export function pinEvidence(p: Exploration, id: string, independent = true) {
  return operation(p, independent ? '独立展开证据' : '收回资料内证据', (n) => {
    if (!n.evidence.some((e) => e.evidenceId === id)) throw new Error('证据不存在。');
    n.lab!.pinnedEvidenceIds = independent
      ? [...new Set([...n.lab!.pinnedEvidenceIds, id])]
      : n.lab!.pinnedEvidenceIds.filter((v) => v !== id);
    n.lab!.embeddedEvidenceIds = independent
      ? n.lab!.embeddedEvidenceIds.filter((v) => v !== id)
      : [...new Set([...n.lab!.embeddedEvidenceIds, id])];
  });
}
export function localLayout(p: Exploration, ids: string[]) {
  return operation(p, '局部整理选中线索布局', (n) => {
    const chosen = n.lab!.nodes.filter((v) => ids.includes(v.id) && !v.userPositioned);
    const placed = n.lab!.nodes.filter((v) => !chosen.some((c) => c.id === v.id));
    for (const node of chosen) {
      node.layoutPosition = nearbyPosition(placed, { x: node.layoutPosition.x, y: 0 });
      node.revision++;
      node.updatedAt = timestamp();
      placed.push(node);
    }
  });
}
export function compactBoard(p: Exploration) {
  return operation(p, '紧凑整理论据板（保留手动位置）', (n) => {
    const graph = visibleGraph(n.lab!);
    const pending = new Map(
      graph.nodes.filter((node) => !node.userPositioned).map((node) => [node.id, node]),
    );
    const placed = graph.nodes.filter((node) => node.userPositioned);
    const neighbors = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
    for (const edge of graph.edges) {
      neighbors.get(edge.displaySource)?.add(edge.displayTarget);
      neighbors.get(edge.displayTarget)?.add(edge.displaySource);
    }
    while (pending.size) {
      const next = [...pending.values()].sort(
        (a, b) => (neighbors.get(b.id)?.size ?? 0) - (neighbors.get(a.id)?.size ?? 0),
      )[0];
      const queue = [next.id];
      while (queue.length) {
        const node = pending.get(queue.shift()!);
        if (!node) continue;
        const adjacent = placed.filter((v) => neighbors.get(node.id)?.has(v.id));
        const desired = adjacent.length
          ? {
              x:
                Math.round(
                  adjacent.reduce((sum, v) => sum + v.layoutPosition.x, 0) / adjacent.length / 340,
                ) * 340,
              y:
                Math.round(
                  adjacent.reduce((sum, v) => sum + v.layoutPosition.y, 0) / adjacent.length / 390,
                ) * 390,
            }
          : { x: 0, y: 0 };
        node.layoutPosition = nearbyPosition(placed, desired);
        node.revision++;
        node.updatedAt = timestamp();
        placed.push(node);
        pending.delete(node.id);
        queue.push(...(neighbors.get(node.id) ?? []));
      }
    }
  });
}
export function mergeRelation(
  p: Exploration,
  proposal: Omit<
    GraphEdge,
    | 'id'
    | 'projectId'
    | 'createdAt'
    | 'updatedAt'
    | 'revision'
    | 'inputFingerprint'
    | 'reconsiderationAvailable'
    | 'verifiedByUser'
  >,
) {
  const n = synchronizeLab(p);
  const lab = n.lab!;
  const key = relationKey(proposal.sourceNodeId, proposal.targetNodeId, proposal.relationType);
  const old = lab.edges.find((e) => e.id === key);
  const fingerprint = evidenceFingerprint(n, proposal.evidenceRefs);
  if (old) {
    if (old.status === 'deleted' && old.inputFingerprint !== fingerprint)
      old.reconsiderationAvailable = true;
    return n;
  }
  const edge: GraphEdge = {
    ...proposal,
    id: key,
    projectId: p.id,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    revision: 1,
    inputFingerprint: fingerprint,
    reconsiderationAvailable: false,
    verifiedByUser: false,
    status: 'pending',
    strengthClass: 'weak',
  };
  edge.strengthClass = edgeStrength(n, edge);
  validateEdge(n, lab, edge);
  lab.edges.push(edge);
  return n;
}
export function deleteRelation(p: Exploration, id: string) {
  return operation(p, '删除候选关系（保留两端节点）', (n) => {
    const edge = n.lab!.edges.find((v) => v.id === id);
    if (!edge) throw new Error('关系不存在。');
    edge.status = 'deleted';
    edge.deletedAt = timestamp();
    edge.deletedBy = 'user';
    edge.revision++;
    edge.updatedAt = timestamp();
  });
}
export function restoreRelation(p: Exploration, id: string) {
  return operation(p, '恢复已删除关系', (n) => {
    const edge = n.lab!.edges.find((v) => v.id === id);
    if (!edge || edge.status !== 'deleted') throw new Error('没有可恢复的已删除关系。');
    const valid = edge.evidenceRefs.every((id) =>
      n.evidence.some((e) => e.evidenceId === id && evidenceValid(n, e)),
    );
    edge.status = valid ? 'restored' : 'review';
    edge.inputFingerprint = evidenceFingerprint(n, edge.evidenceRefs);
    edge.strengthClass = edgeStrength(n, edge, edge.verifiedByUser && valid);
    edge.reconsiderationAvailable = false;
    edge.revision++;
    edge.updatedAt = timestamp();
  });
}
export function verifyRelation(p: Exploration, id: string) {
  return operation(p, '人工核对关系的直接依据', (n) => {
    const edge = n.lab!.edges.find((v) => v.id === id);
    if (!edge || edge.status === 'deleted') throw new Error('关系不可核对。');
    if (
      !edge.evidenceRefs.length ||
      edge.evidenceRefs.some(
        (id) => !n.evidence.some((e) => e.evidenceId === id && evidenceValid(n, e)),
      )
    )
      throw new Error('须先定位并核对全部实际证据。');
    edge.verifiedByUser = true;
    edge.status = 'verified';
    edge.strengthClass = edgeStrength(n, edge, true);
    edge.inputFingerprint = evidenceFingerprint(n, edge.evidenceRefs);
    edge.revision++;
    edge.updatedAt = timestamp();
    validateEdge(n, n.lab!, edge);
  });
}
export function editRelationType(p: Exploration, id: string, type: GraphEdge['relationType']) {
  return operation(p, '修改关系类型', (n) => {
    const edge = n.lab!.edges.find((v) => v.id === id);
    if (!edge || edge.status === 'deleted') throw new Error('关系不存在。');
    const key = relationKey(edge.sourceNodeId, edge.targetNodeId, type);
    if (n.lab!.edges.some((v) => v.id === key && v.id !== edge.id))
      throw new Error('该类型关系已存在，不能重复创建。');
    if (key === edge.id) return;
    const replacement = {
      ...structuredClone(edge),
      id: key,
      relationType: type,
      verifiedByUser: false,
      status: 'pending' as const,
      revision: 1,
      createdAt: timestamp(),
      updatedAt: timestamp(),
    };
    replacement.strengthClass = edgeStrength(n, replacement);
    validateEdge(n, n.lab!, replacement);
    edge.status = 'deleted';
    edge.deletedBy = 'user';
    edge.deletedAt = timestamp();
    edge.revision++;
    edge.updatedAt = timestamp();
    n.lab!.edges.push(replacement);
  });
}
export function editFindingNode(
  p: Exploration,
  id: string,
  patch: Parameters<typeof changeFinding>[2],
) {
  return operation(p, '编辑或确认研究功能', (n) => {
    const before = n.operations;
    const changed = changeFinding(n, id, patch);
    changed.operations = before;
    Object.assign(n, changed);
  });
}
export function answerQuestion(
  p: Exploration,
  id: string,
  answer: string,
  status: 'open' | 'answered' | 'deferred' | 'excluded',
) {
  return operation(p, '处理研究待确认问题', (n) => {
    const q = resolveDecision(n.questions, id);
    if (!q) throw new Error('问题不存在。');
    if (['answered', 'excluded'].includes(status) && !answer.trim())
      throw new Error('请记录实际回答或排除理由。');
    if (q.answer !== answer)
      for (const f of n.findings.filter(
        (f) => q.findingIds.includes(f.id) && f.status === 'confirmed' && !f.locked,
      )) {
        f.status = 'review';
        f.revision++;
      }
    q.answer = answer;
    q.status = status;
    q.response = {
      kind: status === 'deferred' ? 'skipped' : 'custom',
      choiceIds: [],
      text: answer,
      questionVersion: q.decision?.version ?? 1,
      optionsVersion: q.decision?.optionsVersion ?? 1,
    };
    q.decision = {
      ...(q.decision ?? initializeDecision(q).decision!),
      answerNeedsReview: false,
      updatedAt: timestamp(),
    };
    for (const item of [...n.lab!.solutions, ...n.lab!.requirements]) {
      const related =
        item.relatedFeatureIds.some((id) => q.findingIds.includes(id)) ||
        ('evidenceIds' in item ? item.evidenceIds : item.relatedEvidenceIds).some((id) =>
          q.evidenceIds.includes(id),
        );
      if (related && item.status === 'confirmed' && !('locked' in item && item.locked)) {
        item.status = 'review';
        item.revision++;
        item.updatedAt = timestamp();
      }
    }
  });
}
export function respondToResearchQuestion(
  p: Exploration,
  id: string,
  raw: DecisionResponse | null,
) {
  const q = resolveDecision(p.questions, id);
  if (!q) throw new Error('问题不存在。');
  id = q.id;
  if (raw === null) {
    if (!q.answer && !q.response) return p;
    const next = answerQuestion(p, id, '', 'open'),
      saved = next.questions.find((q) => q.id === id)!;
    delete saved.response;
    if (saved.decision) delete saved.decision.provisional;
    const changed = next.operations?.at(-1)?.after.questions.find((q) => q.id === id);
    if (changed) {
      delete changed.response;
      if (changed.decision) delete changed.decision.provisional;
    }
    return next;
  }
  const response = stampDecisionResponse(q, decisionResponseSchema.parse(raw));
  if (JSON.stringify(q.response) === JSON.stringify(response) && !q.decision?.answerNeedsReview)
    return p;
  if (
    response.kind === 'choice' &&
    (!response.choiceIds.length ||
      response.choiceIds.some((id) => !q.choices?.some((c) => c.id === id)))
  )
    throw new Error('请选择本题实际选项。');
  if (response.kind === 'custom' && !response.text.trim()) throw new Error('请填写自己的回答。');
  const text =
    response.kind === 'choice'
      ? q
          .choices!.filter((c) => response.choiceIds.includes(c.id))
          .map((c) => c.label)
          .join('；')
      : response.kind === 'uncertain'
        ? '用户尚不确定；保留未知，不采纳推荐。'
        : response.kind === 'skipped'
          ? '用户暂时跳过；仍待确认。'
          : response.kind === 'none'
            ? `用户明确表示现有选项均不适用。${response.text ? `补充偏好：${response.text}` : ''}`
            : response.text;
  const next = answerQuestion(
    p,
    id,
    text,
    response.kind === 'uncertain' || response.kind === 'none'
      ? 'open'
      : response.kind === 'skipped'
        ? 'deferred'
        : 'answered',
  );
  const saved = next.questions.find((q) => q.id === id)!;
  saved.response = response;
  saved.decision = {
    ...(q.decision ?? initializeDecision(q).decision!),
    answerNeedsReview: false,
    updatedAt: timestamp(),
  };
  const recommendation = q.choices?.find((c) => c.id === q.recommendation?.choiceId);
  if (response.kind === 'uncertain' && recommendation && q.recommendation)
    saved.decision.provisional = { label: recommendation.label, reason: q.recommendation.reason };
  else delete saved.decision.provisional;
  // Include the response metadata in the same scoped history entry.
  const op = next.operations?.at(-1);
  const changed = op?.after.questions.find((q) => q.id === id);
  if (changed) {
    changed.response = response;
    changed.decision = structuredClone(saved.decision);
  }
  return next;
}
export function applyResearchDecisionRepair(
  p: Exploration,
  id: string,
  expected: string,
  expectedContext: string,
  replacements: DecisionQuestion[],
) {
  const q = p.questions.find((q) => q.id === id);
  if (
    !q ||
    decisionFingerprint(q) !== expected ||
    contextFingerprint(researchDecisionContext(p, q)) !== expectedContext
  )
    throw new Error('问题、资料或回答已有变化；迟到的选项未应用，请重新补全。');
  return operation(p, '局部补全问题选项（保留旧答案和版本）', (n) => {
    const i = n.questions.findIndex((q) => q.id === id);
    n.questions.splice(i, 1, ...replaceDecisionQuestion(n.questions[i], replacements));
  });
}
export function choosePlanningSolution(
  p: Exploration,
  ids: string[],
  kind: 'selected' | 'custom' | 'uncertain' | 'none',
  text = '',
) {
  return operation(p, '选择规划方向（不自动确认AI结论）', (n) => {
    if (kind === 'custom' && !text.trim()) throw new Error('请填写自己的方案偏好。');
    if (
      kind === 'selected' &&
      (!ids.length ||
        ids.some(
          (id) =>
            !n.lab!.solutions.some((s) => s.id === id && !['excluded', 'stale'].includes(s.status)),
        ))
    )
      throw new Error('请选择有效候选方案。');
    n.lab!.activeSolutionIds = kind === 'selected' ? [...new Set(ids)] : [];
    n.lab!.researchGuide.planChoice = { kind, text: text.trim().slice(0, 3000) };
    delete n.lab!.researchGuide.packageSignature;
  });
}
export function savePlanningConstraints(
  p: Exploration,
  budget: string,
  deadline: string,
  extra: string,
) {
  const provided = [
    budget.trim() && `预算（用户填写）：${budget.trim()}`,
    deadline.trim() && `交付时间（用户填写）：${deadline.trim()}`,
    extra.trim() && `其他约束（用户填写）：${extra.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
  if (!provided && !p.sources.some((s) => !s.removed && s.title === '规划约束（用户补充）'))
    return p;
  const text = provided || '用户已清空规划约束；预算、交付时间与补充条件保持未知。';
  return operation(p, '保存规划约束为用户资料', (n) => {
    const original = n.sources.find(
      (s) => !s.removed && s.kind === 'text' && s.title === '规划约束（用户补充）',
    );
    if (original?.versions.at(-1)?.text === text) return;
    const source = original ?? createSource('text', '规划约束（用户补充）');
    source.status = 'ready';
    if (!original && n.sources.length >= 40) throw new Error('资料达到上限。');
    const version = {
      revision: (original?.versions.at(-1)?.revision ?? 0) + 1,
      text,
      paragraphs: paragraphs(text, 'user'),
      createdAt: timestamp(),
      userEdited: true,
    };
    if (!original) source.versions = [version];
    Object.assign(n, sourceChanged(n, source, version));
  });
}
export function savePlanningPreference(p: Exploration, text: string) {
  return operation(p, '保存自己的规划方向与原有约束', (n) => {
    const previous = n.operations,
      prior = readPlanningConstraints(n);
    let changed = choosePlanningSolution(n, [], 'custom', text);
    const constraints = [prior.constraints, `补充方案偏好：${text.trim()}`]
      .filter(Boolean)
      .join('\n');
    changed = savePlanningConstraints(changed, prior.budget, prior.deadline, constraints);
    changed.operations = previous;
    Object.assign(n, changed);
  });
}
export function confirmPlanningPackage(
  p: Exploration,
  requirementIds: string[],
  acknowledge: string | null,
) {
  return operation(p, '人工确认选定方案与资料包范围', (n) => {
    const lab = n.lab!,
      plans = lab.solutions.filter((s) => lab.activeSolutionIds.includes(s.id));
    if (!plans.length || plans.some((s) => ['excluded', 'stale'].includes(s.status)))
      throw new Error('先选择有效方案；不确定和自定义偏好不会自动确认候选。');
    if (criticalPlanningItems(n).length && acknowledge !== conflictSignature(n))
      throw new Error('存在影响方案的重要冲突；请返回处理，或明确同意带着当前假设继续。');
    if (!requirementIds.length && !plans.every((s) => s.hiringNeed === 'not-needed'))
      throw new Error('至少选择一条希望带入岗位讨论的要求，也可以先导出研究草稿。');
    for (const id of requirementIds) {
      const r = lab.requirements.find(
        (r) =>
          r.id === id && lab.activeSolutionIds.includes(r.solutionId) && r.status !== 'excluded',
      );
      if (
        !r ||
        (r.locked && r.status !== 'confirmed') ||
        r.evidenceIds.some(
          (id) => !n.evidence.some((e) => e.evidenceId === id && evidenceValid(n, e)),
        )
      )
        throw new Error('要求已失效或锁定，请先核对范围。');
      r.status = 'confirmed';
      r.revision++;
      r.updatedAt = timestamp();
    }
    for (const s of plans) {
      s.status = 'confirmed';
      s.revision++;
      s.updatedAt = timestamp();
    }
    const featureIds = new Set(
      plans.flatMap((s) =>
        s.productPlan?.priorityFeatureIds.length
          ? s.productPlan.priorityFeatureIds
          : s.relatedFeatureIds,
      ),
    );
    for (const f of n.findings)
      if (featureIds.has(f.id) && f.status !== 'excluded' && !f.locked) {
        f.status = 'confirmed';
        f.revision++;
      }
    lab.researchGuide.importRequirementIds = [...new Set(requirementIds)];
    for (const s of plans)
      s.inputVersions = Object.fromEntries(
        s.relatedFeatureIds.map((id) => [id, n.findings.find((f) => f.id === id)?.revision ?? 0]),
      );
    for (const r of lab.requirements.filter((r) => requirementIds.includes(r.id)))
      r.inputVersions = Object.fromEntries(
        [...r.relatedFeatureIds, ...r.inferenceIds].map((id) => [
          id,
          n.findings.find((f) => f.id === id)?.revision ?? 0,
        ]),
      );
    lab.researchGuide.acknowledgedConflicts = conflictSignature(n);
    lab.researchGuide.packageSignature = packageSignature(n);
  });
}
export function editSolution(
  p: Exploration,
  id: string,
  patch: Partial<
    Pick<
      NonNullable<Exploration['lab']>['solutions'][number],
      | 'title'
      | 'description'
      | 'status'
      | 'rationale'
      | 'assumptions'
      | 'advantages'
      | 'disadvantages'
      | 'openQuestions'
    >
  >,
) {
  return operation(p, '修改或确认候选岗位方案', (n) => {
    const solution = n.lab!.solutions.find((v) => v.id === id);
    if (!solution) throw new Error('方案不存在。');
    Object.assign(solution, patch);
    solution.revision++;
    solution.updatedAt = timestamp();
    if (patch.status === 'confirmed')
      solution.inputVersions = Object.fromEntries(
        solution.relatedFeatureIds.map((id) => [
          id,
          n.findings.find((f) => f.id === id)?.revision ?? 0,
        ]),
      );
    else if (!patch.status && solution.status === 'confirmed') solution.status = 'review';
  });
}
export function editRequirement(
  p: Exploration,
  id: string,
  patch: Partial<
    Pick<RoleRequirement, 'title' | 'description' | 'requirementType' | 'status' | 'locked'>
  >,
) {
  return operation(p, '修改或确认岗位要求', (n) => {
    const r = n.lab!.requirements.find((v) => v.id === id);
    if (!r) throw new Error('岗位要求不存在。');
    if (r.locked && Object.keys(patch).some((k) => k !== 'locked'))
      throw new Error('请先解锁岗位要求。');
    if (
      patch.status === 'confirmed' &&
      r.evidenceIds.some(
        (id) => !n.evidence.some((e) => e.evidenceId === id && evidenceValid(n, e)),
      )
    )
      throw new Error('存在失效证据，请先核对或重新分析。');
    Object.assign(r, patch);
    if (patch.status === 'confirmed')
      r.inputVersions = Object.fromEntries(
        [...r.relatedFeatureIds, ...r.inferenceIds].map((id) => [
          id,
          n.findings.find((f) => f.id === id)?.revision ?? 0,
        ]),
      );
    else if (!patch.status && patch.locked === undefined && r.status === 'confirmed')
      r.status = 'review';
    r.revision++;
    r.updatedAt = timestamp();
  });
}
export function chooseSolutions(p: Exploration, ids: string[]) {
  return operation(p, '选择或组合候选岗位方案', (n) => {
    if (ids.some((id) => !n.lab!.solutions.some((s) => s.id === id && s.status !== 'excluded')))
      throw new Error('所选方案不存在或已排除。');
    n.lab!.activeSolutionIds = [...new Set(ids)];
  });
}
export function nodeImpact(p: Exploration, id: string) {
  const node = p.lab?.nodes.find((v) => v.id === id);
  if (!node) return { relations: 0, findings: 0, requirements: 0, snapshots: p.snapshots.length };
  return {
    relations: p.lab!.edges.filter(
      (e) => e.status !== 'deleted' && (e.sourceNodeId === id || e.targetNodeId === id),
    ).length,
    findings: p.findings.filter((f) => f.evidenceIds.some((id) => node.evidenceIds.includes(id)))
      .length,
    requirements: p.lab!.requirements.filter(
      (r) =>
        r.relatedFeatureIds.includes(
          node.type === 'feature' || node.type === 'inference' ? node.content.findingId : '',
        ) || r.evidenceIds.some((id) => node.evidenceIds.includes(id)),
    ).length,
    snapshots: p.snapshots.length,
  };
}
export function excludeNode(p: Exploration, id: string) {
  return operation(p, '排除节点并保留关联历史', (n) => {
    const node = n.lab!.nodes.find((v) => v.id === id);
    if (!node) throw new Error('节点不存在。');
    if (node.type === 'source') {
      Object.assign(n, removeSource(n, node.content.sourceId));
    } else if (node.type === 'feature' || node.type === 'inference') {
      const f = n.findings.find((f) => f.id === node.content.findingId)!;
      if (f.locked) throw new Error('请先解锁。');
      f.status = 'excluded';
      f.revision++;
    } else if (node.type === 'question') {
      const q = n.questions.find((v) => v.id === node.content.questionId)!;
      q.status = 'excluded';
      if (!q.answer) q.answer = '用户在证据板中明确排除此问题。';
    } else if (node.type === 'role') {
      const s = n.lab!.solutions.find((s) => s.id === node.content.solutionId)!;
      s.status = 'excluded';
      s.revision++;
    } else if (node.type === 'requirement') {
      const r = n.lab!.requirements.find((r) => r.id === node.content.requirementId)!;
      if (r.locked) throw new Error('请先解锁。');
      r.status = 'excluded';
      r.revision++;
    } else
      throw new Error('证据可能被共同引用，请收回独立展示或删除对应标注，不直接删除原始证据。');
  });
}
export function addAnnotation(
  p: Exploration,
  raw: Omit<Annotation, 'id' | 'projectId' | 'evidenceId' | 'createdAt' | 'updatedAt' | 'revision'>,
) {
  return operation(p, '新增区域标注候选', (n) => {
    const source = n.sources.find((s) => s.id === raw.sourceId);
    if (!source || source.versions.at(-1)!.revision !== raw.sourceRevision)
      throw new Error('来源版本已改变，不能将旧坐标用于新资料。');
    const annotation = annotationSchema.parse({
      ...raw,
      id: makeId(),
      projectId: p.id,
      evidenceId: makeId(),
      createdAt: timestamp(),
      updatedAt: timestamp(),
      revision: 1,
    });
    if (raw.createdBy !== 'user' && raw.status !== 'pending')
      throw new Error('AI与示例标注必须先待确认。');
    const v = source.versions.at(-1)!;
    if (
      source.kind === 'image' &&
      (v.width !== raw.originalWidth || v.height !== raw.originalHeight)
    )
      throw new Error('标注必须绑定原图尺寸。');
    if (raw.page && (!v.pageCount || raw.page > v.pageCount)) throw new Error('标注页码超出文档。');
    n.lab!.annotations.push(annotation);
    n.evidence.push({
      evidenceId: annotation.evidenceId,
      sourceId: source.id,
      sourceRevision: annotation.sourceRevision,
      evidenceType: raw.page
        ? 'document-region'
        : raw.time !== undefined
          ? 'video-frame'
          : raw.assetId && source.kind === 'url'
            ? 'web-screenshot'
            : 'image',
      title: raw.label.slice(0, 200),
      excerpt: raw.label,
      location: raw.page
        ? { kind: 'document', page: raw.page, rect: raw.normalizedGeometry }
        : raw.time !== undefined
          ? {
              kind: 'video',
              time: raw.time,
              frameAssetId: raw.assetId ?? null,
              rect: raw.normalizedGeometry,
            }
          : {
              kind: 'image',
              assetId: raw.assetId ?? source.versions.at(-1)!.assetId!,
              rect: raw.normalizedGeometry,
            },
      verificationStatus: raw.status === 'accepted' ? 'verified' : 'needs-review',
      createdAt: timestamp(),
      relatedFindingIds: [],
    });
  });
}
export function acceptImageTranscription(p: Exploration, resultId: string, text: string) {
  const result = p.lab?.visualResults.find((r) => r.id === resultId);
  const source = p.sources.find((s) => s.id === result?.sourceId && !s.removed);
  const v = source?.versions.at(-1);
  const clean = text.trim();
  if (
    !result ||
    !source ||
    source.kind !== 'image' ||
    v?.revision !== result.sourceRevision ||
    !v.assetId ||
    !v.width ||
    !v.height
  )
    throw new Error('识图结果或来源版本已变化，请重新核对当前图片。');
  if (!clean || clean.length > 2000) throw new Error('请核对并选取1至2000字的图像文字或说明。');
  if (
    p.lab!.annotations.some(
      (a) =>
        a.sourceId === source.id &&
        a.sourceRevision === v.revision &&
        a.status === 'accepted' &&
        a.label === clean,
    )
  )
    return p;
  return operation(p, '人工核对图像转写并保存整图证据', (n) => {
    const prior = n.operations;
    const changed = addAnnotation(n, {
      sourceId: source.id,
      sourceRevision: v.revision,
      assetId: v.assetId,
      shapeType: 'rectangle',
      normalizedGeometry: { x: 0, y: 0, width: 1, height: 1 },
      label: clean,
      status: 'accepted',
      createdBy: 'user',
      originalWidth: v.width!,
      originalHeight: v.height!,
    });
    changed.operations = prior;
    Object.assign(n, changed);
  });
}
export function updateAnnotation(
  p: Exploration,
  id: string,
  patch: { geometry?: Rectangle; label?: string; status?: 'accepted' | 'deleted' | 'pending' },
) {
  return operation(
    p,
    patch.status === 'accepted'
      ? '接受区域标注（不确认关联结论）'
      : patch.status === 'deleted'
        ? '删除区域标注'
        : '移动或调整区域标注',
    (n) => {
      const a = n.lab!.annotations.find((a) => a.id === id);
      if (!a) throw new Error('标注不存在。');
      const source = n.sources.find((s) => s.id === a.sourceId);
      if (!source || source.versions.at(-1)?.revision !== a.sourceRevision)
        throw new Error('来源版本已改变，请回到对应原始版本核对，不能套用旧坐标。');
      const next = annotationSchema.parse({
        ...a,
        normalizedGeometry: patch.geometry ?? a.normalizedGeometry,
        label: patch.label ?? a.label,
        status: patch.status ?? a.status,
        revision: a.revision + 1,
        updatedAt: timestamp(),
      });
      Object.assign(a, next);
      const e = n.evidence.find((e) => e.evidenceId === a.evidenceId);
      if (e) {
        e.excerpt = a.label;
        e.title = a.label.slice(0, 200);
        if ('rect' in e.location) e.location.rect = a.normalizedGeometry;
        e.verificationStatus = a.status === 'accepted' ? 'verified' : 'needs-review';
        for (const f of n.findings.filter(
          (f) => f.evidenceIds.includes(e.evidenceId) && f.status === 'confirmed',
        )) {
          f.status = 'review';
          f.revision++;
        }
      }
    },
  );
}
