'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { explorationStore } from '@/lib/exploration/storage';
import { fullResearch, researchSignature } from '@/lib/exploration/research';
import { sourceKindNames, type Exploration, type Snapshot } from '@/lib/exploration/model';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
export function ResearchHistory({ projectId }: { projectId?: string }) {
  const [projects, setProjects] = useState<Exploration[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('new');
  const [deleting, setDeleting] = useState<{ project: Exploration; snapshot: Snapshot } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    explorationStore
      .list()
      .then((rows) =>
        setProjects(rows.filter((p) => !p.trashedAt && (!projectId || p.id === projectId))),
      )
      .catch(() => setError('研究历史读取失败，已有记录未修改。'))
      .finally(() => setLoaded(true));
  }, [projectId]);
  const rows = projects.flatMap((project) =>
    project.snapshots.map((snapshot) => {
      const r = fullResearch(snapshot);
      const transfers =
        project.transfers?.filter((e) => e.snapshotId === snapshot.snapshotId) ?? [];
      const imported = transfers.some((e) =>
        ['workbench-import', 'upstream-sync'].includes(e.kind),
      );
      const state = imported
        ? 'imported'
        : snapshot.kind === 'draft'
          ? 'draft'
          : r.findings.some((f) => ['pending', 'review'].includes(f.status))
            ? 'pending'
            : 'saved';
      return {
        project,
        snapshot,
        research: r,
        state,
        updatedAt: [snapshot.updatedAt ?? snapshot.createdAt, ...transfers.map((e) => e.at)]
          .sort()
          .at(-1)!,
      };
    }),
  );
  const visible = rows
    .filter(
      (r) =>
        r.snapshot.title.toLowerCase().includes(query.toLowerCase()) &&
        (status === 'all' || r.state === status),
    )
    .sort((a, b) =>
      sort === 'new'
        ? b.updatedAt.localeCompare(a.updatedAt)
        : a.updatedAt.localeCompare(b.updatedAt),
    );
  async function remove() {
    if (!deleting || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await explorationStore.deleteSnapshot(
        deleting.project.id,
        deleting.snapshot.snapshotId,
      );
      setProjects((rows) =>
        rows.map((p) =>
          p.id === deleting.project.id
            ? {
                ...p,
                snapshots: p.snapshots.filter((s) => s.snapshotId !== deleting.snapshot.snapshotId),
              }
            : p,
        ),
      );
      setDeleting(null);
      setNotice(
        `已删除所选快照，清理${result.deletedAssets}份独占附件；共享资料与电脑中已导出的文件保持不变。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败，原数据保留');
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="explore-history">
      <Link href={projectId ? `/lab/${projectId}` : '/lab'} className="explore-back">
        ← 返回需求实验室
      </Link>
      <div className="explore-section-heading">
        <div>
          <h1>研究历史</h1>
          <Link className="example-link" href="/examples?stage=history">
            体验软件工程师历史示例 ↗
          </Link>
          <p>
            恢复保存时的资料、证据、分析与人工记录。自动保存的工作状态和手动保存的研究快照分别显示。
          </p>
        </div>
      </div>
      <div className="research-history-filters">
        <label>
          搜索研究标题
          <input
            className="field"
            aria-label="搜索研究历史"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          状态
          <select
            className="field"
            aria-label="研究历史状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="saved">已保存</option>
            <option value="pending">待确认</option>
            <option value="imported">已导入</option>
          </select>
        </label>
        <label>
          更新时间
          <select
            className="field"
            aria-label="研究历史排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="new">最近更新优先</option>
            <option value="old">较早更新优先</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="callout error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="callout">
          {notice}
        </p>
      )}
      {!loaded ? (
        <p role="status">正在读取研究历史…</p>
      ) : (
        <>
          <div className="snapshot-history-list">
            {visible.map((row) => (
              <article
                className="research-history-card"
                key={row.snapshot.snapshotId}
                data-testid="research-history-card"
              >
                <Link data-snapshot-link href={`/explore/snapshots/${row.snapshot.snapshotId}`}>
                  <span>V{row.snapshot.version}</span>
                  <h2>{row.snapshot.title}</h2>
                  <p>
                    {(
                      row.research.overview.goal ||
                      row.research.originalObjective ||
                      '尚未填写研究目标'
                    ).slice(0, 180)}
                  </p>
                  <small>
                    {[...new Set(row.research.sources.map((s) => sourceKindNames[s.kind]))].join(
                      ' · ',
                    ) || '尚无资料'}{' '}
                    · {row.research.sources.length}份来源 · {row.research.evidence.length}条证据
                  </small>
                  <p>
                    {
                      { draft: '草稿', saved: '已保存', pending: '待确认', imported: '已导入' }[
                        row.state
                      ]
                    }{' '}
                    · {row.snapshot.mode === 'example' ? '演示数据，非真实AI分析' : '真实模式'} ·
                    最近更新 {new Date(row.updatedAt).toLocaleString('zh-CN')}
                  </p>
                  {row.project.snapshots[0]?.snapshotId === row.snapshot.snapshotId &&
                    row.snapshot.research?.signature !== researchSignature(row.project) && (
                      <b className="warning-text">当前研究有尚未保存到快照的修改</b>
                    )}
                </Link>
                <div className="explore-inline-actions">
                  <Link href={`/explore/${row.project.id}`}>继续当前研究</Link>
                  <button
                    onClick={() => setDeleting({ project: row.project, snapshot: row.snapshot })}
                  >
                    删除此快照
                  </button>
                </div>
              </article>
            ))}
          </div>
          {projects
            .filter(
              (p) =>
                !p.snapshots.length && p.title.includes(query) && ['all', 'draft'].includes(status),
            )
            .map((p) => (
              <article className="research-history-card" key={p.id}>
                <Link href={`/explore/${p.id}`}>
                  <h2>{p.title}</h2>
                  <p>{p.overview.goal || p.initialObjective || '草稿研究，尚未保存快照'}</p>
                  <small>
                    {p.sources.length}份来源 · {p.evidence.length}条证据 ·{' '}
                    {new Date(p.updatedAt).toLocaleString('zh-CN')}
                  </small>
                  <p>草稿 · 已自动保存在本机 · 尚无手动快照版本</p>
                </Link>
              </article>
            ))}
          {!visible.length &&
            !projects.some(
              (p) =>
                !p.snapshots.length && p.title.includes(query) && ['all', 'draft'].includes(status),
            ) && (
              <div className="explore-empty">
                <h3>{query || status !== 'all' ? '没有符合条件的研究' : '还没有研究记录'}</h3>
                <p>从新建探索开始，保存快照后可在这里恢复与比较。</p>
                <Link href="/explore">新建探索 →</Link>
              </div>
            )}
        </>
      )}
      {deleting && (
        <Modal
          title="删除研究快照"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            将删除“{deleting.snapshot.title} · V{deleting.snapshot.version}
            ”的本机快照及专属数据。其他快照、派生研究和岗位仍在使用的附件会保留。
          </p>
          <p className="callout warning">电脑中已导出的JSON、Markdown或备份文件不会自动删除。</p>
          <div className="modal-actions">
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              保留快照
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              {busy ? '正在检查引用…' : '确认删除研究快照'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
