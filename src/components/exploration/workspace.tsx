'use client';
import { currentDecisions } from '@/lib/decisions/records';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Compass,
  Download,
  History,
  LoaderCircle,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { useExploration } from '@/hooks/use-exploration';
import { TrashedProjectNotice } from './trashed-notice';
import { analysisRequestFor } from '@/lib/exploration/analysis';
import {
  applyAnalysis,
  changeFinding,
  createSnapshot,
  evidenceValid,
  removeSource,
  semanticSignature,
  snapshotIssues,
  sourceChanged,
  touchExploration,
  validateAnalysis,
} from '@/lib/exploration/domain';
import {
  basisNames,
  makeId,
  parseNames,
  purposeNames,
  sourceKindNames,
  timestamp,
  type AnalysisRun,
  type Exploration,
  analysisRunSchema,
} from '@/lib/exploration/model';
import { assetReferences, researchSignature } from '@/lib/exploration/research';
import { explorationStore } from '@/lib/exploration/storage';
import { undoResearch } from '@/lib/exploration/journal';
import { exportPackage } from '@/lib/exploration/portable';
import { readAIResponse, AIRequestError } from '@/lib/workbench/request-error';
import { ResizableColumns } from '../workbench/resizable-columns';
import { RequestErrorNotice, type ErrorDetail } from '../workbench/request-error-notice';
import { Modal } from '../workbench/modal';
import { downloadText } from '../workbench/version-dialog';
import { Button } from '../ui/button';
import { SourceForm } from './source-form';
import { clipboardImages, preparePastedImages } from '@/lib/exploration/clipboard';
import { SourceViewer } from './source-viewer';
import { FindingsPanel, OverviewPanel, QuestionPanel, StructurePanel } from './findings-panel';
import { AnalysisReview } from './analysis-review';
const viewNames = {
  overview: '产品概览',
  features: '功能清单',
  evidence: '证据视图',
  conflicts: '来源冲突',
  questions: '待确认问题',
  risks: '推断与风险',
  structure: '需求结构图',
};
export function ExplorationWorkspace({
  id,
  entry,
  initialEvidence,
}: {
  id: string;
  entry?: string;
  initialEvidence?: string;
}) {
  const store = useExploration(id);
  const { project: p, update, current } = store;
  const [adding, setAdding] = useState<'text' | 'url' | 'file' | null>(null);
  const [pastedFiles, setPastedFiles] = useState<File[]>([]);
  const [supplementTo, setSupplementTo] = useState('');
  const [dismissedEntry, setDismissedEntry] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [mobilePane, setMobilePane] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ErrorDetail | null>(null);
  const [reviewId, setReviewId] = useState('');
  const [snapshotDialog, setSnapshotDialog] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const snapshotGuard = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (p?.trashedAt) controller.current?.abort();
  }, [p?.trashedAt]);
  useEffect(() => {
    if (!initialEvidence || initialized.current || !current.current) return;
    initialized.current = true;
    update((current) => {
      const evidence = current.evidence.find((e) => e.evidenceId === initialEvidence);
      if (!evidence) return current;
      const n = structuredClone(current);
      Object.assign(n.ui, {
        sourceId: evidence.sourceId,
        evidenceId: evidence.evidenceId,
        view: 'evidence',
      });
      return touchExploration(n);
    });
  }, [initialEvidence, p?.id, update, current]);
  function ui(fields: Partial<Exploration['ui']>) {
    update((current) => {
      const n = structuredClone(current);
      Object.assign(n.ui, fields);
      return touchExploration(n);
    });
  }
  function jumpEvidence(evidenceId: string) {
    const evidence = store.current.current?.evidence.find((e) => e.evidenceId === evidenceId);
    if (!evidence) return;
    ui({
      evidenceId,
      sourceId: evidence.sourceId,
      view: 'evidence',
      returnView: store.current.current?.ui.view ?? 'overview',
    });
    setMobilePane('editor');
  }
  function jumpFinding(findingId: string) {
    const finding = store.current.current?.findings.find((f) => f.id === findingId);
    if (!finding) return;
    ui({
      findingId,
      view:
        finding.kind === 'conflict'
          ? 'conflicts'
          : ['feature', 'scenario', 'goal'].includes(finding.kind)
            ? 'features'
            : 'risks',
    });
    setMobilePane('editor');
    requestAnimationFrame(() =>
      document
        .getElementById(`finding-${findingId}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }
  async function analyze() {
    const base = store.current.current;
    if (!base || controller.current || !consent) return;
    setError('');
    setDetail(null);
    const own = new AbortController();
    controller.current = own;
    setBusy(true);
    const timer = setTimeout(() => own.abort('timeout'), 65000);
    try {
      if (base.runs.length >= 100)
        throw new Error('当前研究已达到100次分析，请保存快照并派生研究；记录不会截断。');
      const request = analysisRequestFor(base);
      const signature = semanticSignature(base);
      const response = await fetch('/api/exploration/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: own.signal,
      });
      const json = await readAIResponse(response);
      if (
        json.projectId !== base.id ||
        json.baseRevision !== base.revision ||
        json.mode !== base.mode ||
        typeof json.requestId !== 'string' ||
        typeof json.promptVersion !== 'string'
      )
        throw new Error('分析响应与本次探索不一致，结果未采用。');
      const output = validateAnalysis(base, json.output);
      const run: AnalysisRun = {
        id: makeId(),
        at: timestamp(),
        requestId: json.requestId,
        promptVersion: json.promptVersion,
        mode: base.mode,
        baseSignature: signature,
        output,
        applied: false,
        modelConfig: analysisRunSchema.shape.modelConfig.parse(json.modelConfig),
        parserVersions: analysisRunSchema.shape.parserVersions.parse(json.parserVersions),
      };
      const ok = update((current) => {
        const n = structuredClone(current);
        n.runs.unshift(run);
        return touchExploration(n, '分析完成，草案等待人工审阅，尚未修改需求');
      });
      if (ok) setReviewId(run.id);
    } catch (error) {
      setError(
        own.signal.aborted
          ? own.signal.reason === 'timeout'
            ? '分析超时，人工编辑与资料保留，可以重试。'
            : '已取消分析，人工编辑与资料保留。'
          : error instanceof Error
            ? error.message
            : '分析失败，原数据保留',
      );
      if (error instanceof AIRequestError)
        setDetail({
          code: error.code,
          requestId: error.requestId,
          status: error.status,
          validationIssues: error.validationIssues,
        });
    } finally {
      clearTimeout(timer);
      controller.current = null;
      setBusy(false);
    }
  }
  async function backup() {
    const current = store.current.current;
    if (!current) return;
    setExporting(true);
    setError('');
    try {
      downloadText(
        `${current.title}-完整探索.json`,
        await exportPackage(current),
        'application/json',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }
  async function saveResearchSnapshot(kind: 'draft' | 'confirmed') {
    const base = store.current.current;
    if (!base || snapshotGuard.current) return;
    if (
      base.snapshots[0]?.kind === kind &&
      base.snapshots[0]?.research?.signature === researchSignature(base)
    ) {
      setSnapshotDialog(false);
      setNotice(`当前研究已保存在V${base.snapshots[0].version}，没有重复创建快照。`);
      return;
    }
    snapshotGuard.current = true;
    setSavingSnapshot(true);
    setError('');
    try {
      await store.flush();
      const available = new Set<string>();
      for (const id of assetReferences(base))
        if (await explorationStore.asset(id)) available.add(id);
      const saved = createSnapshot(base, kind, available);
      const history = await explorationStore.snapshots();
      saved.version =
        Math.max(
          0,
          ...history
            .filter(
              (r) =>
                (r.snapshot.lineage?.rootSnapshotId ?? r.snapshot.snapshotId) ===
                saved.lineage!.rootSnapshotId,
            )
            .map((r) => r.snapshot.version),
        ) + 1;
      const ok = update((current) => {
        if (researchSignature(current) !== researchSignature(base))
          throw new Error('保存期间研究内容已变化，请重新保存；原数据保留。');
        const n = structuredClone(current);
        n.snapshots.unshift(saved);
        return touchExploration(n, '保存完整研究快照');
      });
      if (!ok) return;
      await store.flush();
      setSnapshotDialog(false);
      setNotice(`研究快照V${saved.version}已保存，完整分析与修改记录可在研究历史恢复。`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '快照保存失败，原数据保留');
    } finally {
      snapshotGuard.current = false;
      setSavingSnapshot(false);
    }
  }
  if (store.loading)
    return (
      <div className="full-loading" role="status">
        正在打开本机探索…
      </div>
    );
  if (!p)
    return (
      <div className="explore-empty">
        <p role="alert">{store.error}</p>
        <Link href="/explore">返回需求实验室</Link>
      </div>
    );
  if (p.trashedAt) return <TrashedProjectNotice project={p} />;
  const selectedSource = p.sources.find((s) => s.id === p.ui.sourceId);
  const finding = p.findings.find((f) => f.id === p.ui.findingId);
  const validEvidence = p.evidence.filter((e) => evidenceValid(p, e));
  const activeSources = p.sources.filter((s) => !s.removed);
  const review = p.runs.find((run) => run.id === reviewId);
  const unresolved = currentDecisions(p.questions).filter(
    (q) => q.status === 'open' || q.status === 'deferred',
  );
  const issues = snapshotIssues(p);
  const formKind =
    adding ??
    (!dismissedEntry && !p.sources.length && ['product', 'material'].includes(entry ?? '')
      ? entry === 'product'
        ? 'url'
        : 'file'
      : null);
  return (
    <div
      className="workspace-root exploration-workspace"
      onPaste={(event) => {
        if (formKind || document.querySelector('dialog[open]')) return;
        const images = clipboardImages(event.clipboardData);
        if (!images.length) return;
        event.preventDefault();
        try {
          setPastedFiles(preparePastedImages(images));
          setSupplementTo(selectedSource?.kind === 'url' ? selectedSource.id : '');
          setAdding('file');
        } catch (error) {
          setError(error instanceof Error ? error.message : '无法粘贴图片');
        }
      }}
    >
      <header className="workspace-topbar">
        <Link href="/explore" aria-label="返回需求实验室" className="workspace-back">
          <ArrowLeft size={19} />
        </Link>
        <Link href="/explore" className="explore-workspace-brand">
          <Compass size={20} />
          <span>经典资料视图</span>
        </Link>
        <span className="topbar-divider" />
        <strong className="explore-workspace-title" title={p.title}>
          {p.title}
        </strong>
        <span className={`save-indicator ${store.saveState}`} role="status">
          {store.saveState === 'saving' ? (
            <LoaderCircle size={13} className="spin" />
          ) : (
            <Check size={13} />
          )}
          {store.saveState === 'saving'
            ? '保存中'
            : store.saveState === 'saved'
              ? '已保存到本机'
              : '保存失败'}
        </span>
        <div className="workspace-top-actions">
          <Link href="/#workspaces" className="top-action">
            岗位工作台
          </Link>
          <Link className="top-action" href={`/explore/snapshots?project=${p.id}`}>
            <History size={15} />
            研究历史
          </Link>
          <button className="top-action" disabled={exporting} onClick={() => void backup()}>
            <Download size={15} />
            <span>{exporting ? '打包中' : '导出项目'}</span>
          </button>
          <Button disabled={savingSnapshot} onClick={() => setSnapshotDialog(true)}>
            保存快照
          </Button>
        </div>
      </header>
      <div className="workspace-contextbar">
        <div>
          <span>资料 → 证据 → 需求 → 人工确认 → 导出快照</span>
          <b>{p.findings.filter((f) => f.status === 'confirmed').length} 项已确认</b>
          <span className={`mode-pill ${p.mode}`}>
            {p.mode === 'example' ? '演示数据，非真实AI分析' : '真实AI模式'}
          </span>
        </div>
        <div>
          <button className="text-button" onClick={() => ui({ leftOpen: !p.ui.leftOpen })}>
            <PanelLeftClose size={14} />
            {p.ui.leftOpen ? '收起资料' : '展开资料'}
          </button>
          <button className="text-button" onClick={() => ui({ rightOpen: !p.ui.rightOpen })}>
            <PanelRightClose size={14} />
            {p.ui.rightOpen ? '收起分析' : '展开分析'}
          </button>
        </div>
      </div>
      {store.error && (
        <div className="workspace-error" role="alert">
          {store.error}
          <button onClick={store.retry}>重试保存</button>
          <button onClick={() => void backup()}>导出当前项目</button>
          <button onClick={() => store.setError('')}>收起</button>
        </div>
      )}
      <div className="mobile-work-tabs">
        <button
          onClick={() => setMobilePane('sources')}
          className={mobilePane === 'sources' ? 'active' : ''}
        >
          资料
        </button>
        <button
          onClick={() => setMobilePane('editor')}
          className={mobilePane === 'editor' ? 'active' : ''}
        >
          证据与需求
        </button>
        <button
          onClick={() => setMobilePane('review')}
          className={mobilePane === 'review' ? 'active' : ''}
        >
          分析与确认
        </button>
      </div>
      <ResizableColumns layout={p.ui} onResize={ui} mobilePane={mobilePane}>
        <aside className={`sources-pane ${p.ui.leftOpen ? '' : 'desktop-hidden'}`}>
          <div className="panel-title">
            <span>
              资料与来源 <b>{activeSources.length}</b>
            </span>
            <button
              aria-label="快速添加探索资料"
              className="icon-button"
              onClick={() => setAdding('text')}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="explore-source-filters">
            <label>
              <Search size={15} />
              <input
                aria-label="搜索探索来源"
                value={query}
                placeholder="搜索资料"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="筛选来源类型"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部来源类型</option>
              {Object.entries(sourceKindNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="explore-source-list">
            {Object.entries(sourceKindNames).map(([kind, label]) => {
              const list = activeSources.filter(
                (s) =>
                  s.kind === kind &&
                  (filter === 'all' || filter === kind) &&
                  s.title.toLowerCase().includes(query.toLowerCase()),
              );
              return list.length ? (
                <details key={kind} open>
                  <summary>
                    {label} · {list.length}
                  </summary>
                  {list.map((source) => (
                    <div
                      key={source.id}
                      className={`explore-source-tile ${p.ui.sourceId === source.id ? 'selected' : ''}`}
                    >
                      <button
                        onClick={() => {
                          ui({ sourceId: source.id, evidenceId: null, view: 'evidence' });
                          setMobilePane('editor');
                        }}
                      >
                        <strong>{source.title}</strong>
                        <span>
                          <b className={`parse-badge ${source.status}`}>
                            {parseNames[source.status]}
                          </b>{' '}
                          · {purposeNames[source.purpose]}
                        </span>
                        <small>
                          {source.versions.at(-1)?.fileName ?? sourceKindNames[source.kind]}
                          {source.versions.at(-1)?.size
                            ? ` · ${(source.versions.at(-1)!.size! / 1024).toFixed(1)} KB`
                            : ''}
                        </small>
                        <small>
                          {
                            p.evidence.filter(
                              (e) => e.sourceId === source.id && e.relatedFindingIds.length,
                            ).length
                          }
                          条已引用证据 {source.error ? '· 有待核实事项' : ''}
                        </small>
                      </button>
                      <button
                        className="source-remove"
                        aria-label={`移除来源${source.title}`}
                        onClick={() => {
                          if (
                            window.confirm('移除此来源？历史证据和文件保留，关联需求将标为需复核。')
                          )
                            update((current) => removeSource(current, source.id));
                        }}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </details>
              ) : null;
            })}
            {!activeSources.length && (
              <p className="muted">添加第一个来源，支持想法、多个公开网页及文件。</p>
            )}
          </div>
          <div className="source-bottom">
            <Button onClick={() => setAdding('text')}>
              <Plus size={16} />
              添加探索资料
            </Button>
            <p>每份来源单独解析与追溯。原始文件只存于本浏览器。</p>
          </div>
        </aside>
        <main id="main" className="editor-pane">
          <nav className="explore-view-tabs" aria-label="探索结果视图">
            {Object.entries(viewNames).map(([view, label]) => (
              <button
                key={view}
                aria-current={p.ui.view === view ? 'page' : undefined}
                onClick={() => ui({ view: view as Exploration['ui']['view'] })}
              >
                {label}
              </button>
            ))}
          </nav>
          {busy && (
            <div className="ai-phase" role="status">
              <LoaderCircle size={15} className="spin" />
              正在请求并校验结构化产品需求，可继续人工编辑
              <button onClick={() => controller.current?.abort()}>取消</button>
            </div>
          )}
          {error && (
            <RequestErrorNotice
              className="center-ai-error"
              message={error}
              detail={detail}
              onRetry={() => void analyze()}
              onDismiss={() => setError('')}
            />
          )}
          <div className="center-scroll explore-canvas">
            {p.ui.view === 'evidence' ? (
              <SourceViewer
                project={p}
                source={selectedSource}
                update={update}
                jumpFinding={jumpFinding}
                onSupplement={(kind, sourceId) => {
                  setPastedFiles([]);
                  setSupplementTo(sourceId);
                  setAdding(kind);
                }}
                onReturn={() => {
                  ui({
                    view:
                      p.ui.returnView && p.ui.returnView !== 'evidence'
                        ? p.ui.returnView
                        : 'overview',
                  });
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`finding-${p.ui.findingId}`)
                      ?.scrollIntoView({ block: 'center' }),
                  );
                }}
              />
            ) : p.ui.view === 'overview' ? (
              <OverviewPanel project={p} update={update} />
            ) : p.ui.view === 'questions' ? (
              <QuestionPanel project={p} update={update} jumpEvidence={jumpEvidence} />
            ) : p.ui.view === 'structure' ? (
              <StructurePanel
                project={p}
                update={update}
                jumpEvidence={jumpEvidence}
                select={(findingId) => {
                  const item = p.findings.find((f) => f.id === findingId);
                  const e = p.evidence.find((e) => e.evidenceId === item?.evidenceIds[0]);
                  ui({
                    findingId,
                    ...(e ? { sourceId: e.sourceId, evidenceId: e.evidenceId } : {}),
                  });
                }}
              />
            ) : (
              <FindingsPanel
                project={p}
                update={update}
                jumpEvidence={jumpEvidence}
                select={(findingId) => ui({ findingId })}
              />
            )}
          </div>
          <div className="editor-statusbar">
            <span>
              {validEvidence.length} 条有效证据 · {activeSources.length} 份来源
            </span>
            <span>此处关联分析只读文字；需求实验室另有按需识图，视频不自动理解</span>
            <button
              disabled={!p.operations?.some((op) => !op.undone)}
              onClick={() =>
                update((current) => {
                  const op = [...(current.operations ?? [])].reverse().find((o) => !o.undone);
                  if (!op) throw new Error('暂无可撤销操作');
                  return undoResearch(current, op.id);
                })
              }
            >
              撤销最近研究修改
            </button>
          </div>
        </main>
        <aside className={`review-pane ${p.ui.rightOpen ? '' : 'desktop-hidden'}`}>
          <div className="panel-title">
            <span>
              <Sparkles size={16} />
              产品分析助手
            </span>
            <Link href="/settings/ai">AI连接 ↗</Link>
          </div>
          <div className="review-body explore-assistant">
            <h2>先收集证据，再形成需求</h2>
            <p>已解析的文字与人工标注说明用于分析。不会自动读取图片像素、整段视频或声音。</p>
            <label>
              分析模式
              <select
                className="field"
                aria-label="产品探索分析模式"
                value={p.mode}
                onChange={(event) => {
                  setConsent(false);
                  update((current) => {
                    const n = structuredClone(current);
                    n.mode = event.target.value as Exploration['mode'];
                    return touchExploration(n);
                  });
                }}
                disabled={busy}
              >
                <option value="example">示例演示 / 预置响应</option>
                <option value="real">真实 DeepSeek 分析</option>
              </select>
            </label>
            <label className="explore-checkbox">
              <input
                type="checkbox"
                aria-label="确认分析资料范围"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {p.mode === 'real'
                ? '我已核对文字与人工说明，同意将它们发送至外部 DeepSeek 服务（可能计费）'
                : '我已预览资料，使用明确标识的演示数据分析'}
            </label>
            <Button
              disabled={busy || !consent || !validEvidence.length}
              onClick={() => void analyze()}
            >
              <Sparkles size={16} />
              {busy ? '等待结构化分析…' : '开始产品需求分析'}
            </Button>
            {busy && (
              <button className="text-button" onClick={() => controller.current?.abort()}>
                取消本次分析
              </button>
            )}
            {!validEvidence.length && (
              <p className="right-note">
                暂无有效文字证据。请先添加想法、成功解析文档 / 网页，或为图片和视频填写人工标注。
              </p>
            )}
            {error && (
              <RequestErrorNotice
                message={error}
                detail={detail}
                onRetry={() => void analyze()}
                className="callout error"
              />
            )}
            {!!p.runs.length && (
              <section>
                <h3>分析草案</h3>
                {p.runs.map((run) => (
                  <button className="explore-run" key={run.id} onClick={() => setReviewId(run.id)}>
                    <b>
                      {run.applied
                        ? '已采纳的草案'
                        : semanticSignature(p) !== run.baseSignature
                          ? '历史 / 已过期草案'
                          : '待选择采纳'}
                    </b>
                    <span>
                      {run.output.findings.length}项候选 ·{' '}
                      {new Date(run.at).toLocaleTimeString('zh-CN')}
                    </span>
                  </button>
                ))}
              </section>
            )}
            {finding && (
              <section className="explore-selected-finding">
                <span>当前结论</span>
                <h3>{finding.title}</h3>
                <p>{basisNames[finding.basis]}</p>
                <p>{finding.description}</p>
                <div className="structure-node-actions">
                  <button
                    disabled={finding.locked}
                    onClick={() =>
                      update((current) =>
                        changeFinding(current, finding.id, { status: 'confirmed' }),
                      )
                    }
                  >
                    确认当前结论
                  </button>
                  <button onClick={() => jumpFinding(finding.id)}>编辑此结论</button>
                  <button
                    disabled={finding.locked}
                    onClick={() =>
                      update((current) =>
                        changeFinding(current, finding.id, { status: 'excluded' }),
                      )
                    }
                  >
                    排除当前结论
                  </button>
                </div>
                {finding.rationale && <p>推断依据：{finding.rationale}</p>}
                {finding.uncertainty && <p>不确定性：{finding.uncertainty}</p>}
                {p.evidence.find((e) => e.evidenceId === finding.evidenceIds[0]) && (
                  <blockquote className="selected-evidence-preview">
                    {p.evidence.find((e) => e.evidenceId === finding.evidenceIds[0])!.excerpt}
                  </blockquote>
                )}
                {finding.evidenceIds.map((id) => (
                  <button className="text-button" key={id} onClick={() => jumpEvidence(id)}>
                    定位 {p.evidence.find((e) => e.evidenceId === id)?.title ?? '缺失证据'}
                  </button>
                ))}
              </section>
            )}
            <section>
              <h3>
                待决定问题 <b>{unresolved.length}</b>
              </h3>
              {unresolved.slice(0, 5).map((q) => (
                <button
                  key={q.id}
                  className="explore-question-link"
                  onClick={() => {
                    ui({ view: 'questions' });
                    setMobilePane('editor');
                  }}
                >
                  {q.title}
                </button>
              ))}
              <button
                className="text-button"
                onClick={() => {
                  ui({ view: 'questions' });
                  setMobilePane('editor');
                }}
              >
                查看全部问题
              </button>
            </section>
            <section>
              <h3>从需求到岗位</h3>
              <ol>
                <li>逐项核实与确认功能</li>
                <li>保存完整研究快照</li>
                <li>预览需求资料并主动导入岗位候选</li>
              </ol>
              <p>探索不会直接修改岗位任务或能力要求。</p>
              <Button variant="outline" onClick={() => setSnapshotDialog(true)}>
                检查并保存快照
              </Button>
            </section>
          </div>
        </aside>
      </ResizableColumns>
      {formKind && (
        <SourceForm
          project={p}
          initial={formKind}
          initialFiles={pastedFiles}
          initialLinkedSourceId={supplementTo}
          onClose={() => {
            setAdding(null);
            setPastedFiles([]);
            setSupplementTo('');
            setDismissedEntry(true);
          }}
          onAdd={(source) => {
            update((current) => {
              const n = sourceChanged(current, source, source.versions.at(-1)!);
              n.ui.sourceId = source.id;
              n.ui.evidenceId = null;
              n.ui.view = 'evidence';
              return n;
            });
            setMobilePane('editor');
          }}
        />
      )}
      {review && (
        <AnalysisReview
          project={p}
          run={review}
          jumpEvidence={jumpEvidence}
          onClose={() => setReviewId('')}
          onApply={(keys, includeOverview) => {
            if (update((current) => applyAnalysis(current, review, keys, includeOverview))) {
              setReviewId('');
              ui({ view: 'features' });
              setMobilePane('editor');
              setNotice('所选草案已采纳，仍需逐项人工确认。');
            }
          }}
        />
      )}
      {snapshotDialog && (
        <Modal title="保存产品需求快照" onClose={() => setSnapshotDialog(false)}>
          <p>
            两种快照都保存完整资料、证据、分析和人工修改，后续编辑不会改写旧版本。
            “已确认”表示当前已核实的需求范围；其他候选仍保留各自状态。
            导入岗位前会预览并提示未确认内容，岗位候选仍需独立确认。
          </p>
          {issues.length > 0 && (
            <div className="callout warning">
              <strong>保存已确认快照前：</strong>
              <ul>
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="modal-actions">
            <Button
              variant="outline"
              disabled={savingSnapshot || p.snapshots.length >= 20}
              onClick={() => void saveResearchSnapshot('draft')}
            >
              保存草案快照
            </Button>
            <Button
              disabled={savingSnapshot || !!issues.length || p.snapshots.length >= 20}
              onClick={() => void saveResearchSnapshot('confirmed')}
            >
              保存已确认快照
            </Button>
          </div>
          <p>
            <Link href={`/explore/snapshots?project=${p.id}`}>查看本探索快照历史 →</Link>
          </p>
        </Modal>
      )}
      {notice && (
        <div className="work-toast" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => setNotice('')}>关闭提示</button>
        </div>
      )}
    </div>
  );
}
