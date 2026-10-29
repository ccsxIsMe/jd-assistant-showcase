'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  History,
  LocateFixed,
  Upload,
  Download,
  Undo2,
} from 'lucide-react';
import { useResumeSession } from '@/hooks/use-resume-session';
import { parseResume } from '@/lib/documents/parse';
import {
  correctAssessment,
  editDirectRequirement,
  effectiveAssessment,
  locateResumeEvidence,
  materialSignature,
  newReviewSession,
  prepareResumeRequest,
  redactResume,
  RESUME_NOTICE,
  resumeParagraphs,
  standardFromJd,
  standardFromWorkspace,
  undoCorrection,
  validateResumeOutput,
} from '@/lib/resume/domain';
import {
  materialStateNames,
  materialStates,
  reportSchema,
  type ResumeRequest,
  type Correction,
} from '@/lib/resume/model';
import { now, uid } from '@/lib/workbench/model';
import { resumeReportMarkdown } from '@/lib/resume/export';
import { resumeStore } from '@/lib/resume/storage';
import { DEMO_NOTICE } from '@/lib/demo/identity';
import { downloadText } from '../workbench/version-dialog';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
export function ResumeReviewWorkspace({
  reviewId,
  workspaceId,
  versionId,
}: {
  reviewId?: string;
  workspaceId?: string;
  versionId?: string;
}) {
  const store = useResumeSession(reviewId, workspaceId, versionId),
    s = store.session;
  const router = useRouter();
  const [jd, setJd] = useState(''),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [parsing, setParsing] = useState(false),
    [fileState, setFileState] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState(''),
    [reportId, setReportId] = useState<string | null>(null),
    [highlight, setHighlight] = useState<{ paragraphId: string; quote: string } | null>(null),
    [correction, setCorrection] = useState<{
      requirementId: string;
      state: Correction['after'];
      reason: string;
    } | null>(null),
    [removing, setRemoving] = useState(false);
  const controller = useRef<AbortController | null>(null),
    requestToken = useRef(0),
    parseToken = useRef(0);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof resumeStore.summaries>>>([]);
  useEffect(() => {
    void resumeStore.summaries().then(setRecords, () => setError('核对历史读取失败，原记录保留。'));
  }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      parseToken.current++;
    },
    [],
  );
  const report = s
    ? reportId === null
      ? s.reports.at(-1)
      : s.reports.find((r) => r.id === reportId)
    : undefined;
  const standard = report?.standard ?? s?.standard;
  const selectedRequirement =
    standard?.requirements.find((r) => r.id === selected) ?? standard?.requirements[0];
  const assessment =
    report && s && selectedRequirement
      ? effectiveAssessment(s, report, selectedRequirement.id)
      : undefined;
  const paragraphs = resumeParagraphs(
    report?.material.text ?? (s ? redactResume(s.material.text) : ''),
  );
  let changed = false;
  if (s?.workspaceId && store.workspace) {
    try {
      changed = standardFromWorkspace(store.workspace).signature !== s.standard.signature;
    } catch {
      changed = true;
    }
  }
  const inputChanged = !!(
    s &&
    report &&
    (report.standard.signature !== s.standard.signature ||
      report.materialSignature !== materialSignature(s.material.text))
  );
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : '操作未完成，原数据保留。');
  }
  function adoptJd() {
    try {
      const st = standardFromJd(jd);
      if (s && !s.workspaceId)
        store.update((n) => ({ ...n, standard: st, revision: n.revision + 1, updatedAt: now() }));
      else store.adopt(newReviewSession(st));
      setConsent(false);
      setReportId('');
      setError('');
      setNotice('已按原文整理待核对要求，请整体查看；分类未知可以保留。');
    } catch (e) {
      fail(e);
    }
  }
  async function upload(file: File | undefined, isJd = false) {
    if (!file) return;
    const own = ++parseToken.current,
      revision = store.current.current?.material.revision;
    setParsing(true);
    setError('');
    setFileState('正在本地解析文件，不上传原文件…');
    setConsent(false);
    try {
      let text: string;
      if (isJd && /\.(txt|md)$/i.test(file.name)) {
        if (file.size > 10 * 1024 * 1024) throw new Error('文件超过10MB限制。');
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        if (text.trim().length < 10 || text.length > 30000)
          throw new Error('文档文字不足或超过30000字。');
      } else text = await parseResume(file);
      if (own !== parseToken.current) return;
      if (isJd) setJd(text);
      else if (store.current.current) {
        if (revision !== store.current.current.material.revision)
          throw new Error('解析期间文字已有新编辑，解析结果未覆盖当前输入，请核对后重新导入。');
        store.update((n) => ({
          ...n,
          material: {
            ...n.material,
            text,
            fileName: file.name,
            parser: /\.pdf$/i.test(file.name) ? 'pdfjs' : 'mammoth',
            revision: n.material.revision + 1,
          },
          revision: n.revision + 1,
          updatedAt: now(),
        }));
      }
      setFileState(`${file.name} · 已提取${text.length}字，请审阅可编辑文本。`);
    } catch (e) {
      if (own === parseToken.current) {
        fail(e);
        setFileState('解析失败，已有文字与报告保留；可替换文件或直接粘贴。');
      }
    } finally {
      if (own === parseToken.current) setParsing(false);
    }
  }
  async function analyze() {
    if (controller.current || !store.current.current) return;
    setError('');
    setNotice('');
    let input: ResumeRequest;
    try {
      if (store.current.current.reports.length >= 50)
        throw new Error('当前核对已保存50份报告，请导出并新建核对，不会自动删除历史。');
      input = prepareResumeRequest(store.current.current, consent);
    } catch (e) {
      fail(e);
      return;
    }
    const own = new AbortController(),
      token = ++requestToken.current;
    controller.current = own;
    setBusy(true);
    const timer = setTimeout(() => own.abort('timeout'), 65000);
    try {
      await store.refreshWorkspace();
      const res = await fetch('/api/resume/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: own.signal,
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(
          `${body.error ?? '核对失败'} · HTTP ${res.status} · ${body.code ?? 'REQUEST_FAILED'} · 请求编号：${body.requestId ?? '未提供'}`,
        );
      if (own.signal.aborted || token !== requestToken.current) return;
      const current = store.current.current!;
      if (
        current.id !== input.sessionId ||
        current.standard.signature !== input.standard.signature ||
        materialSignature(current.material.text) !== materialSignature(input.material.text)
      )
        throw new Error(
          '岗位标准或简历材料已改变；迟到结果未应用，已有编辑和报告保留。请按当前版本重试。',
        );
      if (
        body.sessionId !== input.sessionId ||
        body.standardSignature !== input.standard.signature ||
        body.materialSignature !== materialSignature(input.material.text) ||
        body.mode !== input.mode
      )
        throw new Error('响应上下文不一致，结果未采用。');
      const data = validateResumeOutput(input, body.data);
      const next = reportSchema.parse({
        id: uid(),
        requestId: body.requestId,
        createdAt: now(),
        mode: input.mode,
        standard: input.standard,
        material: input.material,
        materialSignature: materialSignature(input.material.text),
        data,
        promptVersion: body.promptVersion,
        modelConfigId: body.modelConfigId,
      });
      if (
        store.update((n) => ({
          ...n,
          reports: [...n.reports, next],
          revision: n.revision + 1,
          updatedAt: now(),
        }))
      ) {
        setReportId(next.id);
        setNotice('核对报告已形成，引用位置已检查；语义与真实能力仍需人工核实。人工修正独立保留。');
      }
    } catch (e) {
      if (token === requestToken.current) {
        if (own.signal.aborted)
          setError(
            own.signal.reason === 'timeout'
              ? '核对超时，材料与旧报告保留，可以重试。'
              : '已取消核对，材料和旧报告保留。',
          );
        else fail(e);
      }
    } finally {
      clearTimeout(timer);
      if (controller.current === own) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    requestToken.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setError('已取消核对；迟到响应不会应用，材料和旧报告保留。');
  }
  function locate(e: { paragraphId: string; quote: string }) {
    if (!report || !locateResumeEvidence(report, e)) {
      setError('片段位置无法验证，未绘制高亮。');
      return;
    }
    setHighlight(e);
    requestAnimationFrame(() =>
      document
        .getElementById(`resume-${e.paragraphId}`)
        ?.scrollIntoView({ block: 'center', behavior: 'auto' }),
    );
  }
  function adoptCurrentStandard(version?: string) {
    try {
      if (!store.workspace) return;
      const st = standardFromWorkspace(store.workspace, version);
      store.update((n) => ({ ...n, standard: st, revision: n.revision + 1, updatedAt: now() }));
      setReportId('');
      setSelected('');
      setConsent(false);
      setNotice('已切换待核对标准，旧报告仍绑定原版本，没有被重写。');
    } catch (e) {
      fail(e);
    }
  }
  if (store.loading) return <p role="status">正在读取本浏览器中的岗位标准与核对记录…</p>;
  return (
    <div className="resume-review-page">
      <nav className="product-crumb" aria-label="当前位置">
        <Link href={s?.workspaceId ? `/workspaces/${s.workspaceId}` : '/#workspaces'}>
          <ArrowLeft size={14} />
          岗位共创
        </Link>
        <span>／</span>
        <span>简历证据核对</span>
      </nav>
      <header className="resume-heading product-page-heading">
        <div>
          <span className="guided-kicker">同一岗位标准 · 材料逐条核对</span>
          <h1>看清材料，再作判断。</h1>
          <p>{RESUME_NOTICE}</p>
        </div>
        <Link className="example-link" href="/examples?stage=resume">
          体验软件工程师简历示例 ↗
        </Link>
      </header>
      {s?.demo && (
        <div className="demo-ribbon">
          <strong>{s.mode === 'example' ? DEMO_NOTICE : '示例项目｜虚构材料｜真实AI重分析'}</strong>
          <Link href="/examples?stage=resume">示例说明、重置与复制</Link>
        </div>
      )}
      {(error || store.error) && (
        <div role="alert" className="resume-error">
          {error || store.error}
          <button
            onClick={() => {
              setError('');
              store.setError('');
            }}
          >
            收起错误
          </button>
          <Link href="/settings/ai">检查AI连接</Link>
        </div>
      )}
      {notice && (
        <p role="status" className="resume-notice">
          {notice}
        </p>
      )}
      {!s && records.length > 0 && (
        <details className="resume-context">
          <summary>继续本浏览器中的核对记录（{records.length}）</summary>
          {records.map((r) => (
            <p key={r.id}>
              <Link href={`/match?review=${encodeURIComponent(r.id)}`}>{r.title}</Link> ·{' '}
              {r.reports}份报告 · {new Date(r.updatedAt).toLocaleString('zh-CN')}
            </p>
          ))}
        </details>
      )}
      {!s ? (
        <section className="resume-direct-input">
          <h2>我已有JD，直接核对简历</h2>
          <p>粘贴或导入JD，程序按原文整理待核对要求；不用先创建研究项目。</p>
          <label htmlFor="direct-jd">
            岗位JD
            <textarea
              id="direct-jd"
              value={jd}
              rows={9}
              maxLength={30000}
              onChange={(e) => setJd(e.target.value)}
              placeholder="粘贴岗位职责与任职要求，至少10字…"
            />
          </label>
          <label>
            导入岗位JD文件
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              disabled={parsing}
              onChange={(e) => {
                void upload(e.target.files?.[0], true);
                e.target.value = '';
              }}
            />
          </label>
          <p role="status">{fileState}</p>
          <Button disabled={parsing} onClick={adoptJd}>
            整理这份JD的核对要求
          </Button>
          <Link href="/examples?stage=resume">先查看完整虚构案例</Link>
        </section>
      ) : (
        <>
          <section className="resume-context">
            <div>
              <h2>{s.standard.title}</h2>
              <p>
                {s.standard.kind === 'direct-jd'
                  ? '来自已有JD'
                  : s.standard.versionNumber
                    ? `岗位版本 V${s.standard.versionNumber}`
                    : `当前岗位草稿 r${s.standard.workspaceRevision}`}{' '}
                · {s.standard.requirements.length}条要求 · 材料V{s.material.revision}
              </p>
              <small role="status">
                {store.saveState === 'saved'
                  ? '已保存到当前浏览器'
                  : store.saveState === 'saving'
                    ? '保存中 · 有未保存修改'
                    : '保存失败，当前编辑保留'}
              </small>
            </div>
            <div className="resume-context-actions">
              {store.saveState === 'failed' && <button onClick={store.retry}>重试保存</button>}
              <label>
                分析方式
                <select
                  aria-label="简历核对分析方式"
                  value={s.mode}
                  disabled={busy}
                  onChange={(e) => {
                    store.update((n) => ({
                      ...n,
                      mode: e.target.value as 'example' | 'real',
                      revision: n.revision + 1,
                    }));
                    setConsent(false);
                  }}
                >
                  <option value="example">示例（非真实AI）</option>
                  <option value="real">真实AI（按服务商计费）</option>
                </select>
              </label>
              {busy ? (
                <Button variant="outline" onClick={cancel}>
                  取消核对
                </Button>
              ) : (
                <Button onClick={() => void analyze()} disabled={!consent || parsing}>
                  {s.mode === 'real' ? '使用真实AI核对材料' : '确认并核对材料'}
                </Button>
              )}
            </div>
          </section>
          {changed && (
            <div className="resume-version-warning" role="status">
              岗位内容已有更新。现有报告仍保留原标准，不会自动覆盖。
              <button onClick={() => adoptCurrentStandard()}>采用当前岗位标准重新核对</button>
            </div>
          )}
          {!!store.workspace?.versions.length && (
            <details className="resume-version-picker">
              <summary>
                <History size={14} />
                选择岗位标准版本
              </summary>
              <button onClick={() => adoptCurrentStandard()}>当前岗位草稿</button>
              {store.workspace.versions.map((v) => (
                <button key={v.id} onClick={() => adoptCurrentStandard(v.id)}>
                  V{v.number} · {v.kind === 'confirmed' ? '已确认版本' : '草稿版本'}
                </button>
              ))}
            </details>
          )}
          {!!s.reports.length && (
            <label className="resume-report-picker">
              核对报告历史
              <select
                aria-label="查看核对报告"
                value={report?.id ?? ''}
                onChange={(e) => {
                  setReportId(e.target.value);
                  setSelected('');
                  setHighlight(null);
                }}
              >
                <option value="">当前材料，尚未核对</option>
                {[...s.reports].reverse().map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.createdAt).toLocaleString('zh-CN')} · 材料V{r.material.revision} ·{' '}
                    {r.mode === 'example' ? '预置演示' : '真实AI候选'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {inputChanged && (
            <p className="resume-version-warning">
              当前输入与这份报告不同。下面显示报告绑定的旧材料，重新核对会新增报告；旧报告与人工修正保留。
            </p>
          )}
          {report && (
            <section className="resume-result-summary">
              <div>
                <CheckCircle2 size={18} />
                <p>{report.data.summary}</p>
              </div>
              <div className="resume-state-counts">
                {materialStates.map((state) => (
                  <span key={state}>
                    {materialStateNames[state]}
                    <strong>
                      {
                        report.data.assessments.filter(
                          (a) => effectiveAssessment(s, report, a.requirementId).state === state,
                        ).length
                      }
                    </strong>
                  </span>
                ))}
              </div>
              <div className="resume-export-actions">
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(resumeReportMarkdown(s, report)).then(
                      () => setNotice('报告已复制'),
                      () => setError('复制失败，请下载Markdown。'),
                    );
                  }}
                >
                  复制报告
                </button>
                <button
                  onClick={() =>
                    downloadText(`${s.title}-简历证据核对.md`, resumeReportMarkdown(s, report))
                  }
                >
                  <Download size={14} />
                  下载Markdown
                </button>
              </div>
            </section>
          )}
          <div className="resume-evidence-layout">
            <aside className="resume-requirements" aria-label="本次岗位要求">
              <header>
                <h2>本次岗位要求</h2>
                <small>点击一条，查看材料与依据</small>
              </header>
              {(standard?.requirements ?? []).map((r) => {
                const a = report ? effectiveAssessment(s, report, r.id) : undefined;
                return (
                  <button
                    key={r.id}
                    data-testid="resume-requirement"
                    aria-pressed={selectedRequirement?.id === r.id}
                    onClick={() => {
                      setSelected(r.id);
                      setHighlight(null);
                    }}
                  >
                    <strong>{r.title}</strong>
                    <span className={`material-state ${a?.state ?? 'pending'}`}>
                      {a ? materialStateNames[a.state] : '尚未核对'}
                    </span>
                    {a?.correction && <small>人工修正 · 有记录</small>}
                    <small>
                      {r.status === 'confirmed'
                        ? '岗位已确认'
                        : r.status === 'review'
                          ? '岗位需复核'
                          : '岗位待确认'}
                    </small>
                  </button>
                );
              })}
              {!s.workspaceId && (
                <details>
                  <summary>修改待核对要求</summary>
                  {s.standard.requirements.map((r) => (
                    <label key={r.id}>
                      {r.title}
                      <textarea
                        aria-label={`修改核对要求${r.title}`}
                        defaultValue={r.text}
                        rows={3}
                        maxLength={3000}
                        onBlur={(e) => {
                          if (e.target.value === r.text) return;
                          try {
                            store.update((n) => ({
                              ...n,
                              standard: editDirectRequirement(n.standard, r.id, e.target.value),
                              revision: n.revision + 1,
                            }));
                            setConsent(false);
                          } catch (ex) {
                            fail(ex);
                          }
                        }}
                      />
                    </label>
                  ))}
                </details>
              )}
            </aside>
            <main className="resume-material-pane" aria-label="简历材料与证据详情">
              {selectedRequirement && (
                <section className="resume-assessment" data-testid="resume-assessment">
                  <div className="resume-section-heading">
                    <h2>{selectedRequirement.title}</h2>
                    {assessment && (
                      <span className={`material-state ${assessment.state}`}>
                        {materialStateNames[assessment.state]}
                      </span>
                    )}
                  </div>
                  <p>{selectedRequirement.text}</p>
                  <small>
                    要求ID：{selectedRequirement.id} · 来源版本：
                    {selectedRequirement.sourceRevision}
                  </small>
                  {assessment ? (
                    <>
                      <p>{assessment.explanation}</p>
                      {assessment.correction && (
                        <div className="resume-human-note">
                          <strong>人工修正</strong>
                          <p>{assessment.correction.reason}</p>
                          <small>这条意见不增补原文，也不代表候选人能力已验证。</small>
                          <button
                            onClick={() => {
                              try {
                                store.update((n) => undoCorrection(n, assessment.correction!.id));
                              } catch (e) {
                                fail(e);
                              }
                            }}
                          >
                            <Undo2 size={13} />
                            撤销这次修正
                          </button>
                        </div>
                      )}
                      <div className="resume-citations">
                        {assessment.evidence.map((e, i) => (
                          <button key={`${e.paragraphId}-${i}`} onClick={() => locate(e)}>
                            <LocateFixed size={14} />
                            <span>
                              {e.quote}
                              <small>{e.paragraphId} · 仅位置已校验，能力待核实</small>
                            </span>
                          </button>
                        ))}
                        {!assessment.evidence.length && (
                          <p>简历未体现，待核实；没有绘制虚构高亮。</p>
                        )}
                      </div>
                      {assessment.questions.length > 0 && (
                        <details open>
                          <summary>具体待核实问题</summary>
                          {assessment.questions.slice(0, 3).map((q) => (
                            <p key={q}>{q}</p>
                          ))}
                        </details>
                      )}
                      <button
                        onClick={() =>
                          setCorrection({
                            requirementId: selectedRequirement.id,
                            state: assessment.state,
                            reason: '',
                          })
                        }
                      >
                        修正这条材料判断
                      </button>
                    </>
                  ) : (
                    <p>先审阅材料并主动开始核对；读取文件或打开页面不会请求模型。</p>
                  )}
                  {selectedRequirement.origin && (
                    <Link
                      className="resume-origin-link"
                      href={`/lab/snapshots/${selectedRequirement.origin.snapshotId}`}
                    >
                      查看产品功能与来源快照 ↗
                    </Link>
                  )}
                  {s.workspaceId && (
                    <Link
                      href={`/workspaces/${s.workspaceId}?target=${encodeURIComponent(selectedRequirement.id)}`}
                    >
                      返回岗位标准与依据 ↗
                    </Link>
                  )}
                </section>
              )}
              <section className="resume-input-section">
                <div className="resume-section-heading">
                  <h2>
                    <FileText size={18} />
                    简历材料
                  </h2>
                  <label className="resume-file-control">
                    <Upload size={15} />
                    上传PDF / DOCX
                    <input
                      aria-label="上传简历文件"
                      type="file"
                      accept=".pdf,.docx"
                      disabled={parsing}
                      onChange={(e) => {
                        void upload(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <p className="resume-helper">
                  浏览器本地解析，不上传原文件。最大10MB，PDF最多50页；不支持旧.doc和扫描件OCR。文件未长期保存，刷新后恢复的是已保存文本。
                </p>
                <p role="status">{parsing ? '正在解析…' : fileState || s.material.fileName}</p>
                {parsing && (
                  <button
                    onClick={() => {
                      parseToken.current++;
                      setParsing(false);
                      setFileState('已取消解析，旧材料保留。');
                    }}
                  >
                    取消解析
                  </button>
                )}
                <details open={!report}>
                  <summary>可编辑文本预览 / 直接粘贴</summary>
                  <label>
                    简历文本
                    <textarea
                      aria-label="简历文本预览 / 直接粘贴"
                      rows={12}
                      maxLength={30000}
                      value={s.material.text}
                      onChange={(e) => {
                        store.update((n) => ({
                          ...n,
                          material: {
                            ...n.material,
                            text: e.target.value,
                            revision: n.material.revision + 1,
                          },
                          revision: n.revision + 1,
                          updatedAt: now(),
                        }));
                        setConsent(false);
                      }}
                    />
                  </label>
                </details>
                <details className="resume-privacy">
                  <summary>发送范围与本地隐私处理</summary>
                  <p>
                    发送冻结岗位要求及遮盖后的职业经历文本，常见姓名、联系方式和无关个人属性行会在本地遮盖。这不是完整匿名化，请仍自行审阅。材料和报告保存在当前浏览器，不进行外网背景搜索。
                  </p>
                  <pre>{redactResume(s.material.text)}</pre>
                  <button onClick={() => setRemoving(true)}>删除本次材料与报告…</button>
                </details>
                <label className="resume-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={busy || parsing}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  我已审阅并有权使用这些材料。
                  {s.mode === 'real'
                    ? '同意将当前岗位要求和遮盖后简历发送至外部DeepSeek，调用按服务商计费。'
                    : '当前为本地预置演示，不代表本次真实AI判断。'}
                </label>
                {busy && (
                  <p role="status">
                    正在核对材料并校验引用；没有生成录用结论或虚假百分比，可取消。
                  </p>
                )}
              </section>
              {paragraphs.length > 0 && (
                <section className="resume-readable">
                  <h2>{report ? '报告绑定的简历原文' : '发送前可核对文字'}</h2>
                  <p>段落编号来自实际文本；只高亮能够逐字定位的片段，不虚构PDF页码。</p>
                  {paragraphs.map((p) => {
                    const start =
                      highlight?.paragraphId === p.id ? p.text.indexOf(highlight.quote) : -1;
                    return (
                      <article
                        id={`resume-${p.id}`}
                        key={p.id}
                        className={start >= 0 ? 'resume-paragraph highlighted' : 'resume-paragraph'}
                        data-testid="resume-paragraph"
                      >
                        <small>{p.id}</small>
                        <p>
                          {start >= 0 && highlight ? (
                            <>
                              {p.text.slice(0, start)}
                              <mark>{highlight.quote}</mark>
                              {p.text.slice(start + highlight.quote.length)}
                            </>
                          ) : (
                            p.text
                          )}
                        </p>
                      </article>
                    );
                  })}
                </section>
              )}
              {report && (
                <details>
                  <summary>人工修正记录与分析版本</summary>
                  <p>
                    {report.promptVersion} · {report.modelConfigId} · 请求编号：{report.requestId}
                  </p>
                  {s.corrections.map((c) => (
                    <p key={c.id}>
                      {new Date(c.createdAt).toLocaleString('zh-CN')} ·{' '}
                      {materialStateNames[c.before]} → {materialStateNames[c.after]} · {c.reason}
                      {c.undoneAt ? '（已撤销）' : ''}
                    </p>
                  ))}
                </details>
              )}
            </main>
          </div>
        </>
      )}
      {correction && report && (
        <Modal title="人工修正材料判断" onClose={() => setCorrection(null)}>
          <p>记录你的修正和依据；不会改变原始模型结果、简历原文或岗位标准。</p>
          <label>
            材料状态
            <select
              aria-label="人工修正状态"
              value={correction.state}
              onChange={(e) =>
                setCorrection({ ...correction, state: e.target.value as Correction['after'] })
              }
            >
              {materialStates.map((state) => (
                <option key={state} value={state}>
                  {materialStateNames[state]}
                </option>
              ))}
            </select>
          </label>
          <label>
            修正理由
            <Textarea
              aria-label="人工修正理由"
              value={correction.reason}
              rows={4}
              maxLength={2000}
              onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
            />
          </label>
          <Button
            onClick={() => {
              try {
                if (
                  store.update((n) =>
                    correctAssessment(
                      n,
                      report.id,
                      correction.requirementId,
                      correction.state,
                      correction.reason,
                    ),
                  )
                )
                  setCorrection(null);
              } catch (e) {
                fail(e);
              }
            }}
          >
            保存人工修正
          </Button>
        </Modal>
      )}
      {removing && s && (
        <Modal title="删除本次简历核对记录" onClose={() => setRemoving(false)}>
          <p>
            将删除这份核对记录的已保存文本、报告与修正记录。岗位、研究快照和其他核对记录保留。建议先导出需要的报告。
          </p>
          <Button variant="outline" onClick={() => setRemoving(false)}>
            保留记录
          </Button>
          <Button
            onClick={() => {
              void store.remove().then(() => {
                router.replace('/match');
              }, fail);
            }}
          >
            确认删除本次记录
          </Button>
        </Modal>
      )}
    </div>
  );
}
