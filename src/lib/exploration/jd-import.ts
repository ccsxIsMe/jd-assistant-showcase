import { snapshotSchema, type Snapshot } from './model';
import { snapshotMarkdown, evidenceValid } from './domain';
import { now, uid, type Source } from '../workbench/model';
export function snapshotSources(raw: Snapshot): Source[] {
  const snapshot = snapshotSchema.parse(raw);
  if (snapshot.kind !== 'confirmed')
    throw new Error('草案快照不可导入岗位，请先人工确认后生成已确认快照。');
  if (
    snapshot.findings.some((f) => !['confirmed', 'excluded'].includes(f.status)) ||
    !snapshot.findings.some((f) => f.kind === 'feature' && f.status === 'confirmed')
  )
    throw new Error('快照缺少已确认功能或包含未确认内容。');
  const referenced = [
    ...snapshot.overview.evidenceIds,
    ...snapshot.findings.filter((f) => f.status === 'confirmed').flatMap((f) => f.evidenceIds),
  ];
  if (
    referenced.some(
      (id) => !snapshot.evidence.some((e) => e.evidenceId === id && evidenceValid(snapshot, e)),
    )
  )
    throw new Error('快照包含失效或伪造引用，不能导入岗位。');
  const markdown = snapshotMarkdown(snapshot);
  const parts: string[] = [];
  for (let pos = 0; pos < markdown.length; pos += 28000)
    parts.push(markdown.slice(pos, pos + 28000));
  if (parts.length > 30) throw new Error('快照过大，请缩小确认范围。');
  return parts.map((text, index) => ({
    id: uid(),
    title: `${snapshot.title.slice(0, 145)} · 需求快照V${snapshot.version}${parts.length > 1 ? ` (${index + 1}/${parts.length})` : ''}`,
    type: 'project',
    person: '用户主动导入的产品探索快照；岗位任务与能力要求仍待确认',
    createdAt: now(),
    removed: false,
    versions: [
      {
        revision: 1,
        text: `> ${snapshot.mode === 'example' ? '演示数据，非真实AI分析' : '真实模式需求快照，仍需人工核实'}\n> 导入仅添加岗位输入资料；功能需求不等于岗位能力条件。\n\n${text}`,
        createdAt: now(),
      },
    ],
    snapshotOrigin: {
      snapshotId: snapshot.snapshotId,
      explorationId: snapshot.explorationId,
      version: snapshot.version,
      mode: snapshot.mode,
      title: snapshot.title,
      createdAt: snapshot.createdAt,
      evidenceIds: referenced,
      sources: snapshot.sources.map((s) => ({
        id: s.id,
        title: s.title,
        revision: s.versions.at(-1)!.revision,
        url: s.versions.at(-1)!.normalizedUrl ?? '',
      })),
    },
  }));
}
