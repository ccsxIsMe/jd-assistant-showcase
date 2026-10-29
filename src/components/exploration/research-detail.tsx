'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { explorationStore } from '@/lib/exploration/storage';
import { fullResearch, forkResearch, researchSignature } from '@/lib/exploration/research';
import { compareSnapshots, createSnapshot, snapshotMarkdown } from '@/lib/exploration/domain';
import { materialFromSnapshot } from '@/lib/exploration/material';
import { exportPackage } from '@/lib/exploration/portable';
import {
  basisNames,
  findingKindNames,
  makeId,
  timestamp,
  type Exploration,
  type Snapshot,
} from '@/lib/exploration/model';
import { downloadText } from '../workbench/version-dialog';
import { Button } from '../ui/button';
import { Modal } from '../workbench/modal';
import { SnapshotImport } from './snapshot-import';
import { ArchivedEvidence } from './archived-evidence';
const statusNames = {
  pending: '待确认',
  confirmed: '已确认',
  excluded: '已排除',
  review: '需复核',
};
export function ResearchDetail({ id }: { id: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<{ project: Exploration; snapshot: Snapshot }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [compareId, setCompareId] = useState('');
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [fork, setFork] = useState<'derive' | 'copy' | null>(null);
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState('requirements');
  const [evidence, setEvidence] = useState<{ evidenceId?: string; sourceId?: string }>({});
  useEffect(() => {
    explorationStore
      .snapshots()
      .then(setRows)
      .catch(() => setError('研究快照读取失败'))
      .finally(() => setLoaded(true));
  }, []);
  const row = rows.find((r) => r.snapshot.snapshotId === id);
  const s = row?.snapshot;
  const r = s ? fullResearch(s) : null;
  const previous = rows.find((r) => r.snapshot.snapshotId === compareId)?.snapshot;
  const diff = s && previous ? compareSnapshots(previous, s) : null;
  async function exportData(kind: 'archive' | 'material') {
    if (!row || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      const content =
        kind === 'archive'
          ? await exportPackage(row.snapshot)
          : JSON.stringify(materialFromSnapshot(row.snapshot), null, 2);
      downloadText(
        `${row.snapshot.title}-V${row.snapshot.version}-${kind === 'archive' ? '完整研究快照' : '产品需求资料'}.json`,
        content,
        'application/json',
      );
      await explorationStore.recordTransfer(row.project.id, {
        id: makeId(),
        snapshotId: id,
        kind: kind === 'archive' ? 'archive-export' : 'material-export',
        version: row.snapshot.version,
        at: timestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，原快照保持不变。');
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function createFork() {
    if (!s || !fork || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      const p = forkResearch(s, title, fork === 'copy');
      if (fork === 'copy')
        p.snapshots.push(
          createSnapshot(
            p,
            s.kind,
            new Set(r!.archive.assetIds.filter((id) => !r!.archive.missingAssetIds.includes(id))),
          ),
        );
      await explorationStore.save(p);
      router.push(`/explore/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建版本失败');
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  function showEvidence(evidenceId: string) {
    setEvidence({ evidenceId });
    setTab('evidence');
  }
  if (!loaded) return <p role="status">正在恢复保存的研究内容…</p>;
  if (!row || !s || !r)
    return (
      <div className="explore-empty">
        <p role="alert">{error || '本机未找到此快照，可能已删除或尚未导入。'}</p>
        <Link href="/explore/history">返回研究历史</Link>
      </div>
    );
  const family = s.lineage?.rootSnapshotId ?? s.snapshotId;
  const hasNewer = rows.some(
    (v) =>
      (v.snapshot.lineage?.rootSnapshotId ?? v.snapshot.snapshotId) === family &&
      v.snapshot.version > s.version,
  );
  return (
    <article className="snapshot-detail">
      <Link href="/explore/history" className="explore-back">
        ← 研究历史
      </Link>
      <div className="explore-section-heading">
        <div>
          <span className="explore-eyebrow">RESEARCH SNAPSHOT · V{s.version}</span>
          <h1>{s.title}</h1>
          <p>
            创建 {new Date(s.createdAt).toLocaleString('zh-CN')} · 更新{' '}
            {new Date(s.updatedAt ?? s.createdAt).toLocaleString('zh-CN')} ·{' '}
            {s.kind === 'confirmed' ? '已确认需求范围' : '研究草稿'}
          </p>
          <small>快照ID：{s.snapshotId}</small>
        </div>
        <Link href={`/explore/${row.project.id}`}>返回探索工作区</Link>
        {s.research?.lab && <Link href={`/lab/snapshots/${s.snapshotId}`}>证据板回看此版本</Link>}
      </div>
      <p className="callout">
        {s.mode === 'example' ? '演示数据，非真实AI分析。' : '真实模式研究资料，结论仍需人工核实。'}
        完整研究过程与可导入需求分别保存；岗位候选不会自动确认。
      </p>
      <div className="explore-inline-actions">
        <Button
          disabled={busy}
          onClick={() => {
            setFork('derive');
            setTitle(`${s.title} · 继续研究`);
          }}
        >
          基于当前快照继续研究
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setFork('copy');
            setTitle(`${s.title} · 独立副本`);
          }}
        >
          复制快照
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void exportData('archive')}>
          导出JSON快照
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void exportData('material')}>
          导出产品需求资料
        </Button>
        <Button
          variant="outline"
          onClick={() => downloadText(`${s.title}-V${s.version}.md`, snapshotMarkdown(s))}
        >
          下载Markdown
        </Button>
        <Button
          disabled={
            busy || !r.findings.some((f) => f.kind === 'feature' && f.status !== 'excluded')
          }
          onClick={() => setImporting(true)}
        >
          导入岗位工作台
        </Button>
      </div>
      <p className="muted">
        派生会建立有父版本的新研究；复制会建立独立副本。重新分析、刷新来源和编辑均在新状态中进行，不改写此快照。
        {hasNewer ? ' 此研究已有后续版本。' : ''}
        {row.project.snapshots[0]?.snapshotId === id &&
        s.research?.signature !== researchSignature(row.project)
          ? ' 当前工作状态还有未保存到此快照的修改。'
          : ''}
      </p>
      {s.lineage?.parentSnapshotId && (
        <p>
          父版本：
          <Link href={`/explore/snapshots/${s.lineage.parentSnapshotId}`}>
            {s.lineage.parentSnapshotId}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="callout error">
          {error}
        </p>
      )}
      <section className="snapshot-comparison">
        <h2>版本比较</h2>
        <label>
          对照保存的版本
          <select
            className="field"
            aria-label="选择比较快照"
            value={compareId}
            onChange={(e) => setCompareId(e.target.value)}
          >
            <option value="">选择同一研究谱系中的版本</option>
            {rows
              .filter(
                (v) =>
                  v.snapshot.snapshotId !== id &&
                  (v.snapshot.lineage?.rootSnapshotId ?? v.snapshot.snapshotId) === family,
              )
              .map((v) => (
                <option key={v.snapshot.snapshotId} value={v.snapshot.snapshotId}>
                  V{v.snapshot.version} · {v.snapshot.kind === 'confirmed' ? '已确认' : '草案'}
                </option>
              ))}
          </select>
        </label>
        {diff && (
          <div data-testid="snapshot-diff">
            <p>
              新增 {diff.added.length} 项 · 移除 {diff.removed.length} 项 · 修改{' '}
              {diff.changed.length} 项 · 概览{diff.overviewChanged ? '有变化' : '未变化'}
              {s.research?.lab && (
                <span>
                  ；证据板{' '}
                  {Object.entries(diff.boardChanges)
                    .map(
                      ([key, count]) =>
                        `${({ nodes: '节点', edges: '关系', annotations: '标注', solutions: '方案', requirements: '要求' } as Record<string, string>)[key]} +${count.added}/−${count.removed}/修改${count.changed}`,
                    )
                    .join('；')}
                </span>
              )}
            </p>
            {diff.added.map((f) => (
              <p className="analysis-after" key={f.id}>
                新增：{f.title} — {f.description}
              </p>
            ))}
            {diff.removed.map((f) => (
              <p className="analysis-before" key={f.id}>
                移除：{f.title} — {f.description}
              </p>
            ))}
            {diff.changed.map((f) => (
              <div key={f.after.id}>
                <h3>{f.after.title}</h3>
                <p className="analysis-before">修改前：{f.before.description}</p>
                <p className="analysis-after">修改后：{f.after.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <nav className="research-detail-tabs" aria-label="保存的研究内容">
        {Object.entries({
          requirements: '需求与结构',
          evidence: '原始资料与证据',
          history: '分析与人工记录',
          transfers: '流转与版本标识',
        }).map(([key, label]) => (
          <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'requirements' && (
        <>
          <section>
            <h2>原始研究目标与输入</h2>
            <blockquote className="research-original-objective">
              {r.originalObjective || '旧记录未单列原始目标；请查看下方实际保存的原始来源。'}
            </blockquote>
            <p>产品目标：{r.overview.goal || '待补充'}</p>
            <p>目标用户：{r.overview.users || '待补充'}</p>
            <p>约束：{r.overview.constraints || '待补充'}</p>
          </section>
          <section>
            <h2>保存时的完整需求结构</h2>
            {r.findings.map((f) => (
              <article id={`snapshot-feature-${f.id}`} className="explore-finding-card" key={f.id}>
                <h3>{f.title}</h3>
                <small>
                  {findingKindNames[f.kind]} · {statusNames[f.status]} · {basisNames[f.basis]}
                </small>
                <p>{f.description}</p>
                <p>
                  行为：{f.behavior || '待补充'}；预期：{f.outcome || '待补充'}
                </p>
                {f.parentId && (
                  <p>父节点：{r.findings.find((v) => v.id === f.parentId)?.title ?? '未保存'}</p>
                )}
                {f.basis === 'inferred' && (
                  <p className="callout warning">
                    推断依据：{f.rationale || '未单列，需结合资料核实'}；不确定性：
                    {f.uncertainty || '没有直接证据，不能当作确定事实。'}
                  </p>
                )}
                <div className="finding-evidence-links">
                  {f.evidenceIds.map((id) => (
                    <button key={id} onClick={() => showEvidence(id)}>
                      查看 {r.evidence.find((e) => e.evidenceId === id)?.title ?? '缺失证据'}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </section>
          <section>
            <h2>问题与人工回答</h2>
            {r.questions.map((q) => (
              <div className="explore-question-card" key={q.id}>
                <h3>{q.title}</h3>
                <p>{q.detail}</p>
                <p>实际回答：{q.answer || '尚未回答'}</p>
                <small>
                  {q.status === 'answered'
                    ? '已回答'
                    : q.status === 'excluded'
                      ? '已排除'
                      : q.status === 'deferred'
                        ? '暂缓'
                        : '待确认'}
                </small>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === 'evidence' && (
        <section>
          <h2>来源、解析结果与证据</h2>
          <div className="research-source-manifest">
            {r.sources.map((source) => (
              <button
                key={source.id}
                onClick={() =>
                  setEvidence({
                    sourceId: source.id,
                    evidenceId: r.evidence.find((e) => e.sourceId === source.id)?.evidenceId,
                  })
                }
              >
                <b>{source.title}</b>
                <span>
                  {source.status === 'error'
                    ? '解析失败'
                    : source.status === 'partial'
                      ? '部分完成'
                      : '已保存'}{' '}
                  · {source.versions.length}个来源版本
                </span>
              </button>
            ))}
          </div>
          <div className="finding-evidence-links">
            {r.evidence.map((e) => (
              <button key={e.evidenceId} onClick={() => showEvidence(e.evidenceId)}>
                {e.title}
              </button>
            ))}
          </div>
          <ArchivedEvidence snapshot={s} {...evidence} />
          {r.archive.limitations.map((text, i) => (
            <p className="callout warning" key={i}>
              {text}
            </p>
          ))}
        </section>
      )}
      {tab === 'history' && (
        <section>
          <h2>AI分析与人工修改分开归档</h2>
          {r.runs.map((run) => (
            <details className="research-process-entry" key={run.id}>
              <summary>
                {new Date(run.at).toLocaleString('zh-CN')} ·{' '}
                {run.applied ? '已选择采纳的草案' : '未采纳 / 历史草案'} · {run.promptVersion}
              </summary>
              <p>请求编号：{run.requestId}</p>
              <p>
                模型：{run.modelConfig?.model ?? '旧记录未保存'}；配置标识：
                {run.modelConfig?.configurationId ?? '未记录'}
              </p>
              {run.output.findings.map((f) => (
                <div key={f.key}>
                  <b>{f.title}</b>
                  <p>{f.description}</p>
                  <p>
                    {f.rationale} {f.uncertainty}
                  </p>
                </div>
              ))}
            </details>
          ))}
          {!r.runs.length && <p>此快照没有保存模型分析记录，可能是纯人工研究或旧格式。</p>}
          <h3>结构化人工修改记录</h3>
          {r.operations.map((op) => (
            <details className="research-process-entry" key={op.id}>
              <summary>
                {op.label} · {op.undone ? '已撤销' : '已应用'} ·{' '}
                {new Date(op.at).toLocaleString('zh-CN')}
              </summary>
              <div className="analysis-before">
                修改前：
                {op.before.findings.map((f) => `${f.title}：${f.description}`).join('\n') ||
                  op.before.overview?.goal ||
                  `${op.before.sources.length}份来源、${op.before.evidence.length}条证据`}
              </div>
              <div className="analysis-after">
                修改后：
                {op.after.findings.map((f) => `${f.title}：${f.description}`).join('\n') ||
                  op.after.overview?.goal ||
                  `${op.after.sources.length}份来源、${op.after.evidence.length}条证据`}
              </div>
            </details>
          ))}
          <h3>保存时的活动记录</h3>
          {r.activity.map((a) => (
            <p key={a.id}>
              <time>{new Date(a.at).toLocaleString('zh-CN')}</time> · {a.text}
            </p>
          ))}
        </section>
      )}
      {tab === 'transfers' && (
        <section>
          <h2>解析器、提示词与流转版本</h2>
          <dl>
            {Object.entries(r.parserVersions).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            已归档分析提示词：
            {[...new Set(r.runs.map((run) => run.promptVersion))].join('、') || '未运行 / 未保存'}
          </p>
          <p>
            快照源版本：{s.version}；快照更新时间：{s.updatedAt ?? s.createdAt}
          </p>
          {(row.project.transfers ?? [])
            .filter((e) => e.snapshotId === id)
            .map((event) => (
              <p key={event.id}>
                {new Date(event.at).toLocaleString('zh-CN')} ·{' '}
                {
                  {
                    'archive-export': '导出完整研究',
                    'material-export': '导出产品需求资料',
                    'workbench-import': '导入岗位',
                    'upstream-sync': '岗位同步上游',
                  }[event.kind]
                }{' '}
                · 使用V{event.version}
                {event.workspaceId ? ` · 岗位工作区 ${event.workspaceId}` : ''}
              </p>
            ))}
          <p className="muted">这些标识不包含API Key，也不表示具有多人审批身份认证。</p>
        </section>
      )}
      {importing && <SnapshotImport snapshot={s} onClose={() => setImporting(false)} />}
      {fork && (
        <Modal
          title={fork === 'copy' ? '复制独立研究快照' : '从快照继续研究'}
          onClose={() => {
            if (!busy) setFork(null);
          }}
        >
          <label>
            新研究标题
            <input
              className="field"
              aria-label="新研究标题"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <p>新研究将恢复此快照保存的资料、证据和修改历史；原快照保持不变。</p>
          <div className="modal-actions">
            <Button disabled={busy || !title.trim()} onClick={() => void createFork()}>
              {fork === 'copy' ? '创建独立副本' : '创建派生研究'}
            </Button>
          </div>
        </Modal>
      )}
    </article>
  );
}
