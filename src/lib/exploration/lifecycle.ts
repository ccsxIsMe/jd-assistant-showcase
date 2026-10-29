import { explorationSchema, timestamp, type Exploration } from './model';

export function changeProjectTrash(
  project: Exploration,
  expectedRevision: number,
  trashed: boolean,
  at = timestamp(),
): Exploration {
  if (project.revision !== expectedRevision)
    throw new Error('探索已在其他页面更新；请刷新列表，核对最新内容后再操作。');
  if (!!project.trashedAt === trashed)
    throw new Error(trashed ? '探索已经在回收站中。' : '探索已经恢复。');
  const next = structuredClone(project);
  next.trashedAt = trashed ? at : null;
  next.updatedAt = at;
  next.revision++;
  if (trashed) {
    for (const run of next.lab?.runs ?? [])
      if (run.status === 'running' || run.status === 'queued') {
        run.status = 'cancelled';
        run.completedAt = at;
        run.errorCode = 'PROJECT_TRASHED';
        run.errorMessage = '探索已移至回收站，分析结果不再写入。';
      }
  }
  return explorationSchema.parse(next);
}

export function validateProjectSave(project: Exploration, stored: Exploration | null) {
  if (stored?.trashedAt || project.trashedAt)
    throw new Error('探索已在回收站中，未写入迟到修改；请先恢复探索。');
  if (stored && stored.revision > project.revision)
    throw new Error('已有更新版本，未覆盖其他页面的修改；请重新打开探索。');
  return explorationSchema.parse(project);
}
