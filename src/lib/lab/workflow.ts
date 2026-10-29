import {
  labStageRequestSchema,
  labResultSchema,
  validateLinkResult,
  validateRoleResult,
  type LabStageRequest,
} from './ai-contract';
import {
  synchronizeLab,
  evidenceChain,
  digest,
  evidenceFingerprint,
  findingNodeId,
  questionNodeId,
} from './graph';
import { mergeRelation } from './operations';
import { currentDecisions, appendGeneratedDecision, resolveDecision } from '../decisions/records';
import {
  makeId,
  timestamp,
  type Exploration,
  type AnalysisRun,
  type Finding,
} from '../exploration/model';
import { evidenceValid, touchExploration, validateAnalysis } from '../exploration/domain';
import { recordResearchChange } from '../exploration/journal';
import type { LabStage, StageRun } from './model';
import { selectAnalysisEvidence } from './evidence-selection';
import { demoFixtureKey } from '../demo/identity';
/** 按依赖对象生成版本指纹；无关对象变化不应让整次阶段响应失效。 */
export function objectVersions(p: Exploration): Record<string, string> {
  return Object.fromEntries([
    ['overview', digest([p.overview, p.overviewRevision, p.overviewConfirmed])],
    ...p.sources.map((s) => [
      `source:${s.id}`,
      digest([
        s.versions.at(-1)?.revision,
        s.removed,
        s.purpose,
        s.borrow,
        s.avoid,
        s.referencePurpose,
      ]),
    ]),
    ...p.evidence.map((e) => [`evidence:${e.evidenceId}`, evidenceFingerprint(p, [e.evidenceId])]),
    ...p.findings.map((f) => [`finding:${f.id}`, String(f.revision)]),
    ...p.questions.map((q) => [`question:${q.id}`, digest(resolveDecision(p.questions, q.id))]),
    ...(p.lab?.requirements ?? []).map((r) => [`requirement:${r.id}`, String(r.revision)]),
    ...(p.lab?.solutions ?? []).map((s) => [`solution:${s.id}`, String(s.revision)]),
  ]);
}
/** 从当前有效证据和所选证据链构建请求，限制文本与体积；不发送全部附件 Blob。 */
export function buildLabRequest(
  project: Exploration,
  stage: LabStageRequest['stage'],
  selectedIds: string[] = [],
): LabStageRequest {
  const p = synchronizeLab(project),
    lab = p.lab!;
  const scope = new Set(selectedIds.length ? selectedIds : lab.nodes.map((n) => n.id));
  if (selectedIds.length) {
    for (const id of selectedIds) for (const related of evidenceChain(lab, id)) scope.add(related);
    const selectedSources = lab.nodes
      .filter((n) => selectedIds.includes(n.id) && n.type === 'source')
      .flatMap((n) => n.sourceIds);
    for (const node of lab.nodes)
      if (node.sourceIds.some((id) => selectedSources.includes(id))) scope.add(node.id);
  }
  const candidates = lab.nodes.filter((n) => scope.has(n.id));
  const evidenceIds = new Set(candidates.flatMap((n) => n.evidenceIds));
  const sourceIds = new Set(candidates.flatMap((n) => n.sourceIds));
  const evidence = selectAnalysisEvidence(
    p,
    p.evidence.filter((e) => evidenceIds.has(e.evidenceId) && evidenceValid(p, e)),
  );
  const sources = p.sources
    .filter((s) => !s.removed && sourceIds.has(s.id) && ['ready', 'partial'].includes(s.status))
    .map((s) => {
      const copy = structuredClone(s),
        v = copy.versions.at(-1)!;
      const paragraphs = new Set(
        evidence
          .filter((e) => e.sourceId === s.id && e.location.kind === 'text')
          .map((e) => (e.location.kind === 'text' ? e.location.paragraphId : '')),
      );
      v.paragraphs = v.paragraphs.filter((v) => paragraphs.has(v.id));
      v.text = v.paragraphs.map((v) => v.text).join('\n');
      copy.versions = [v];
      return copy;
    });
  const findings = p.findings.filter((f) => scope.has(findingNodeId(f.id)));
  const questions = currentDecisions(p.questions).filter(
    (q) =>
      scope.has(questionNodeId(q.id)) ||
      q.findingIds.some((id) => findings.some((f) => f.id === id)),
  );
  const nodes = candidates
    .filter(
      (n) =>
        !['excluded', 'failed', 'stale'].includes(n.status) &&
        (n.type !== 'evidence' ||
          n.evidenceIds.some((id) => evidence.some((e) => e.evidenceId === id))),
    )
    .map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      summary: n.summary,
      sourceIds: n.sourceIds,
      evidenceIds: n.evidenceIds,
      originType: n.originType,
      status: n.status,
    }));
  const versions = objectVersions(p);
  const keys = new Set([
    'overview',
    ...nodes.map((n) => n.id),
    ...sources.map((s) => `source:${s.id}`),
    ...evidence.map((e) => `evidence:${e.evidenceId}`),
    ...findings.map((f) => `finding:${f.id}`),
    ...questions.map((q) => `question:${q.id}`),
  ]);
  for (const n of candidates) if (n.type === 'role') keys.add(`solution:${n.content.solutionId}`);
  const request = labStageRequestSchema.parse({
    stage,
    interactionMode: lab.ui.researchMode,
    projectId: p.id,
    revision: p.revision,
    mode: p.mode,
    consent: true,
    analysis: {
      ...(demoFixtureKey(p.demo) ? { fixture: demoFixtureKey(p.demo) } : {}),
      projectId: p.id,
      revision: p.revision,
      mode: p.mode,
      consent: true,
      sources,
      evidence,
      confirmedFindings: findings,
      overview: p.overview,
      questions,
    },
    nodes,
    scope: { kind: selectedIds.length ? 'selected' : 'all', nodeIds: nodes.map((n) => n.id) },
    deletedRelations: lab.edges
      .filter((e) => e.status === 'deleted')
      .map((e) => ({
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        relationType: e.relationType,
      })),
    inputVersions: Object.fromEntries(
      [...keys].filter((k) => versions[k] !== undefined).map((k) => [k, versions[k]]),
    ),
  });
  if (evidence.reduce((sum, e) => sum + e.excerpt.length, 0) > 60000)
    throw new Error('当前范围超过60000字，请选择相关节点后分析。');
  if (new Blob([JSON.stringify(request)]).size > 1000000)
    throw new Error('本阶段资料超过1MB，请缩小选中范围。');
  return request;
}
export function beginStage(
  project: Exploration,
  stage: LabStage,
  inputVersions: Record<string, string>,
  scopeNodeIds: string[],
  promptVersion: string,
): { project: Exploration; run: StageRun } {
  const p = synchronizeLab(project);
  if (p.lab!.runs.length >= 300) throw new Error('阶段记录达到300次，请保存快照并派生研究。');
  const run: StageRun = {
    id: makeId(),
    projectId: p.id,
    stage,
    status: 'running',
    inputRevision: p.revision,
    inputVersions,
    inputSignature: digest(inputVersions),
    startedAt: timestamp(),
    errorCode: '',
    errorMessage: '',
    retryCount: 0,
    promptVersion,
    modelConfigId: p.mode === 'example' ? 'lab-example@1' : 'pending-config',
    scopeNodeIds,
    resultSummary: '',
  };
  p.lab!.runs.push(run);
  return { project: touchExploration(p), run };
}
export function finishStage(project: Exploration, id: string, patch: Partial<StageRun>) {
  const p = structuredClone(project);
  const run = p.lab?.runs.find((r) => r.id === id);
  if (!run) throw new Error('分析阶段记录不存在。');
  Object.assign(run, patch, { completedAt: timestamp(), resultRevision: p.revision + 1 });
  return touchExploration(p);
}
export function recordLocalStages(project: Exploration) {
  let p = synchronizeLab(project);
  if (!p.sources.length) return p;
  for (const stage of ['parse_sources', 'extract_evidence'] as const) {
    const versions = objectVersions(p);
    const key = Object.fromEntries(
      Object.entries(versions).filter(
        ([k]) =>
          k.startsWith('source:') || (stage === 'extract_evidence' && k.startsWith('evidence:')),
      ),
    );
    if (
      p.lab!.runs.some(
        (r) =>
          r.stage === stage &&
          r.inputSignature === digest(key) &&
          ['succeeded', 'partial'].includes(r.status),
      )
    )
      continue;
    const start = beginStage(
      p,
      stage,
      key,
      [],
      stage === 'parse_sources' ? 'local-parsers@1' : 'positioned-evidence@1',
    );
    p = start.project;
    const failed = p.sources.filter((s) => !s.removed && s.status === 'error').length;
    const pending = p.lab!.annotations.filter((a) => a.status === 'pending').length;
    p = finishStage(p, start.run.id, {
      status: failed || pending ? 'partial' : 'succeeded',
      errorCode: failed ? 'SOURCE_PARTIAL' : '',
      errorMessage: failed ? '部分来源解析失败，未将空白或乱码作为成功内容。' : '',
      resultSummary:
        stage === 'parse_sources'
          ? `${p.sources.filter((s) => !s.removed).length}份实际资料；${failed}份解析失败。`
          : `${p.evidence.filter((e) => evidenceValid(p, e)).length}条可定位证据；${pending}项标注待确认。没有自动OCR或视频理解。`,
    });
  }
  return p;
}
type Reply = {
  requestId: string;
  promptVersion: string;
  modelConfigId: string;
  mode: 'example' | 'real';
};
/**
 * 合并仍有效的新增候选，保留人工编辑、排除与原有布局。
 * 已取消/结束任务不再接收迟到响应；依赖版本改变的部分计入过期结果。
 */
