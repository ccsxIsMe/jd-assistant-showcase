import {
  analysisOutputSchema,
  snapshotSchema,
  makeId,
  timestamp,
  type AnalysisOutput,
  type AnalysisRun,
  type Evidence,
  type Exploration,
  type ExploreSource,
  type Finding,
  type Snapshot,
  type SourceVersion,
} from './model';
import { captureResearch, fullSnapshotFindings } from './research';
import { recordResearchChange } from './journal';
import { AnalysisValidationError } from './validation';
import { synchronizeLab, assertLab } from '../lab/graph';
import { appendGeneratedDecision, reconcileDecisions } from '../decisions/records';
export function touchExploration(project: Exploration, message?: string) {
  project.revision++;
  project.updatedAt = timestamp();
  if (message)
    project.activity.unshift({ id: makeId(), text: message.slice(0, 1000), at: timestamp() });
  project.activity = project.activity.slice(0, 300);
  for (const e of project.evidence)
    e.relatedFindingIds = project.findings
      .filter((f) => f.evidenceIds.includes(e.evidenceId))
      .map((f) => f.id);
  return project;
}
export function paragraphs(
  text: string,
  origin: 'user' | 'extracted' = 'user',
  page?: number,
): SourceVersion['paragraphs'] {
  if (text.length > 30000) throw new Error('单份来源文字不能超过30000字。');
  const pieces = text.split(/\n+/).flatMap((line) => {
    const value = line.trim();
    const parts: string[] = [];
    for (let pos = 0; pos < value.length; pos += 1500) parts.push(value.slice(pos, pos + 1500));
    return parts;
  });
  if (pieces.length <= 100)
    return pieces.map((value) => ({
      id: makeId(),
      text: value,
      origin,
      ...(page ? { page } : {}),
    }));
  const chunks: string[] = [];
  let buffer = '';
  for (const line of pieces) {
    const clean = line.trim();
    if (buffer.length + clean.length + 1 > 1500) {
      if (buffer) chunks.push(buffer);
      buffer = '';
    }
    for (let pos = 0; pos < clean.length; pos += 1500) {
      const part = clean.slice(pos, pos + 1500);
      if (part.length === 1500) chunks.push(part);
      else buffer = buffer ? buffer + '\n' + part : part;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks.map((chunk) => ({
    id: makeId(),
    text: chunk,
    origin,
    ...(page ? { page } : {}),
  }));
}
export function createSource(kind: ExploreSource['kind'], title: string): ExploreSource {
  return {
    id: makeId(),
    kind,
    title: title.trim().slice(0, 200) || '未命名资料',
    purpose: 'main',
    borrow: '',
    avoid: '',
    referencePurpose: '',
    status: 'idle',
    error: '',
    removed: false,
    linkedSourceId: null,
    createdAt: timestamp(),
    versions: [{ revision: 1, text: '', paragraphs: [], createdAt: timestamp() }],
  };
}
export function textEvidence(source: ExploreSource, version: SourceVersion): Evidence[] {
  return version.paragraphs.map((p, index) => ({
    evidenceId: makeId(),
    sourceId: source.id,
    sourceRevision: version.revision,
    evidenceType:
      p.origin === 'user'
        ? 'user-description'
        : source.kind === 'url'
          ? 'web-text'
          : 'document-text',
    title: `${source.title} · ${p.page ? `第${p.page}页 · ` : ''}段落${index + 1}`,
    excerpt: p.text,
    location: {
      kind: 'text',
      paragraphId: p.id,
      start: 0,
      end: p.text.length,
      ...(p.page ? { page: p.page } : {}),
    },
    createdAt: timestamp(),
    verificationStatus: 'verified',
    relatedFindingIds: [],
  }));
}
export function evidenceValid(project: Pick<Exploration, 'sources'>, evidence: Evidence): boolean {
  const source = project.sources.find((s) => s.id === evidence.sourceId);
  const version = source?.versions.at(-1);
  if (
    !source ||
    source.removed ||
    !['ready', 'partial'].includes(source.status) ||
    version?.revision !== evidence.sourceRevision ||
    evidence.verificationStatus !== 'verified'
  )
    return false;
  if (evidence.location.kind === 'text') {
    const location = evidence.location;
    const paragraph = version.paragraphs.find((p) => p.id === location.paragraphId);
    return (
      !!paragraph &&
      location.start >= 0 &&
      location.end > location.start &&
      location.end <= paragraph.text.length &&
      paragraph.text.slice(location.start, location.end) === evidence.excerpt
    );
  }
  if (evidence.location.kind === 'video')
    return (
      source.kind === 'video' &&
      evidence.location.time <= (version.duration ?? -1) &&
      evidence.excerpt.trim().length > 0
    );
  if (evidence.location.kind === 'image')
    return evidence.location.assetId === version.assetId && evidence.excerpt.trim().length > 0;
  if (evidence.location.kind === 'document')
    return (
      source.kind === 'document' &&
      evidence.location.page <= (version.pageCount ?? 0) &&
      evidence.excerpt.trim().length > 0
    );
  return false;
}
export function sourceChanged(project: Exploration, source: ExploreSource, version: SourceVersion) {
  const p = structuredClone(project);
  const target = p.sources.find((s) => s.id === source.id);
  if (!target) {
    p.sources.push(source);
    p.evidence.push(...textEvidence(source, version));
    return touchExploration(p, `添加来源「${source.title}」`);
  }
  const oldRevision = target.versions.at(-1)!.revision;
  Object.assign(target, source, {
    versions: [...target.versions, { ...version, revision: oldRevision + 1 }],
  });
  for (const e of p.evidence.filter((e) => e.sourceId === target.id))
    e.verificationStatus = 'needs-review';
  const oldIds = new Set(
    p.evidence.filter((e) => e.sourceId === target.id).map((e) => e.evidenceId),
  );
  for (const f of p.findings.filter(
    (f) => f.evidenceIds.some((id) => oldIds.has(id)) && f.status !== 'excluded',
  )) {
    f.status = 'review';
    f.revision++;
  }
  if (p.overview.evidenceIds.some((id) => oldIds.has(id))) {
    p.overviewConfirmed = false;
    p.overviewRevision++;
  }
  p.evidence.push(...textEvidence(target, target.versions.at(-1)!));
  return touchExploration(p, `修订来源「${target.title}」，历史证据保留，相关结论需复核`);
}
export function removeSource(project: Exploration, sourceId: string) {
  const p = structuredClone(project);
  const source = p.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('来源不存在');
  source.removed = true;
  const ids = new Set(p.evidence.filter((e) => e.sourceId === sourceId).map((e) => e.evidenceId));
  for (const f of p.findings.filter(
    (f) => f.evidenceIds.some((id) => ids.has(id)) && f.status !== 'excluded',
  )) {
    f.status = 'review';
    f.revision++;
  }
  if (p.overview.evidenceIds.some((id) => ids.has(id))) {
    p.overviewConfirmed = false;
    p.overviewRevision++;
  }
  return touchExploration(p, `移除来源「${source.title}」，保留历史及原始附件`);
}
export function semanticSignature(p: Exploration) {
  return JSON.stringify([
    p.mode,
    p.sources.map((s) => [
      s.id,
      s.versions.at(-1)?.revision,
      s.removed,
      s.status,
      s.purpose,
      s.borrow,
      s.avoid,
      s.referencePurpose,
    ]),
    p.evidence.map((e) => [e.evidenceId, e.excerpt, e.location, e.verificationStatus]),
    p.findings.map((f) => [f.id, f.revision, f.locked]),
    p.overviewRevision,
    p.overviewConfirmed,
    p.questions,
  ]);
}
export function validateAnalysis(
  project: Pick<Exploration, 'sources' | 'evidence'>,
  raw: unknown,
): AnalysisOutput {
  const output = analysisOutputSchema.parse(raw);
  const errors: AnalysisValidationError[] = [];
  function recordIssue(code: string, path: string, message: string) {
    errors.push(new AnalysisValidationError(code, path, message));
  }
  const valid = new Set(
    project.evidence.filter((e) => evidenceValid(project, e)).map((e) => e.evidenceId),
  );
  const keys = new Set(output.findings.map((f) => f.key));
  // Question option quality is isolated and repaired by the shared decision service.
  if (keys.size !== output.findings.length)
    recordIssue('DUPLICATE_FINDING', 'findings.key', '模型返回重复功能标识；每个key必须唯一。');
  const ids = [
    ...output.overview.evidenceIds,
    ...output.findings.flatMap((f) => f.evidenceIds),
    ...output.questions.flatMap((q) => q.evidenceIds),
  ];
  if (ids.some((id) => !valid.has(id)))
    recordIssue(
      'EVIDENCE_REFERENCE',
      'evidenceIds',
      '引用不存在、未定位或来源已变化，结果未采用；必须使用本次evidence.evidenceId，不能使用sourceId、段落ID或自行创建的ID。',
    );
  if (
    !output.overview.evidenceIds.length &&
    (['goal', 'problem', 'users', 'outcome', 'constraints'] as const).some(
      (field) => output.overview[field].trim() && !output.overview.inferredFields.includes(field),
    )
  )
    recordIssue(
      'OVERVIEW_INFERENCE',
      'overview.inferredFields',
      '无证据的概览字段必须标为推断或留空；非空字段须逐一列入inferredFields。',
    );
  for (const [index, f] of output.findings.entries()) {
    if (f.basis === 'inferred' && !f.uncertainty)
      f.uncertainty = '直接证据不足，本条为推断，需用户进一步核实。';
    if (f.basis !== 'inferred' && !f.evidenceIds.length)
      recordIssue(
        'FINDING_EVIDENCE',
        `findings[${index}].evidenceIds`,
        '非推断结论缺少可验证证据；缺少直接依据时应标inferred，不能补造引用。',
      );
    const supporting = project.evidence.filter((e) => f.evidenceIds.includes(e.evidenceId));
    if (f.basis === 'explicit' && !supporting.some((e) => e.evidenceType === 'user-description'))
      recordIssue(
        'EXPLICIT_EVIDENCE',
        `findings[${index}].basis`,
        '明确提出的需求缺少用户文字依据；网页观察不能替代用户决定。只有user-description可支持explicit，网页原文应按observed或inferred判断。',
      );
    if (
      f.kind === 'conflict' &&
      f.basis !== 'inferred' &&
      new Set(supporting.map((e) => e.sourceId).filter(Boolean)).size < 2
    )
      recordIssue(
        'CONFLICT_SOURCES',
        `findings[${index}].evidenceIds`,
        '来源冲突须关联双方来源；证据不足时应标为推断。',
      );
    if (f.parentKey && (!keys.has(f.parentKey) || f.parentKey === f.key))
      recordIssue(
        'PARENT_REFERENCE',
        `findings[${index}].parentKey`,
        '需求结构关联不合法；parentKey仅可引用本次其他finding.key，不使用旧结论ID。',
      );
    const seen = new Set<string>([f.key]);
    let key = f.parentKey;
    while (key) {
      if (seen.has(key)) {
        recordIssue(
          'PARENT_CYCLE',
          `findings[${index}].parentKey`,
          '需求结构存在循环；需要解除循环后重试。',
        );
        break;
      }
      seen.add(key);
      key = output.findings.find((v) => v.key === key)?.parentKey ?? null;
    }
  }
  if (output.questions.some((q) => q.findingKeys.some((key) => !keys.has(key))))
    recordIssue(
      'QUESTION_REFERENCE',
      'questions.findingKeys',
      '问题关联不存在的功能；findingKeys仅引用本次findings.key，无法关联时返回空数组。',
    );
  if (errors.length) {
    const first = errors[0].issues[0];
    throw new AnalysisValidationError(
      first.code,
      first.path,
      first.message,
      errors.slice(1).flatMap((e) => e.issues),
    );
  }
  return output;
}
export function applyAnalysis(
  project: Exploration,
  run: AnalysisRun,
  selectedKeys: string[],
  includeOverview: boolean,
) {
  if (run.applied || run.baseSignature !== semanticSignature(project))
    throw new Error('资料或人工编辑已经变化，此次草案已过期，请重新分析。');
  const output = validateAnalysis(project, run.output);
  const p = structuredClone(project);
  const keyToId = new Map<string, string>();
  for (const candidate of output.findings.filter((f) => selectedKeys.includes(f.key))) {
    const old = p.findings.find((f) => f.title === candidate.title && f.kind === candidate.kind);
    if (old?.locked) throw new Error('锁定结论不可更新');
    const finding: Finding = {
      ...candidate,
      id: old?.id ?? makeId(),
      revision: (old?.revision ?? 0) + 1,
      status: old ? 'review' : 'pending',
      locked: false,
      parentId: null,
      origin: 'ai',
      analysisMode: run.mode,
    };
    if (old) Object.assign(old, finding);
    else p.findings.push(finding);
    keyToId.set(candidate.key, finding.id);
  }
  for (const candidate of output.findings) {
    const item = p.findings.find((f) => f.id === keyToId.get(candidate.key));
    if (item)
      item.parentId = candidate.parentKey ? (keyToId.get(candidate.parentKey) ?? null) : null;
  }
  if (includeOverview) {
    p.overview = output.overview;
    p.overviewConfirmed = false;
    p.overviewRevision++;
    p.overviewMode = run.mode;
  }
  for (const q of output.questions)
    p.questions = appendGeneratedDecision(
      p.questions,
      {
        ...q,
        id: makeId(),
        findingIds: q.findingKeys.flatMap((key) => (keyToId.has(key) ? [keyToId.get(key)!] : [])),
        status: 'open',
        answer: '',
      },
      p.id,
    );
  p.questions = reconcileDecisions(p.questions, p.id);
  const savedRun = p.runs.find((r) => r.id === run.id);
  if (savedRun) savedRun.applied = true;
  return touchExploration(p, '人工选择采纳分析草案；结论仍待逐项确认');
}
export function changeFinding(project: Exploration, findingId: string, patch: Partial<Finding>) {
  const p = structuredClone(project);
  const f = p.findings.find((f) => f.id === findingId);
  if (!f) throw new Error('结论不存在');
  if (f.locked && Object.keys(patch).some((key) => key !== 'locked'))
    throw new Error('请先解锁该结论');
  if (
    patch.status === 'confirmed' &&
    f.basis !== 'inferred' &&
    (!f.evidenceIds.length ||
      f.evidenceIds.some(
        (id) => !p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e)),
      ))
  )
    throw new Error('先校验证据或标记为推断，再确认。');
  if (patch.status === 'confirmed' && f.basis === 'excluded')
    patch = { ...patch, status: 'excluded' };
  Object.assign(f, patch);
  if (f.parentId) {
    const seen = new Set([f.id]);
    let cursor: string | null = f.parentId;
    while (cursor) {
      if (seen.has(cursor)) throw new Error('关系不能形成循环。');
      seen.add(cursor);
      const parent = p.findings.find((v) => v.id === cursor);
      if (!parent) throw new Error('父节点不存在。');
      cursor = parent.parentId;
    }
  }
  f.revision++;
  if (!patch.status && patch.locked === undefined && f.status === 'confirmed') f.status = 'review';
  return touchExploration(
    recordResearchChange(project, p, `人工调整「${f.title}」`),
    `人工${patch.status === 'confirmed' ? '确认' : patch.status === 'excluded' ? '排除' : '调整'}「${f.title}」`,
  );
}
export function snapshotIssues(p: Exploration) {
  const issues: string[] = [];
  if (!p.overviewConfirmed) issues.push('请先确认产品概览');
  if (!p.findings.some((f) => f.kind === 'feature' && f.status === 'confirmed'))
    issues.push('至少确认一项功能');
  if (
    p.findings.some(
      (f) =>
        f.kind === 'conflict' &&
        f.priority === 'high' &&
        !['confirmed', 'excluded'].includes(f.status),
    )
  )
    issues.push('存在尚未处理的高优先级来源冲突');
  const ids = [
    ...p.overview.evidenceIds,
    ...p.findings.filter((f) => f.status === 'confirmed').flatMap((f) => f.evidenceIds),
  ];
  if (ids.some((id) => !p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e))))
    issues.push('已确认内容引用了失效证据');
  return issues;
}
export function createSnapshot(
  p: Exploration,
  kind: Snapshot['kind'],
  availableAssets?: Set<string>,
): Snapshot {
  if (p.lab) {
    p = synchronizeLab(p);
    assertLab(p);
  }
  const issues = snapshotIssues(p);
  if (kind === 'confirmed' && issues.length) throw new Error(issues.join('；'));
  const mode =
    p.mode === 'example' ||
    p.overviewMode === 'example' ||
    p.findings.some(
      (f) =>
        f.analysisMode === 'example' &&
        (kind === 'draft' || ['confirmed', 'excluded'].includes(f.status)),
    )
      ? 'example'
      : 'real';
  const snapshotId = makeId();
  const parent = p.snapshots[0];
  return snapshotSchema.parse({
    format: 'product-requirements-snapshot',
    schemaVersion: 1,
    snapshotId,
    explorationId: p.id,
    version: Math.max(0, ...p.snapshots.map((s) => s.version)) + 1,
    title: p.title,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    lineage: {
      rootSnapshotId:
        p.lineageRootId ?? parent?.lineage?.rootSnapshotId ?? parent?.snapshotId ?? snapshotId,
      parentSnapshotId: parent?.snapshotId ?? p.baseSnapshotId ?? null,
      copiedFromSnapshotId: p.copiedFromSnapshotId ?? null,
    },
    research: captureResearch(p, availableAssets),
    mode,
    kind,
    overview: structuredClone(p.overview),
    findings: structuredClone(
      kind === 'confirmed'
        ? p.findings.filter((f) => ['confirmed', 'excluded'].includes(f.status))
        : p.findings,
    ),
    questions: structuredClone(p.questions),
    sources: structuredClone(p.sources),
    evidence: structuredClone(p.evidence),
  });
}
export function snapshotMarkdown(s: Snapshot) {
  const badge =
    s.mode === 'example'
      ? '演示数据，非真实AI分析'
      : '真实模式资料整理，已经人工选择确认；仍需结合实际核实';
  return `# ${s.title} · 需求快照 V${s.version}\n\n> ${s.research?.demo ? '示例项目｜虚构材料｜' + (s.mode === 'example' ? '预置分析结果' : '真实AI重分析') + '\n> ' : ''}${badge}\n> ${s.kind === 'confirmed' ? '已确认快照；仅作为岗位分析输入，不授予任何岗位确认状态。' : '草案快照，不可导入为已确认需求。'}\n\n## 产品概览\n\n${Object.entries(
    {
      目标: s.overview.goal,
      问题: s.overview.problem,
      用户: s.overview.users,
      结果: s.overview.outcome,
      约束: s.overview.constraints,
    },
  )
    .map(([k, v]) => `- ${k}：${v || '待补充'}`)
    .join(
      '\n',
    )}\n\n## 人工确认的需求与排除项\n\n${s.findings.map((f) => `### ${f.title}\n\n${f.description}\n\n行为：${f.behavior || '待补充'}\n\n预期：${f.outcome || '待补充'}\n\n状态：${f.status}；依据类型：${f.basis}；阶段：${f.phase}；证据：${f.evidenceIds.join(', ') || '无直接证据，推断待核实'}`).join('\n\n')}\n\n## 待核实问题\n\n${s.questions.map((q) => `- ${q.title}（${q.status}）：${q.answer || q.detail}`).join('\n') || '暂无记录'}\n\n## 证据与来源\n\n${s.evidence
    .filter(
      (e) =>
        s.findings.some((f) => f.evidenceIds.includes(e.evidenceId)) ||
        s.overview.evidenceIds.includes(e.evidenceId),
    )
    .map(
      (e) =>
        `- [${e.evidenceId}] ${e.title}，来源 ${e.sourceId} v${e.sourceRevision}；位置 ${JSON.stringify(e.location)}\n  原文 / 人工说明：${e.excerpt}`,
    )
    .join(
      '\n',
    )}\n\n${s.sources.map((source) => `- ${source.id}：${source.title} v${source.versions.at(-1)!.revision} ${source.versions.at(-1)!.normalizedUrl ?? ''}`).join('\n')}\n\n快照ID：${s.snapshotId}\n`;
}
export function compareSnapshots(before: Snapshot, after: Snapshot) {
  const a = before.research?.lab,
    b = after.research?.lab;
  const oldFindings = fullSnapshotFindings(before);
  const newFindings = fullSnapshotFindings(after);
  const previous = new Map(oldFindings.map((f) => [f.id, f]));
  return {
    added: newFindings.filter((f) => !previous.has(f.id)),
    removed: oldFindings.filter((f) => !newFindings.some((n) => n.id === f.id)),
    changed: newFindings.flatMap((f) => {
      const old = previous.get(f.id);
      return old && JSON.stringify(old) !== JSON.stringify(f) ? [{ before: old, after: f }] : [];
    }),
    overviewChanged: JSON.stringify(before.overview) !== JSON.stringify(after.overview),
    boardChanges: Object.fromEntries(
      (['nodes', 'edges', 'annotations', 'solutions', 'requirements'] as const).map((key) => {
        const left = a?.[key] ?? [],
          right = b?.[key] ?? [];
        return [
          key,
          {
            added: right.filter((r) => !left.some((l) => l.id === r.id)).length,
            removed: left.filter((l) => !right.some((r) => r.id === l.id)).length,
            changed: right.filter((r) =>
              left.some((l) => l.id === r.id && JSON.stringify(l) !== JSON.stringify(r)),
            ).length,
          },
        ];
      }),
    ),
  };
}
