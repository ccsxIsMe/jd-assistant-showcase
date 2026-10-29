import {
  makeId,
  newExploration,
  timestamp,
  type Exploration,
  type Snapshot,
  type SourceVersion,
  type Evidence,
  type ResearchState,
} from './model';
import { rebindLabProject } from '../lab/graph';
export const PARSER_VERSIONS = {
  web: 'public-html@1.0.0',
  cheerio: '1.2.0',
  pdfjs: '6.4.299',
  mammoth: '1.13.0',
  materials: 'materials@1.0.0',
  evidence: 'evidence@1.0.0',
};
/** 业务研究变更指纹排除 lab.ui；画布筛选等视图变化不代表研究结论变化。 */
export function researchSignature(p: Exploration) {
  const text = JSON.stringify([
    p.title,
    p.initialObjective,
    p.mode,
    p.sources,
    p.evidence,
    p.findings,
    p.overview,
    p.overviewConfirmed,
    p.questions,
    p.runs,
    p.operations,
    p.lab ? Object.fromEntries(Object.entries(p.lab).filter(([key]) => key !== 'ui')) : undefined,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `research-${text.length}-${(hash >>> 0).toString(16)}`;
}
export function assetReferences(value: {
  sources: { versions: SourceVersion[] }[];
  evidence: Evidence[];
  operations?: Exploration['operations'];
  research?: ResearchState;
}) {
  const records = [value, ...(value.research ? [value.research] : [])];
  const parts = records.flatMap((record) => [
    record,
    ...(record.operations ?? []).flatMap((op) => [op.before, op.after]),
  ]);
  return [
    ...new Set(
      parts.flatMap((record) => [
        ...record.sources.flatMap((s) => s.versions.flatMap((v) => (v.assetId ? [v.assetId] : []))),
        ...record.evidence.flatMap((e) =>
          e.location.kind === 'video' && e.location.frameAssetId ? [e.location.frameAssetId] : [],
        ),
      ]),
    ),
  ];
}
/** 深拷贝可回看的研究状态；附件仅保存引用及缺失说明，不复制二进制到每个快照。 */
export function captureResearch(p: Exploration, availableAssets?: Set<string>): ResearchState {
  const assetIds = assetReferences(p);
  const missing = availableAssets ? assetIds.filter((id) => !availableAssets.has(id)) : assetIds;
  const limitations = p.sources
    .filter((s) => s.kind === 'url')
    .map(
      (s) => `${s.title}：保留实际取得的静态正文；没有自动网页截图、动态页面或访问受限内容归档。`,
    );
  if (missing.length)
    limitations.push(
      availableAssets
        ? `${missing.length}份原始附件当前缺失，保留文件名及定位信息，不能宣称完整归档。`
        : '保存时未验证附件完整性；文件仍通过本机附件ID引用。',
    );
  if (p.sources.some((s) => s.status === 'error' || s.status === 'partial'))
    limitations.push('部分来源解析失败或不完整，状态与错误原样保留，不把它们视作成功解析。');
  if (!p.operations?.length && p.activity.length)
    limitations.push(
      '此前版本未保存独立的结构化修改记录；已有活动记录和原始分析保留，未保存的更早过程无法补造。',
    );
  return structuredClone({
    ...(p.demo ? { demo: p.demo } : {}),
    originalObjective:
      p.initialObjective ?? p.sources.find((s) => s.kind === 'text')?.versions[0].text ?? '',
    capturedRevision: p.revision,
    signature: researchSignature(p),
    overview: p.overview,
    overviewConfirmed: p.overviewConfirmed,
    overviewRevision: p.overviewRevision,
    overviewMode: p.overviewMode,
    findings: p.findings,
    sources: p.sources,
    evidence: p.evidence,
    questions: p.questions,
    runs: p.runs,
    operations: p.operations ?? [],
    activity: p.activity,
    transfers: p.transfers ?? [],
    parserVersions: PARSER_VERSIONS,
    ...(p.lab ? { lab: p.lab } : {}),
    archive: { assetIds, missingAssetIds: missing, limitations },
  });
}
export function fullResearch(snapshot: Snapshot): ResearchState {
  if (snapshot.research) return structuredClone(snapshot.research);
  return {
    originalObjective: snapshot.sources.find((s) => s.kind === 'text')?.versions[0]?.text ?? '',
    capturedRevision: 1,
    signature: 'legacy-not-recorded',
    overview: snapshot.overview,
    overviewConfirmed: snapshot.kind === 'confirmed',
    overviewRevision: 1,
    overviewMode: snapshot.mode,
    findings: snapshot.findings,
    sources: snapshot.sources,
    evidence: snapshot.evidence,
    questions: snapshot.questions,
    runs: [],
    operations: [],
    activity: [],
    transfers: [],
    parserVersions: { legacy: '未记录' },
    archive: {
      assetIds: assetReferences(snapshot),
      missingAssetIds: [],
      limitations: [
        '旧格式快照未保存完整分析与结构化修改历史；仅可恢复实际保存的内容，不补造历史。',
      ],
    },
  };
}
/** 基于快照派生新草稿并重绑所属项目；历史内容不原地修改，旧模型请求不恢复。 */
export function forkResearch(snapshot: Snapshot, title: string, independent = false): Exploration {
  const state = fullResearch(snapshot);
  const p = newExploration(title.trim() || snapshot.title);
  Object.assign(
    p,
    structuredClone({
      initialObjective: state.originalObjective,
      ...(state.demo ? { demo: state.demo } : {}),
      mode: snapshot.mode,
      sources: state.sources,
      evidence: state.evidence,
      findings: state.findings,
      overview: state.overview,
      overviewConfirmed: state.overviewConfirmed,
      overviewRevision: state.overviewRevision,
      overviewMode: state.overviewMode,
      questions: state.questions,
      runs: state.runs,
      operations: state.operations,
      ...(state.lab ? { lab: rebindLabProject(structuredClone(state.lab), p.id) } : {}),
    }),
  );
  for (const op of p.operations ?? [])
    for (const patch of [op.before, op.after])
      if (patch.lab)
        for (const key of ['nodes', 'edges', 'annotations', 'solutions', 'requirements'] as const)
          for (const item of patch.lab[key]) item.projectId = p.id;
  if (p.lab)
    for (const run of p.lab.runs)
      if (run.status === 'running' || run.status === 'queued') {
        run.status = 'cancelled';
        run.errorCode = 'DRAFT_FORKED';
        run.errorMessage = '新草稿不会恢复旧模型请求，请重新启动需要的阶段。';
        run.completedAt = timestamp();
      }
  if (independent) p.copiedFromSnapshotId = snapshot.snapshotId;
  else {
    p.baseSnapshotId = snapshot.snapshotId;
    p.lineageRootId = snapshot.lineage?.rootSnapshotId ?? snapshot.snapshotId;
  }
  p.activity = [
    {
      id: makeId(),
      text: independent
        ? `复制自快照${snapshot.snapshotId}，独立修改，不改变原研究`
        : `基于快照${snapshot.snapshotId}继续研究，保留父版本关联`,
      at: timestamp(),
    },
    ...state.activity,
  ].slice(0, 300);
  p.ui.sourceId = p.sources.find((s) => !s.removed)?.id ?? null;
  return p;
}
export function fullSnapshotFindings(snapshot: Snapshot) {
  return snapshot.research?.findings ?? snapshot.findings;
}