export function mergeStageResult(
  project: Exploration,
  runId: string,
  input: LabStageRequest,
  raw: unknown,
  reply: Reply,
) {
  const result = labResultSchema.parse(raw);
  if (result.stage !== input.stage || project.id !== input.projectId || reply.mode !== input.mode)
    throw new Error('响应与本次研究、模式或阶段不一致。');
  let p = synchronizeLab(project);
  const run = p.lab!.runs.find((r) => r.id === runId);
  if (!run || run.status !== 'running') return p;
  const currentVersions = objectVersions(p);
  // 比较请求时的对象版本，不仅比较整个项目 revision，允许无关编辑并行发生。
  const unchanged = (key: string) =>
    input.inputVersions[key] !== undefined && input.inputVersions[key] === currentVersions[key];
  const evidenceCurrent = (ids: string[]) =>
    ids.every(
      (id) =>
        unchanged(`evidence:${id}`) &&
        p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e)),
    );
  let merged = 0,
    stale = 0,
    preserved = 0;
  if (result.stage === 'derive_features') {
    const output = validateAnalysis(input.analysis, result.output),
      mapping = new Map<string, string>();
    const newIds = new Set<string>();
    for (const candidate of output.findings) {
      if (!evidenceCurrent(candidate.evidenceIds)) {
        stale++;
        continue;
      }
      const old = p.findings.find((f) => f.title === candidate.title && f.kind === candidate.kind);
      if (old) {
        preserved++;
        if (old.status !== 'excluded') mapping.set(candidate.key, old.id);
        continue;
      }
      if (
        !candidate.evidenceIds.length &&
        Object.keys(input.inputVersions)
          .filter((k) => k.startsWith('source:') || k.startsWith('question:'))
          .some((k) => !unchanged(k))
      ) {
        stale++;
        continue;
      }
      const f: Finding = {
        ...candidate,
        id: makeId(),
        revision: 1,
        status: 'pending',
        locked: false,
        parentId: null,
        origin: 'ai',
        analysisMode: input.mode,
      };
      p.findings.push(f);
      newIds.add(f.id);
      mapping.set(candidate.key, f.id);
      merged++;
    }
    for (const candidate of output.findings) {
      const f = p.findings.find((f) => f.id === mapping.get(candidate.key));
      if (f && newIds.has(f.id) && candidate.parentKey && mapping.has(candidate.parentKey))
        f.parentId = mapping.get(candidate.parentKey)!;
    }
    for (const q of output.questions) {
      if (!evidenceCurrent(q.evidenceIds)) continue;
      p.questions = appendGeneratedDecision(
        p.questions,
        {
          ...q,
          id: makeId(),
          findingIds: q.findingKeys.flatMap((key) => (mapping.has(key) ? [mapping.get(key)!] : [])),
          status: 'open',
          answer: '',
        },
        p.id,
      );
    }
    if (
      !p.overview.goal.trim() &&
      unchanged('overview') &&
      evidenceCurrent(output.overview.evidenceIds)
    ) {
      p.overview = output.overview;
      p.overviewConfirmed = false;
      p.overviewRevision++;
      p.overviewMode = input.mode;
    }
    const analysisRun: AnalysisRun = {
      id: makeId(),
      at: timestamp(),
      requestId: reply.requestId,
      promptVersion: reply.promptVersion,
      mode: input.mode,
      baseSignature: digest(input.inputVersions),
      output,
      applied: merged > 0,
      modelConfig: {
        provider: input.mode === 'example' ? 'mock' : 'deepseek',
        model: input.mode === 'example' ? 'built-in-lab-example' : 'configured-model',
        configurationId: reply.modelConfigId,
      },
    };
    if (p.runs.length >= 100) throw new Error('分析原始记录达到100次，请先保存快照并派生研究。');
    p.runs.push(analysisRun);
  } else if (result.stage === 'link_evidence') {
    const output = validateLinkResult(input, result.output);
    for (const relation of output.relations) {
      const endpointCurrent = (id: string) => {
        const n = p.lab!.nodes.find((n) => n.id === id);
        return n?.type === 'role' ? unchanged(`solution:${n.content.solutionId}`) : unchanged(id);
      };
      if (
        !evidenceCurrent(relation.evidenceRefs) ||
        !endpointCurrent(relation.sourceNodeId) ||
        !endpointCurrent(relation.targetNodeId)
      ) {
        stale++;
        continue;
      }
      const before = p.lab!.edges.length;
      p = mergeRelation(p, {
        ...relation,
        strengthClass: 'weak',
        status: 'pending',
        generatedBy: input.mode === 'example' ? 'example' : 'ai',
      });
      if (p.lab!.edges.length > before) merged++;
      else preserved++;
    }
    for (const q of output.questions)
      if (evidenceCurrent(q.evidenceIds))
        p.questions = appendGeneratedDecision(
          p.questions,
          { ...q, id: makeId(), status: 'open', answer: '' },
          p.id,
        );
  } else {
    const output = validateRoleResult(input, result.output);
    for (const proposed of output.solutions) {
      const referenced = [
        ...proposed.relatedFeatureIds,
        ...proposed.requirements.flatMap((r) => [...r.relatedFeatureIds, ...r.inferenceIds]),
      ];
      if (
        !evidenceCurrent(proposed.relatedEvidenceIds) ||
        referenced.some((id) => !unchanged(`finding:${id}`))
      ) {
        stale++;
        continue;
      }
      if (p.lab!.solutions.some((s) => s.title === proposed.title)) {
        preserved++;
        continue;
      }
      const solutionId = makeId(),
        at = timestamp();
      p.lab!.solutions.push({
        id: solutionId,
        projectId: p.id,
        title: proposed.title,
        description: proposed.description,
        rationale: proposed.rationale,
        assumptions: proposed.assumptions,
        advantages: proposed.advantages,
        disadvantages: proposed.disadvantages,
        openQuestions: proposed.openQuestions,
        relatedFeatureIds: proposed.relatedFeatureIds,
        relatedEvidenceIds: proposed.relatedEvidenceIds,
        ...(proposed.productPlan ? { productPlan: proposed.productPlan } : {}),
        ...(proposed.hiringNeed ? { hiringNeed: proposed.hiringNeed } : {}),
        roles: proposed.roles,
        status: 'pending',
        revision: 1,
        generatedBy: input.mode === 'example' ? 'example' : 'ai',
        createdAt: at,
        updatedAt: at,
        inputVersions: Object.fromEntries(
          proposed.relatedFeatureIds.map((id) => [
            id,
            p.findings.find((f) => f.id === id)?.revision ?? 0,
          ]),
        ),
      });
      for (const r of proposed.requirements) {
        if (!evidenceCurrent(r.evidenceIds)) {
          stale++;
          continue;
        }
        p.lab!.requirements.push({
          id: makeId(),
          projectId: p.id,
          solutionId,
          roleKey: r.roleKey,
          title: r.title,
          description: r.description,
          requirementType: r.requirementType,
          relatedTaskIds: [],
          relatedFeatureIds: r.relatedFeatureIds,
          evidenceIds: r.evidenceIds,
          inferenceIds: r.inferenceIds,
          status: 'pending',
          locked: false,
          revision: 1,
          originType: 'ai_inference',
          rationale: r.rationale,
          uncertainty: r.uncertainty,
          createdAt: at,
          updatedAt: at,
          inputVersions: Object.fromEntries(
            [...r.relatedFeatureIds, ...r.inferenceIds].map((id) => [
              id,
              p.findings.find((f) => f.id === id)?.revision ?? 0,
            ]),
          ),
        });
      }
      merged++;
    }
  }
  if (p.findings.length > 150 || p.questions.length > 100)
    throw new Error('研究条目达到上限，请保存快照并派生研究。');
  p = synchronizeLab(p);
  p = finishStage(p, runId, {
    status: stale ? (merged ? 'partial' : 'stale') : 'succeeded',
    requestId: reply.requestId,
    promptVersion: reply.promptVersion,
    modelConfigId: reply.modelConfigId,
    resultSummary: `新增${merged}项；保留已有内容${preserved}项；过期未应用${stale}项。`,
    errorCode: stale ? 'VERSION_CONFLICT' : '',
    errorMessage: stale ? '分析期间相关对象已改变，失效部分未覆盖。可缩小范围重新分析。' : '',
  });
  return recordResearchChange(
    project,
    touchExploration(p, `合并${input.stage}的有效增量候选`),
    `合并${input.stage}的有效增量候选`,
  );
}
