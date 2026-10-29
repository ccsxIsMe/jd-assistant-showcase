'use client';
import { currentDecisions } from '@/lib/decisions/records';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  History,
  Layers,
  LoaderCircle,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  RefreshCw,
  Sparkles,
  X,
  Network,
  ScanSearch,
  FlaskConical,
  Settings2,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '../ui/button';
import { SourcePanel, type SourceFocus } from './source-panel';
import { ItemsPanel } from './items-panel';
import { JDPanel } from './jd-panel';
import { ReviewPanel } from './review-panel';
import { PreviewDialog, VersionsDialog, downloadText } from './version-dialog';
import { Modal } from './modal';
import { contextKey, log, touch, type ConfirmationCheck } from '@/lib/workbench/domain';
import { aiOutputSchema, type AIRequest } from '@/lib/workbench/ai-contract';
import { ingestAI } from '@/lib/workbench/ai-apply';
import { now, uid, type Reference, type Workspace } from '@/lib/workbench/model';
import { demoSupplement } from '@/lib/workbench/example';
import { ResearchImportPanel } from './research-import-panel';
import { ResizableColumns } from './resizable-columns';
import { JDUpdateDialog } from './jd-update-dialog';
import { RequestErrorNotice, type ErrorDetail } from './request-error-notice';
import { AIRequestError, readAIResponse } from '@/lib/workbench/request-error';
import { WorkbenchFirstUse } from './first-use';
import { DemoRibbon } from '../examples/demo-ribbon';
export function WorkspaceView({
  id,
  initialTarget,
  initialView,
}: {
  id: string;
  initialTarget?: string;
  initialView?: 'jd' | 'tasks';
}) {
  const store = useWorkspace(id);
  const { workspace: w } = store;
  const update = (fn: (w: Workspace) => Workspace) =>
    store.update((c) => {
      const n = fn(c);
      const operation = n.operations[0];
      const previous = c.operations.find((o) => o.id === operation?.id);
      if (operation?.suggestionId && (!previous || previous.undone !== operation.undone)) {
        requestAnimationFrame(() => {
          for (const item of operation.after) {
            const el = document.getElementById('item-' + item.id);
            el?.classList.add('recently-updated');
            setTimeout(() => el?.classList.remove('recently-updated'), 900);
          }
        });
        announce(
          operation.undone
            ? '已撤销本次AI应用，保留无关修改。'
            : '已应用到草稿；岗位确认仍由人完成，可撤销本次应用。',
        );
      }
      return n;
    });
  const [focus, setFocus] = useState<SourceFocus | null>(null);
  const [questionFocus, setQuestionFocus] = useState<{ id: string; token: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState(false);
  const [settings, setSettings] = useState(false);
  const [jdUpdate, setJDUpdate] = useState(false);
  const [tab, setTab] = useState<'ai' | 'questions' | 'discussion'>('ai');
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [aiState, setAIState] = useState<{
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    message: string;
  } | null>(null);
  const [aiError, setAIError] = useState('');
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [notice, setNotice] = useState('');
  const [mobilePane, setMobilePane] = useState<'sources' | 'editor' | 'review'>('editor');
  const controller = useRef<AbortController | null>(null);
  const center = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAttempt = useRef<{
    action: AIRequest['action'];
    intent: string;
    options: { targetId?: string; scope?: AIRequest['scope'] };
  } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const located = useRef(false);
  useEffect(() => {
    if (!w || located.current) return;
    located.current = true;
    const target = w.items.find((i) => i.id === initialTarget);
    if (target || initialView)
      store.update((c) => ({
        ...c,
        ui: {
          ...c.ui,
          view: target?.kind === 'block' ? 'jd' : target ? 'tasks' : (initialView ?? c.ui.view),
          ...(target
            ? {
                selectedId: target.id,
                objectTab: target.kind === 'requirement' ? 'requirement' : 'task',
              }
            : {}),
        },
      }));
  }, [w, initialTarget, initialView, store]);
  function announce(message: string) {
    setNotice(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(''), 6000);
  }
  function ui(fields: Partial<Workspace['ui']>) {
    update((c) => {
      if (
        Object.entries(fields).every(
          ([key, value]) =>
            JSON.stringify(c.ui[key as keyof Workspace['ui']]) === JSON.stringify(value),
        )
      )
        return c;
      const n = structuredClone(c);
      Object.assign(n.ui, fields);
      return n;
    });
  }
  function select(targetId: string) {
    const item = store.current.current?.items.find((i) => i.id === targetId);
    if (!item) return;
    ui({ selectedId: targetId, ...(item.kind === 'block' ? {} : { objectTab: item.kind }) });
  }
  function jump(targetId: string) {
    const current = store.current.current;
    const item = current?.items.find((i) => i.id === targetId);
    if (!item) return;
    ui({
      selectedId: targetId,
      view: item.kind === 'block' ? 'jd' : 'tasks',
      ...(item.kind === 'block' ? {} : { objectTab: item.kind }),
    });
    setMobilePane('editor');
    requestAnimationFrame(() =>
      document
        .getElementById(`item-${targetId}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }
  function reference(ref: Reference) {
    setFocus({ ref, token: Date.now() });
    ui({ leftOpen: true, sourceId: ref.sourceId });
    setMobilePane('sources');
  }
  function openConfirmationCheck(check: ConfirmationCheck) {
    const current = store.current.current;
    if (!current) return;
    if (check.kind === 'question' && check.questionId) {
      ui({ rightOpen: true });
      setTab('questions');
      setMobilePane('review');
      setQuestionFocus({ id: check.questionId, token: performance.now() });
      return;
    }
    const item = current.items.find((i) => i.id === check.itemId);
    if (!item) {
      switchView('jd');
      setMobilePane('editor');
      return;
    }
    ui({
      selectedId: item.id,
      view: item.kind === 'block' ? 'jd' : 'tasks',
      ...(item.kind !== 'block' ? { objectTab: item.kind } : {}),
    });
    setMobilePane('editor');
    let attempts = 0;
    const locate = () => {
      const element = document.getElementById(`item-${item.id}`);
      if (!element || !element.getClientRects().length) {
        if (attempts++ < 12) requestAnimationFrame(locate);
        return;
      }
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      element.classList.add('review-target');
      setTimeout(() => element.classList.remove('review-target'), 4000);
      if (check.kind === 'category' || check.kind === 'reference') {
        element.querySelector<HTMLButtonElement>('[data-review-edit]')?.click();
        if (check.kind === 'category')
          requestAnimationFrame(() => document.getElementById('item-category')?.focus());
      } else {
        const button = element.querySelector<HTMLButtonElement>(
          '[data-tour="workbench-confirm-block"], .confirm-button',
        );
        button?.focus({ preventScroll: true });
      }
    };
    requestAnimationFrame(locate);
  }
  function switchView(view: Workspace['ui']['view']) {
    const current = store.current.current;
    if (!current) return;
    const position = center.current?.scrollTop ?? 0;
    ui({ ...{ [current.ui.view === 'tasks' ? 'scrollTasks' : 'scrollJD']: position }, view });
    requestAnimationFrame(() => {
      if (center.current)
        center.current.scrollTop = view === 'tasks' ? current.ui.scrollTasks : current.ui.scrollJD;
    });
  }
  async function run(
    action: AIRequest['action'],
    customIntent?: string,
    options: { targetId?: string; scope?: AIRequest['scope'] } = {},
  ) {
    const current = store.current.current;
    if (!current || controller.current) return;
    if (current.mode === 'example' && action === 'extract' && !current.example && !current.demo) {
      setAIError(
        '当前为本地手动/示例模式，没有这份岗位的预置AI答案。资料和编辑已保留；可点击上方“切换为真实AI”，确认外部发送后再整理。',
      );
      return;
    }
    setErrorDetail(null);
    const targetId = options.targetId ?? current.ui.selectedId;
    const selected = current.items.find((i) => i.id === targetId);
    const text = customIntent ?? intent;
    if (action === 'suggest' && (!selected || selected.locked)) {
      setAIError('请选择一个未锁定对象。');
      return;
    }
    const key = contextKey(current, targetId ?? '', text);
    if (
      action === 'suggest' &&
      current.suggestions.some((s) => s.contextKey === key && s.status !== 'stale')
    ) {
      setAIError('相同上下文的建议已有审阅记录；可查看记录，修改意图或内容后再请求。');
      return;
    }
    const base = structuredClone(current);
    const req: AIRequest = {
      action,
      mode: current.mode,
      context: {
        ...(base.demo ? { demo: base.demo } : {}),
        id: base.id,
        revision: base.revision,
        title: base.title,
        sources: base.sources,
        items: base.items,
        questions: currentDecisions(base.questions),
        decisions: base.activity.slice(0, 60).map((a) => ({ text: a.text, at: a.at })),
      },
      targetId: action === 'suggest' ? targetId : null,
      scope: options.scope,
      intent: text,
    };
    lastAttempt.current = {
      action,
      intent: text,
      options: { ...options, ...(action === 'suggest' && targetId ? { targetId } : {}) },
    };
    const own = new AbortController();
    controller.current = own;
    const timer = setTimeout(() => own.abort('timeout'), 65000);
    setBusy(true);
    setAIState({
      status: 'running',
      message:
        action === 'draft'
          ? '正在生成JD草稿'
          : action === 'suggest'
            ? '正在生成局部修改建议'
            : action === 'extract'
              ? '正在整理岗位资料'
              : '正在检查待确认问题',
    });
    setAIError('');
    setPhase(
      action === 'extract'
        ? '正在整理资料与引用'
        : action === 'draft'
          ? '正在形成结构化JD草稿'
          : '正在请求结构化建议',
    );
    try {
      const res = await fetch('/api/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: own.signal,
      });
      const json = await readAIResponse(res);
      own.signal.throwIfAborted();
      if (controller.current !== own) throw new Error('响应已过期，当前编辑未改变。');
      if (
        json.workspaceId !== base.id ||
        json.baseRevision !== base.revision ||
        typeof json.requestId !== 'string' ||
        typeof json.promptVersion !== 'string' ||
        typeof json.task !== 'string'
      )
        throw new Error('响应与本次岗位快照不匹配，未采用结果。');
      const data = aiOutputSchema.parse(json.data);
      const { requestId, task, promptVersion } = json;
      setPhase('正在校验引用与目标版本');
      const accepted = update((c) => {
        const n = ingestAI(c, base, req, data);
        n.aiHistory = [
          ...(n.aiHistory ?? []),
          {
            requestId,
            task,
            promptVersion,
            baseRevision: base.revision,
            at: now(),
            status: 'completed',
          },
        ].slice(-300) as NonNullable<Workspace['aiHistory']>;
        for (const s of n.suggestions) {
          if (!c.suggestions.some((old) => old.suggestionId === s.suggestionId)) {
            s.requestId = requestId;
            s.promptVersion = promptVersion;
          }
        }
        return n;
      });
      if (!accepted)
        throw new Error('结果未能合并到当前岗位；请查看保存或版本错误，已有编辑保留。');
      const completed =
        action === 'draft'
          ? '已完成 · JD草稿已生成，请人工审阅'
          : action === 'suggest'
            ? data.groups.length
              ? '已完成 · 局部建议已生成，等待你审阅采纳'
              : '已完成 · 本次检查暂无可用修改建议'
            : action === 'extract'
              ? '已完成 · 资料已整理，候选仍待确认'
              : '已完成 · 待确认问题已检查';
      setAIState({ status: 'completed', message: completed });
      if (action === 'draft') setMobilePane('editor');
      if (action === 'suggest') {
        setTab('ai');
        announce('建议已进入审阅；工作内容尚未改变。');
      } else if (action === 'extract') {
        announce('整理完成，所有候选条目均待人工确认。');
        setTab('questions');
      }
      if (action === 'draft') announce(completed);
      else if (data.notice) setNotice(data.notice);
    } catch (error) {
      if (error instanceof AIRequestError)
        setErrorDetail({
          code: error.code,
          requestId: error.requestId,
          status: error.status,
          validationIssues: error.validationIssues,
        });
      setAIState({
        status: own.signal.aborted && own.signal.reason !== 'timeout' ? 'cancelled' : 'failed',
        message:
          own.signal.aborted && own.signal.reason !== 'timeout'
            ? '已取消 · 已有编辑保留'
            : '本次AI处理未完成 · 可查看错误并重试',
      });
      setAIError(
        own.signal.aborted
          ? own.signal.reason === 'timeout'
            ? '请求超时，人工编辑与本地保存仍可使用。'
            : '已取消请求，现有内容保持不变。'
          : error instanceof Error
            ? error.message
            : '请求失败；现有内容保持不变。',
      );
    } finally {
      clearTimeout(timer);
      controller.current = null;
      setBusy(false);
      setPhase('');
    }
  }
  function retryAI() {
    const attempt = lastAttempt.current;
    if (attempt) void run(attempt.action, attempt.intent, attempt.options);
  }
  function updateJD() {
    if (store.current.current?.items.some((i) => i.kind === 'block')) setJDUpdate(true);
    else void run('draft');
  }
  function localAI(text?: string) {
    if (text === '__draft__') {
      void run('draft');
      return;
    }
    setTab('ai');
    setMobilePane('review');
    ui({ rightOpen: true });
    if (text) {
      setIntent(text);
      void run('suggest', text);
    }
  }
  function addSupplement() {
    update((c) => {
      const n = structuredClone(c);
      n.sources.push({
        id: uid(),
        title: '技术栈与前端边界补充',
        type: 'supplement',
        person: '本地操作者录入 · 虚构演示反馈',
        createdAt: now(),
        removed: false,
        versions: [{ revision: 1, text: demoSupplement, createdAt: now() }],
      });
      log(n, '用户主动补充实际演示技术栈与职责边界；尚未确认条件');
      return touch(n);
    });
    announce('已录入补充资料；请选择相关对象生成建议或人工修改。');
  }
  if (store.loading)
    return (
      <div className="full-loading" role="status">
        <LoaderCircle className="spin" />
        正在打开本机岗位…
      </div>
    );
  if (!w)
    return (
      <div className="full-loading">
        <p role="alert">{store.error}</p>
        <Link href="/">返回岗位列表</Link>
      </div>
    );
  const selected = w.items.find((i) => i.id === w.ui.selectedId);
  const confirmed = w.items.filter((i) => i.kind !== 'block' && i.status === 'confirmed').length;
  const active = w.items.filter((i) => i.kind !== 'block' && i.status !== 'excluded').length;
  const needs = w.items.filter((i) => i.status === 'review').length;
  const blocks = w.items.some((i) => i.kind === 'block');
  const openQuestions = currentDecisions(w.questions).filter(
    (q) => q.status === 'open' || q.status === 'deferred',
  ).length;
  return (
    <div
      className="workspace-root"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.target instanceof HTMLElement) {
          const details = e.target.closest('details[open]');
          if (details instanceof HTMLDetailsElement) {
            details.open = false;
            details.querySelector('summary')?.focus();
          }
        }
      }}
    >
      <header className="workspace-topbar">
        <Link className="workspace-back" href="/" aria-label="返回岗位列表">
          <ArrowLeft size={19} />
        </Link>
        <Link className="workspace-brand" href="/">
          <Sparkles size={19} />
          <span>JD 助手</span>
        </Link>
        <span className="topbar-divider" />
        <button className="workspace-title" onClick={() => setSettings(true)} title={w.title}>
          {w.title}
          <ChevronDown size={13} />
        </button>
        <span className={`save-indicator ${store.saveState}`} role="status">
          {store.saveState === 'saving' ? (
            <LoaderCircle className="spin" size={13} />
          ) : store.saveState === 'saved' ? (
            <Check size={13} />
          ) : (
            <X size={13} />
          )}
          {{ saving: '保存中', saved: '已保存到本机', failed: '保存失败' }[store.saveState]}
        </span>
        <div className="workspace-top-actions">
          <Link
            aria-label="需求实验室"
            className="top-action"
            href="/lab"
            title="从产品构想到岗位方案的引导式研究"
          >
            <Network size={15} />
            <span>需求实验室</span>
          </Link>
          <Link
            aria-label="用当前岗位核对简历"
            className="top-action"
            href={`/match?workspaceId=${encodeURIComponent(w.id)}`}
          >
            <ScanSearch size={15} />
            <span>核对简历</span>
          </Link>
          <Link
            aria-label="示例"
            className="top-action example-link"
            href="/examples?stage=workbench"
          >
            <FlaskConical size={15} />
            <span>示例</span>
          </Link>
          <Link
            aria-label="AI连接"
            className="top-action"
            href="/settings/ai"
            title="服务端AI连接配置"
          >
            <Settings2 size={15} />
            <span>AI连接</span>
          </Link>
          <button
            aria-label="切换AI协作方式"
            onClick={() => setSettings(true)}
            className={`mode-pill ${w.mode}`}
          >
            {w.example ? '虚构示例 · ' : ''}
            {w.mode === 'example' ? '示例演示/预置响应' : '真实AI模式'}
          </button>
          <button
            data-tour="workbench-versions"
            aria-label={w.versions.length ? `V${w.versions[0].number}` : '版本'}
            className="top-action"
            onClick={() => setVersions(true)}
          >
            <History size={15} />
            <span>{w.versions.length ? `V${w.versions[0].number}` : '版本'}</span>
          </button>
          <button aria-label="预览" className="top-action" onClick={() => setPreview(true)}>
            <Eye size={15} />
            <span>预览</span>
          </button>
          <Button data-tour="workbench-export" onClick={() => setPreview(true)}>
            <Download size={14} />
            导出JD
          </Button>
        </div>
      </header>
      {aiState && (
        <div
          className={`workspace-ai-status ${aiState.status}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="workbench-ai-status"
        >
          {aiState.status === 'running' ? (
            <LoaderCircle size={18} className="spin" />
          ) : aiState.status === 'completed' ? (
            <Check size={18} />
          ) : (
            <X size={18} />
          )}
          <span>
            <strong>{aiState.message}</strong>
            {aiState.status === 'running' && (
              <small>{phase || '正在请求服务端'} · 可以继续编辑，结果合并前会检查版本</small>
            )}
          </span>
          {aiState.status === 'running' ? (
            <button
              aria-label="取消"
              title="取消本次AI处理"
              onClick={() => controller.current?.abort('user')}
            >
              取消本次AI处理
            </button>
          ) : (
            <button aria-label="关闭AI处理状态" onClick={() => setAIState(null)}>
              收起
            </button>
          )}
        </div>
      )}
      <DemoRibbon demo={w.demo} mode={w.mode} />
      {w.mode === 'example' && !w.example && !w.demo && (
        <div className="workbench-ai-mode-notice" role="status">
          <span>
            当前是手动/示例模式，任意新岗位不会套用订单示例。真实AI整理需要本机启用DeepSeek；切换本身不调用模型。
          </span>
          <button
            onClick={() =>
              update((c) => ({ ...c, mode: 'real', revision: c.revision + 1, updatedAt: now() }))
            }
          >
            切换为真实AI
          </button>
          <Link href="/settings/ai">查看本机配置</Link>
        </div>
      )}
      <WorkbenchFirstUse
        workspace={w}
        onCheck={openConfirmationCheck}
        onTasks={() => {
          ui({ view: 'tasks', objectTab: 'task' });
          setMobilePane('editor');
        }}
        onRequirements={() => {
          ui({ view: 'tasks', objectTab: 'requirement' });
          setMobilePane('editor');
        }}
        onJd={() => {
          switchView('jd');
          setMobilePane('editor');
        }}
        onSources={() => {
          ui({ leftOpen: true });
          setMobilePane('sources');
        }}
        onReview={() => {
          switchView('jd');
          setTab('ai');
          setMobilePane('review');
          const current = store.current.current!;
          ui({
            rightOpen: true,
            selectedId:
              current.items.find((i) => i.kind === 'block' && i.status !== 'excluded')?.id ??
              current.ui.selectedId,
          });
        }}
        onSave={() => setVersions(true)}
      />
      <div className="workspace-contextbar">
        <div className="breadcrumbs">
          <span>岗位共创</span>
          <ChevronRight size={12} />
          <strong>{blocks ? '形成与打磨JD' : '确认真实工作与岗位条件'}</strong>
          <span className="context-progress">
            {confirmed}/{active} 项已确认
          </span>
          {needs > 0 && (
            <button
              onClick={() => {
                setTab('questions');
                setMobilePane('review');
                ui({ rightOpen: true });
              }}
              className="review-count"
            >
              {needs} 项需复核
            </button>
          )}
        </div>
        <div>
          <button className="text-button" onClick={() => ui({ leftOpen: !w.ui.leftOpen })}>
            <PanelLeftClose size={14} />
            {w.ui.leftOpen ? '收起资料' : '展开资料'}
          </button>
          <button className="text-button" onClick={() => ui({ rightOpen: !w.ui.rightOpen })}>
            <PanelRightClose size={14} />
            {w.ui.rightOpen ? '收起助手' : '展开助手'}
          </button>
        </div>
      </div>
      {store.error && (
        <div role="alert" className="workspace-error">
          {store.error}
          <button onClick={store.retry}>重试保存</button>
          <button
            onClick={() =>
              downloadText(
                `${w.title}-岗位备份.json`,
                JSON.stringify(w, null, 2),
                'application/json',
              )
            }
          >
            导出完整备份
          </button>
          <button aria-label="关闭错误" onClick={() => store.setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="mobile-work-tabs">
        <button
          className={mobilePane === 'sources' ? 'active' : ''}
          onClick={() => setMobilePane('sources')}
        >
          资料
        </button>
        <button
          className={mobilePane === 'editor' ? 'active' : ''}
          onClick={() => setMobilePane('editor')}
        >
          任务 / JD
        </button>
        <button
          className={mobilePane === 'review' ? 'active' : ''}
          onClick={() => setMobilePane('review')}
        >
          共创助手
        </button>
      </div>
      <ResizableColumns layout={w.ui} onResize={ui} mobilePane={mobilePane}>
        <aside className={`sources-pane ${w.ui.leftOpen ? '' : 'desktop-hidden'}`}>
          <SourcePanel
            w={w}
            update={update}
            focus={focus}
            onReferenceDone={() => setFocus(null)}
            flush={store.flush}
          />
        </aside>
        <main id="main" className="editor-pane">
          <ResearchImportPanel workspace={w} update={update} flush={store.flush} />
          <div className="editor-toolbar">
            <div className="editor-views" role="tablist" aria-label="工作区视图">
              <button
                role="tab"
                aria-selected={w.ui.view === 'tasks'}
                onClick={() => switchView('tasks')}
              >
                <Layers size={15} />
                任务与要求
              </button>
              <button
                role="tab"
                aria-selected={w.ui.view === 'jd'}
                data-tour="workbench-jd-tab"
                onClick={() => switchView('jd')}
              >
                <FileText size={15} />
                JD编辑
              </button>
            </div>
            <div className="editor-ai-tools">
              <button
                data-tour="workbench-extract"
                disabled={busy || !w.sources.some((s) => !s.removed)}
                onClick={() => void run('extract')}
              >
                <Sparkles size={14} />
                从资料整理
              </button>
              <details>
                <summary aria-label="工作区更多操作">
                  <ChevronDown size={15} />
                </summary>
                <div className="more-menu">
                  <button disabled={busy} onClick={() => void run('questions')}>
                    整理待确认问题
                  </button>
                  <button disabled={busy} onClick={updateJD}>
                    {blocks ? '局部更新已有JD' : '生成JD草稿'}
                  </button>
                  <button
                    onClick={() =>
                      downloadText(
                        `${w.title}-岗位备份.json`,
                        JSON.stringify(w, null, 2),
                        'application/json',
                      )
                    }
                  >
                    导出完整岗位备份
                  </button>
                </div>
              </details>
            </div>
          </div>
          <div className="workflow-guide">
            <div>
              <details className="workflow-explanation">
                <summary>工作流与确认说明</summary>
                <strong>澄清问题 → 确认任务与要求 → 生成 JD → 审阅更新</strong>
                <p>
                  问题回答用于澄清依据；条目“确认”表示采纳内容。修改自动保存，JD 通过生成 /
                  更新后审阅。
                </p>
              </details>
              <button
                className="text-button"
                onClick={() => {
                  setTab('questions');
                  ui({ rightOpen: true });
                  setMobilePane('review');
                }}
              >
                问题待澄清 {openQuestions} 项
              </button>
              <span>
                {' '}
                · 内容已确认 {confirmed} / {active}
              </span>
            </div>
            <Button
              data-tour="workbench-generate-jd"
              onClick={updateJD}
              disabled={busy || (!blocks && !confirmed)}
              title={!blocks && !confirmed ? '请先确认至少一项任务或要求' : undefined}
            >
              {blocks ? <RefreshCw size={15} /> : <Sparkles size={15} />}
              {blocks ? '更新 JD' : '生成 JD 草稿'}
            </Button>
          </div>
          {w.example && !w.demo && w.ui.view === 'tasks' && (
            <div className="demo-guide">
              <span className="demo-step">演示路径</span>
              <p>看资料 → 整理任务 → 确认前端范围 → 补充技术栈 → 审阅差异 → 形成JD</p>
              {!w.sources.some((s) => s.type === 'supplement') && (
                <button onClick={addSupplement}>
                  <Plus size={12} />
                  补充演示技术栈
                </button>
              )}
            </div>
          )}
          {aiError && (
            <RequestErrorNotice
              className="center-ai-error"
              message={aiError}
              detail={errorDetail}
              onRetry={retryAI}
              onDismiss={() => setAIError('')}
            />
          )}
          <div className="center-scroll" ref={center}>
            <div hidden={w.ui.view !== 'tasks'}>
              <ItemsPanel
                w={w}
                update={update}
                select={select}
                onReference={reference}
                onSuggest={() => localAI()}
                onJumpJD={jump}
              />
            </div>
            <div hidden={w.ui.view !== 'jd'}>
              <JDPanel
                w={w}
                update={update}
                select={select}
                onReference={reference}
                onAI={localAI}
                busy={busy}
              />
            </div>
          </div>
          <div className="editor-statusbar">
            <span>{selected ? `已选：${selected.title}` : '选择任务、要求或JD段落，开始共创'}</span>
            <button className="text-button" onClick={() => setVersions(true)}>
              {w.versions.length} 个保存版本
            </button>
          </div>
        </main>
        <aside className={`review-pane ${w.ui.rightOpen ? '' : 'desktop-hidden'}`}>
          <ReviewPanel
            questionFocus={questionFocus}
            w={w}
            update={update}
            onReference={reference}
            select={jump}
            onRun={() => void run('suggest')}
            busy={busy}
            cancel={() => controller.current?.abort()}
            aiError={aiError}
            errorDetail={errorDetail}
            retryAI={retryAI}
            intent={intent}
            setIntent={setIntent}
            tab={tab}
            setTab={setTab}
          />
        </aside>
      </ResizableColumns>
      {jdUpdate && (
        <JDUpdateDialog
          w={w}
          onClose={() => setJDUpdate(false)}
          onSubmit={(targetId, text) => {
            setJDUpdate(false);
            ui({ view: 'jd', selectedId: targetId, rightOpen: true });
            setTab('ai');
            setIntent(text);
            setMobilePane('review');
            void run('suggest', text, { targetId, scope: 'selected' });
          }}
        />
      )}
      {notice && (
        <div className="work-toast" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {preview && <PreviewDialog w={w} onClose={() => setPreview(false)} />}{' '}
      {versions && <VersionsDialog w={w} update={update} onClose={() => setVersions(false)} />}
      {settings && (
        <Modal title="岗位与运行模式" onClose={() => setSettings(false)}>
          <div className="form-stack">
            <label>
              岗位名称
              <input
                className="field"
                aria-label="修改岗位名称"
                value={w.title}
                maxLength={200}
                onChange={(e) => {
                  if (e.target.value.trim())
                    update((c) => ({
                      ...c,
                      title: e.target.value,
                      revision: c.revision + 1,
                      updatedAt: now(),
                    }));
                }}
              />
            </label>
            <label>
              AI协作方式
              <select
                className="field"
                aria-label="AI协作方式"
                value={w.mode}
                onChange={(e) =>
                  update((c) => ({
                    ...c,
                    mode: e.target.value as Workspace['mode'],
                    revision: c.revision + 1,
                    updatedAt: now(),
                  }))
                }
              >
                <option value="example">示例演示 / 预置响应</option>
                <option value="real">真实AI（外部DeepSeek，按服务商计费）</option>
              </select>
            </label>
            <p className="callout subtle">
              模式切换不会改变岗位内容。真实模式只有在主动点击模型操作时才发送资料，失败不会回退预置答案。本地保存仅限当前浏览器，未完成云端多人同步。
            </p>
            <Link className="example-link" href="/examples?stage=workbench">
              查看隔离示例、复制或安全重置 ↗
            </Link>
            <Button onClick={() => setSettings(false)}>完成</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
