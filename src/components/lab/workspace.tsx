'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Network,
  Undo2,
  Redo2,
  History,
  Save,
  Download,
  PanelRightClose,
  PanelRightOpen,
  Square,
  Menu,
} from 'lucide-react';
import { useExploration } from '@/hooks/use-exploration';
import { TrashedProjectNotice } from '../exploration/trashed-notice';
import { Modal } from '../workbench/modal';
import { SourceForm } from '../exploration/source-form';
import { SourceViewer } from '../exploration/source-viewer';
import { RolePanel } from './role-panel';
import { NodeInspector, EdgeInspector } from './node-inspector';
import { AnnotationEditor } from './annotation-editor';
import { LabImportDialog } from './import-dialog';
import { GuidedResearch } from './guided-research';
import { PlanningResearch, type PlanningInput } from './planning-research';
import { ResearchGuide } from './research-guide';
import { DemoRibbon } from '../examples/demo-ribbon';
import { DecisionDrafts } from '../decisions/decision-fields';
import { resolveDecision } from '@/lib/decisions/records';
import type { TutorialLaunch } from '../guidance/interactive-guide';
import type { GuidedActions } from './guided-types';
import { planningTasks, planningSignature } from '@/lib/lab/planning';
import { synchronizeLab, assertLab, digest, relationKey, rebindLabProject } from '@/lib/lab/graph';
import {
  moveNode,
  collapseNode,
  pinEvidence,
  mergeRelation,
  saveProductIdea,
  savePlanningConstraints,
  savePlanningPreference,
  editResearchGoal,
  compactBoard,
} from '@/lib/lab/operations';
import {
  buildLabRequest,
  recordLocalStages,
  beginStage,
  finishStage,
  mergeStageResult,
} from '@/lib/lab/workflow';
import {
  stageNames,
  relationNames,
  relationTypes,
  type LabStage,
  type GraphEdge,
} from '@/lib/lab/model';
import { aiStages, labResultSchema, labPromptVersions } from '@/lib/lab/ai-contract';
import { readAIResponse, AIRequestError } from '@/lib/workbench/request-error';
import { touchExploration, textEvidence, createSnapshot } from '@/lib/exploration/domain';
import { evidenceValid } from '@/lib/exploration/domain';
import { undoResearch, redoResearch } from '@/lib/exploration/journal';
import { explorationStore } from '@/lib/exploration/storage';
import { assetReferences, forkResearch } from '@/lib/exploration/research';
import { exportPackage } from '@/lib/exploration/portable';
import { materialFromSnapshot } from '@/lib/exploration/material';
import { type Exploration, type Snapshot } from '@/lib/exploration/model';
const BoardCanvas = dynamic(() => import('./board-canvas').then((m) => m.BoardCanvas), {
  ssr: false,
  loading: () => (
    <p role="status" className="lab-board-loading">
      正在装载证据画布…
    </p>
  ),
});
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Store = {
  project: Exploration;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  current: { current: Exploration | null };
  flush: () => Promise<void>;
  saveState: string;
  error: string;
  setError: (v: string) => void;
  retry: () => void;
};
export function LabWorkspace({ id }: { id: string }) {
  const store = useExploration(id, 350);
  const { project, update } = store;
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (project && !project.trashedAt && initialized.current !== id) {
      initialized.current = id;
      update((p) => {
        const next = synchronizeLab(p);
        for (const run of next.lab!.runs)
          if (run.status === 'running' || run.status === 'queued') {
            run.status = 'cancelled';
            run.completedAt = new Date().toISOString();
            run.errorCode = 'INTERRUPTED';
            run.errorMessage = '上次页面会话已结束，未恢复旧模型连接。请重试需要的阶段。';
          }
        return next;
      });
    }
  }, [id, project, update]);
  if (store.loading) return <p role="status">正在读取本机研究…</p>;
  if (!store.project)
    return (
      <p role="alert">
        {store.error}
        <Link href="/lab">返回需求实验室</Link>
      </p>
    );
  if (store.project.trashedAt) return <TrashedProjectNotice project={store.project} />;
  if (!store.project.lab) return <p role="status">正在恢复证据板…</p>;
  return (
    <DecisionDrafts>
      <LabSurface key={store.project.id} {...store} project={store.project} />
    </DecisionDrafts>
  );
}
function LabSurface({
  project: p,
  update: rawUpdate,
  current,
  flush,
  saveState,
  error,
  setError,
  retry,
  readonly = false,
  snapshot,
}: { readonly?: boolean; snapshot?: Snapshot } & Store) {
  const router = useRouter(),
    lab = p.lab!;
  const update = (fn: (p: Exploration) => Exploration) =>
    readonly ? false : rawUpdate((n) => synchronizeLab(fn(n)));
  const [add, setAdd] = useState(false),
    [addKind, setAddKind] = useState<'text' | 'url' | 'file'>('text'),
    [boardSeen, setBoardSeen] = useState(lab.ui.researchView === 'board'),
    [planningSeen, setPlanningSeen] = useState(lab.ui.researchMode === 'plan'),
    [files, setFiles] = useState<File[]>([]),
    [sourceId, setSourceId] = useState<string | null>(null),
    [evidenceId, setEvidenceId] = useState<string | null>(null),
    [inspector, setInspector] = useState<string | null>(null),
    [edgeId, setEdgeId] = useState<string | null>(null),
    [annotation, setAnnotation] = useState<string | null>(null),
    [history, setHistory] = useState(false),
    [runsOpen, setRunsOpen] = useState(false),
    [guide, setGuide] = useState(false),
    [tutorialLaunch, setTutorialLaunch] = useState<TutorialLaunch>(null),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState<LabStage | null>(null),
    [consent, setConsent] = useState<{
      stage?: (typeof aiStages)[number];
      scope: string[];
      tasks?: (typeof aiStages)[number][];
      planning?: boolean;
    } | null>(null),
    [importing, setImporting] = useState<Snapshot | null>(null),
    [menu, setMenu] = useState(false),
    [indexOpen, setIndexOpen] = useState(false),
    [connecting, setConnecting] = useState<{ from: string; to: string } | null>(null),
    [relation, setRelation] = useState<GraphEdge['relationType']>('weakly_related'),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState('');
  const gate = useRef(false),
    planningGate = useRef(false),
    controller = useRef<AbortController | null>(null),
    cancelled = useRef(false),
    right = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const isBoard = lab.ui.researchView === 'board';
  const isPlanning = lab.ui.researchMode === 'plan';
  function switchResearchView(view: 'guided' | 'board') {
    if (view === 'board') setBoardSeen(true);
    ui({ researchView: view });
  }
  function focusNode(id: string) {
    setBoardSeen(true);
    ui({
      researchView: 'board',
      selectedNodeId: id,
      selectedEdgeId: null,
      focusedRequirementId: id.startsWith('requirement:') ? id.slice(12) : null,
      focusTarget: id.startsWith('requirement:') ? null : { kind: 'node', id },
    });
  }
  function focusRelation(id: string) {
    setBoardSeen(true);
    ui({
      researchView: 'board',
      selectedEdgeId: id,
      selectedNodeId: null,
      focusedRequirementId: null,
      focusTarget: { kind: 'edge', id },
    });
    setEdgeId(id);
  }
  function ui(patch: Partial<typeof lab.ui>) {
    rawUpdate((n) => {
      const next = structuredClone(n);
      Object.assign(next.lab!.ui, patch);
      return next;
    });
  }
  function openNode(id: string) {
    const node = current.current?.lab?.nodes.find((n) => n.id === id);
    if (node?.type === 'question' && !isBoard) {
      focusDecision(node.content.questionId);
      return;
    }
    setInspector(id);
    setEdgeId(null);
  }
  function focusDecision(id: string) {
    const q = resolveDecision(current.current?.questions ?? [], id);
    if (!q) return;
    if (isBoard) {
      setInspector(`question:${q.id}`);
      return;
    }
    ui(isPlanning ? { planningScreen: 'results' } : { researchStep: 'evidence' });
    let attempts = 0;
    const locate = () => {
      const entry = [...document.querySelectorAll<HTMLElement>('[data-decision-entry]')].find(
        (e) => e.dataset.decisionEntry === q.id && !e.closest('[hidden]'),
      );
      if (!entry) {
        if (attempts++ < 15) requestAnimationFrame(locate);
        return;
      }
      for (let parent = entry.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      entry.scrollIntoView({ block: 'center', behavior: 'auto' });
      entry.focus({ preventScroll: true });
    };
    requestAnimationFrame(locate);
  }
  function openSource(id: string, eid?: string) {
    ui({ evidenceViewed: true });
    setSourceId(id);
    setEvidenceId(eid ?? null);
    setInspector(null);
    setEdgeId(null);
  }
  async function analyze(
    only?: (typeof aiStages)[number],
    scope: string[] = [],
    tasks?: (typeof aiStages)[number][],
    planning = false,
  ) {
    if (gate.current || readonly) return;
    gate.current = true;
    cancelled.current = false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      update((n) => recordLocalStages(n));
      for (const task of tasks ?? (only ? [only] : aiStages)) {
        if (cancelled.current) break;
        const base = current.current;
        if (!base) throw new Error('研究已关闭。');
        if (planning && !planningTasks(base).includes(task)) continue;
        const input = buildLabRequest(base, task, scope),
          signature = digest(input.inputVersions);
        if (
          !only &&
          base.lab!.runs.some(
            (r) => r.stage === task && r.inputSignature === signature && r.status === 'succeeded',
          )
        )
          continue;
        const started = beginStage(base, task, input.inputVersions, scope, labPromptVersions[task]);
        if (!scope.length)
          started.project.lab!.runs.find((r) => r.id === started.run.id)!.planningSignature =
            planningSignature(base, task);
        if (!update(() => started.project)) throw new Error('无法保存分析任务状态。');
        setStage(task);
        const own = new AbortController();
        controller.current = own;
        const timeout = setTimeout(() => own.abort('timeout'), 65000);
        try {
          const response = await fetch(`/api/lab/${task}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: own.signal,
          });
          if (!response.ok) await readAIResponse(response);
          const data = await response.json();
          if (cancelled.current || own.signal.aborted) break;
          if (
            data.projectId !== input.projectId ||
            data.baseRevision !== input.revision ||
            JSON.stringify(data.inputVersions) !== JSON.stringify(input.inputVersions)
          )
            throw new Error('响应绑定不一致，未应用。');
          const result = labResultSchema.parse({ stage: data.stage, output: data.output });
          if (
            !update((n) =>
              mergeStageResult(n, started.run.id, input, result, {
                requestId: data.requestId,
                promptVersion: data.promptVersion,
                modelConfigId: data.modelConfig.configurationId,
                mode: data.mode,
              }),
            )
          )
            throw new Error('结果合并失败；现有编辑保留。');
          setNotice(`${stageNames[task]}已结束，请审阅新增候选。`);
          if (planning) {
            await flush();
            const latest = current.current?.lab?.runs.find((r) => r.id === started.run.id);
            if (latest?.status !== 'succeeded') {
              setError(latest?.errorMessage || '存在过期结果，已保留有效内容，请核对后继续。');
              break;
            }
          }
        } catch (e) {
          const aborted = own.signal.aborted,
            wasCancelled = cancelled.current;
          const message = wasCancelled
            ? '用户取消，已完成阶段和编辑保留。'
            : aborted
              ? '本阶段请求超时，编辑保留，可重试。'
              : e instanceof Error
                ? e instanceof AIRequestError
                  ? `${e.message} · ${e.code}${e.requestId ? ` · 请求编号：${e.requestId}` : ''}${e.validationIssues?.length ? '\n' + e.validationIssues.map((issue) => `${issue.path}：${issue.message}`).join('\n') : ''}`
                  : e.message
                : '模型请求失败';
          update((n) =>
            finishStage(n, started.run.id, {
              status: wasCancelled ? 'cancelled' : 'failed',
              errorCode: wasCancelled
                ? 'CANCELLED'
                : aborted
                  ? 'TIMEOUT'
                  : e instanceof AIRequestError
                    ? e.code
                    : 'STAGE_FAILED',
              errorMessage: message,
              ...(e instanceof AIRequestError && e.requestId ? { requestId: e.requestId } : {}),
            }),
          );
          if (!wasCancelled) setError(message);
          break;
        } finally {
          clearTimeout(timeout);
          if (controller.current === own) controller.current = null;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析未启动');
    } finally {
      setBusy(false);
      setStage(null);
      gate.current = false;
    }
  }
  function requestAnalysis(
    only?: (typeof aiStages)[number],
    scope: string[] = [],
    tasks?: (typeof aiStages)[number][],
    planning = false,
  ) {
    if (p.mode === 'real') setConsent({ stage: only, scope, tasks, planning });
    else void analyze(only, scope, tasks, planning);
  }
  async function startPlanning(input?: PlanningInput) {
    if (gate.current || planningGate.current || readonly) return;
    planningGate.current = true;
    setError('');
    try {
      if (input) {
        if (input.goal.trim() && input.goal.trim().length < 4)
          throw new Error('目标太短，请用一句话说明想实现的用途；不必填写技术栈或岗位。');
        if (
          !update((n) => {
            let next = n;
            const source = n.sources.find(
              (s) => !s.removed && s.kind === 'text' && s.versions[0].text === n.initialObjective,
            );
            if (input.goal.trim() && source?.versions.at(-1)?.text !== input.goal.trim()) {
              next = saveProductIdea(next, input.goal, input.expectedRevision);
              next = editResearchGoal(next, input.goal);
            }
            return savePlanningConstraints(next, input.budget, input.deadline, input.constraints);
          })
        )
          return;
      }
      const base = current.current!;
      const ownSavedRevision = base.sources
        .find(
          (s) => !s.removed && s.kind === 'text' && s.versions[0].text === base.initialObjective,
        )
        ?.versions.at(-1)?.revision;
      if (
        !base.evidence.some(
          (e) =>
            evidenceValid(base, e) &&
            base.sources.some((s) => s.id === e.sourceId && s.title !== '规划约束（用户补充）'),
        )
      ) {
        if (base.sources.some((s) => s.status === 'error'))
          throw new Error('已有资料解析失败，请查看错误并重试、替换或补充目标文字。');
        if (base.sources.some((s) => ['image', 'video'].includes(s.kind)))
          throw new Error(
            '文件已保存，但尚无已核对的画面证据；请填写一句目标，或先识图并接受候选标注。',
          );
        throw new Error('先填写一句产品目标，或添加一份可解析的公开网页或文档。');
      }
      await flush();
      ui({ planningScreen: 'results' });
      const tasks = planningTasks(current.current!);
      if (!tasks.length) {
        setNotice('现有分析仍然有效，继续比较与选择；没有重复请求模型。');
        return ownSavedRevision;
      }
      requestAnalysis(undefined, [], tasks, true);
      return ownSavedRevision;
    } catch (e) {
      setError(e instanceof Error ? e.message : '规划未启动，输入保留。');
    } finally {
      planningGate.current = false;
    }
  }
  async function snapshotNow(openImport = false) {
    try {
      setError('');
      await flush();
      const base = synchronizeLab(current.current!);
      assertLab(base);
      if (base.snapshots.length >= 20) throw new Error('每个研究最多20份快照，请复制或派生研究。');
      const available = new Set<string>();
      for (const id of assetReferences(base))
        if (await explorationStore.asset(id)) available.add(id);
      const saved = createSnapshot(base, 'draft', available);
      if (
        !update((n) => {
          const next = structuredClone(n);
          next.snapshots.unshift(saved);
          return touchExploration(next, `保存不可变研究快照 V${saved.version}`);
        })
      )
        return;
      await flush();
      setNotice(`快照 V${saved.version} 已保存；后续修改不会覆盖它。`);
      if (openImport) setImporting(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存快照失败，草稿保留');
    }
  }
  async function exported(kind: 'package' | 'material') {
    try {
      await flush();
      const base = snapshot ?? current.current!;
      if (kind === 'package') download(`${p.title}-完整研究包.json`, await exportPackage(base));
      else {
        const s = snapshot ?? current.current!.snapshots[0];
        if (!s) throw new Error('请先保存快照，再导出产品需求JSON。');
        download(
          `${s.title}-V${s.version}-产品需求.json`,
          JSON.stringify(materialFromSnapshot(s), null, 2),
        );
      }
      setNotice('已生成下载文件。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    }
  }
  const activeNode = lab.nodes.find((n) => n.id === inspector),
    lastUndo = p.operations?.filter((o) => !o.undone).at(-1),
    lastRedo = [...(p.operations ?? [])]
      .filter((o) => o.undone && o.redoable !== false)
      .sort((a, b) => (b.undoneAt ?? '').localeCompare(a.undoneAt ?? ''))[0];
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const researchActions: GuidedActions = {
    onAnswer: focusDecision,
    project: p,
    update,
    readonly,
    busy,
    onAdd: (kind) => {
      setFiles([]);
      setAddKind(kind ?? 'text');
      setAdd(true);
    },
    onSource: openSource,
    onAnnotation: setAnnotation,
    onEdit: openNode,
    onEdge: focusRelation,
    onFocus: focusNode,
    onAnalyze: (task, scope) =>
      requestAnalysis(
        task,
        scope,
        task === 'link_evidence' ? ['derive_features', 'link_evidence'] : undefined,
      ),
    onImport: () => void snapshotNow(true),
    onSnapshot: () => void snapshotNow(),
    onExport: (kind) => void exported(kind),
    onHistory: () => setHistory(true),
  };
  return (
    <div
      className="lab-app"
      id="main"
      onPaste={(e) => {
        if (
          readonly ||
          add ||
          (e.target as HTMLElement).closest('input,textarea,[contenteditable]')
        )
          return;
        const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
        if (images.length) {
          e.preventDefault();
          setFiles(images);
          setAdd(true);
        }
      }}
    >
      <header className="lab-topbar">
        <Link href="/lab" className="lab-back">
          <ArrowLeft size={18} />
          <span>需求实验室</span>
        </Link>
        <div className="lab-project-heading">
          <input
            aria-label="研究标题"
            value={p.title}
            readOnly={readonly}
            maxLength={200}
            onChange={(e) =>
              update((n) => touchExploration({ ...n, title: e.target.value || '未命名研究' }))
            }
          />
          <small role="status">
            {readonly
              ? `不可变快照 V${snapshot?.version}`
              : saveState === 'saved'
                ? '已保存到本浏览器'
                : saveState === 'saving'
                  ? '保存中… / 存在未保存修改'
                  : '保存失败，内存编辑保留'}{' '}
            ·{' '}
            {p.mode === 'example'
              ? '演示数据，非真实AI分析'
              : p.findings.some((f) => f.analysisMode === 'example') ||
                  lab.solutions.some((s) => s.generatedBy === 'example')
                ? '真实模式 · 含演示候选，非真实AI分析'
                : '真实AI模式'}
          </small>
        </div>
        <div className="lab-top-actions">
          <label className="lab-mode-control">
            研究方式
            <select
              aria-label="研究方式"
              value={lab.ui.researchMode}
              onChange={(e) => {
                const researchMode = e.target.value as 'plan' | 'collaborate';
                if (researchMode === 'plan') setPlanningSeen(true);
                ui({ researchMode });
              }}
            >
              <option value="plan">AI帮我规划</option>
              <option value="collaborate">和AI一起研究</option>
            </select>
          </label>
          <button
            className="lab-view-switch"
            onClick={() => switchResearchView(isBoard ? 'guided' : 'board')}
          >
            {isBoard ? '返回引导式研究' : '查看完整证据板'}
          </button>
          {!readonly && (
            <>
              <button
                data-tour="lab-add-source"
                onClick={() => {
                  setFiles([]);
                  setAddKind('text');
                  setAdd(true);
                }}
              >
                <Plus size={16} />
                添加资料
              </button>
              {isBoard && (
                <button
                  className="lab-primary"
                  disabled={busy || !p.evidence.some((e) => e.verificationStatus === 'verified')}
                  onClick={() => requestAnalysis()}
                >
                  <Network size={16} />
                  {busy ? `${stage ? stageNames[stage] : '准备分析'}…` : '关联分析'}
                </button>
              )}
              {busy && (
                <button
                  onClick={() => {
                    cancelled.current = true;
                    controller.current?.abort('user');
                  }}
                >
                  <Square size={14} />
                  取消分析
                </button>
              )}
              <button
                aria-label="撤销上一步操作"
                disabled={!lastUndo}
                onClick={() => lastUndo && update((n) => undoResearch(n, lastUndo.id))}
              >
                <Undo2 size={17} />
              </button>
              <button
                aria-label="重做上一步操作"
                disabled={!lastRedo}
                onClick={() => lastRedo && update((n) => redoResearch(n, lastRedo.id))}
              >
                <Redo2 size={17} />
              </button>
            </>
          )}
          <button aria-expanded={menu} aria-label="更多研究操作" onClick={() => setMenu(!menu)}>
            <Menu size={18} />
          </button>
          {isBoard && (
            <button
              aria-label={lab.ui.rightOpen ? '收起岗位面板' : '展开岗位面板'}
              onClick={() => ui({ rightOpen: !lab.ui.rightOpen })}
            >
              {lab.ui.rightOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          )}
        </div>
      </header>
      <DemoRibbon demo={p.demo} mode={p.mode} />
      {menu && (
        <nav
          className="lab-menu"
          aria-label="研究操作"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button,a')) setMenu(false);
          }}
        >
          {!readonly && (
            <label>
              分析模式
              <select
                aria-label="研究分析模式"
                value={p.mode}
                disabled={busy}
                onChange={(e) =>
                  update((n) =>
                    touchExploration({ ...n, mode: e.target.value as Exploration['mode'] }),
                  )
                }
              >
                <option value="example">示例（非真实AI）</option>
                <option value="real">真实DeepSeek（发送前确认）</option>
              </select>
            </label>
          )}
          <button
            onClick={() => {
              setMenu(false);
              setIndexOpen(true);
            }}
          >
            资料与关系列表
          </button>
          <button onClick={() => setHistory(true)}>
            <History size={15} />
            历史快照
          </button>
          <button onClick={() => setRunsOpen(true)}>分析阶段与操作记录</button>
          {!readonly && (
            <button onClick={() => void snapshotNow()}>
              <Save size={15} />
              保存快照
            </button>
          )}
          <button onClick={() => void exported('material')}>导出产品需求JSON</button>
          <button onClick={() => void exported('package')}>
            <Download size={15} />
            导出完整研究包
          </button>
          <Link href="/explore/history">全部研究历史</Link>
          <Link href={`/explore/${p.id}`}>打开资料详细编辑器</Link>
          <button onClick={() => setGuide(true)}>查看使用引导</button>
        </nav>
      )}
      {(error || saveState === 'failed') && (
        <div role="alert" className="lab-message error">
          {error || '保存失败，原数据和当前编辑保留。'}
          {saveState === 'failed' && <button onClick={retry}>重试保存</button>}
          <button onClick={() => setError('')}>收起</button>
        </div>
      )}
      {notice && (
        <div role="status" className="lab-message">
          {notice}
          <button onClick={() => setNotice('')}>收起</button>
        </div>
      )}
      {(planningSeen || isPlanning) && (
        <PlanningResearch
          {...researchActions}
          hidden={isBoard || !isPlanning}
          onStart={(input) => startPlanning(input)}
          onContinue={() => void startPlanning()}
          onScreen={(planningScreen) => ui({ planningScreen })}
          onCollaborate={() => ui({ researchMode: 'collaborate', researchView: 'guided' })}
          onPreference={(text) => {
            update((n) => savePlanningPreference(n, text));
          }}
        />
      )}
      <ResearchGuide project={p} ui={ui} launch={tutorialLaunch} enabled={!readonly && !isBoard} />
      <GuidedResearch
        {...researchActions}
        hidden={isBoard || isPlanning}
        step={lab.ui.researchStep}
        onStep={(researchStep) => ui({ researchStep })}
        onBoard={() => switchResearchView('board')}
      />
      <div className="lab-body" hidden={!isBoard}>
        {(boardSeen || isBoard) && (
          <BoardCanvas
            project={p}
            active={isBoard}
            onMove={(id, position) => !readonly && update((n) => moveNode(n, id, position))}
            onCompact={readonly ? undefined : () => update(compactBoard)}
            onViewport={(viewport) => ui({ viewport })}
            onSelect={(id) => ui({ selectedNodeId: id, selectedEdgeId: null })}
            onEdge={focusRelation}
            onOpen={openNode}
            onSource={openSource}
            onCollapse={(id) => update((n) => collapseNode(n, id))}
            onEvidence={(id) => {
              const e = p.evidence.find((e) => e.evidenceId === id);
              if (e?.sourceId) openSource(e.sourceId, id);
            }}
            onPin={(id) => update((n) => pinEvidence(n, id))}
            onConnect={(from, to) => {
              if (!readonly) {
                setConnecting({ from, to });
                setReason('');
              }
            }}
            onRestoreFocus={() => ui({ focusedRequirementId: null, focusTarget: null })}
            onDensity={(boardDensity) => ui({ boardDensity })}
            onFilter={(types, relations, status) => ui({ filters: { types, relations, status } })}
          />
        )}
        {lab.ui.rightOpen && (
          <>
            <div
              className="lab-panel-resizer"
              role="separator"
              aria-label="调整岗位面板宽度"
              aria-orientation="vertical"
              aria-valuemin={300}
              aria-valuemax={600}
              aria-valuenow={lab.ui.rightWidth}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  ui({
                    rightWidth: Math.min(
                      600,
                      Math.max(300, lab.ui.rightWidth + (e.key === 'ArrowLeft' ? 20 : -20)),
                    ),
                  });
                }
              }}
              onPointerDown={(e) => {
                resizeStart.current = { x: e.clientX, width: lab.ui.rightWidth };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (resizeStart.current && right.current)
                  right.current.style.width = `${Math.max(300, Math.min(600, resizeStart.current.width + resizeStart.current.x - e.clientX))}px`;
              }}
              onPointerUp={(e) => {
                const start = resizeStart.current;
                if (start) {
                  resizeStart.current = null;
                  ui({
                    rightWidth: Math.max(300, Math.min(600, start.width + start.x - e.clientX)),
                  });
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
            />
            <div className="lab-role-wrap" ref={right} style={{ width: lab.ui.rightWidth }}>
              <RolePanel
                project={p}
                update={update}
                onFocus={(id) => focusNode(`requirement:${id}`)}
                onSource={openSource}
                onEdge={focusRelation}
                onEdit={openNode}
                onImport={() => void snapshotNow(true)}
                readonly={readonly}
              />
            </div>
          </>
        )}
      </div>
      {add && (
        <SourceForm
          project={p}
          initial={files.length ? 'file' : addKind}
          initialFiles={files}
          onClose={() => setAdd(false)}
          onAdd={(source) => {
            update((n) => {
              const next = structuredClone(n);
              next.sources.push(source);
              next.evidence.push(...textEvidence(source, source.versions.at(-1)!));
              return touchExploration(next, `添加研究资料：${source.title}`);
            });
          }}
        />
      )}
      {sourceId && (
        <Modal title="原始资料与证据定位" onClose={() => setSourceId(null)} wide>
          <SourceViewer
            onRecognize={(id) => {
              setSourceId(null);
              setAnnotation(id);
            }}
            project={{ ...p, ui: { ...p.ui, sourceId, evidenceId } }}
            source={p.sources.find((s) => s.id === sourceId)}
            update={update}
            jumpFinding={(id) => {
              setSourceId(null);
              openNode(`finding:${id}`);
            }}
            onReturn={() => setSourceId(null)}
            onSupplement={() => {
              setSourceId(null);
              setAdd(true);
            }}
          />
        </Modal>
      )}
      {activeNode && (
        <NodeInspector
          key={activeNode.id}
          project={p}
          node={activeNode}
          update={update}
          onClose={() => setInspector(null)}
          onSource={openSource}
          onAnnotation={(id) => {
            setInspector(null);
            setAnnotation(id);
          }}
          onAnalyze={(id) => {
            setInspector(null);
            requestAnalysis('derive_features', [id]);
          }}
          readonly={readonly}
        />
      )}
      {edgeId && (
        <EdgeInspector
          project={p}
          id={edgeId}
          update={update}
          onClose={() => setEdgeId(null)}
          onSource={openSource}
          readonly={readonly}
        />
      )}
      {annotation && (
        <AnnotationEditor
          project={p}
          sourceId={annotation}
          update={update}
          onClose={() => setAnnotation(null)}
          readonly={readonly}
        />
      )}
      {consent && (
        <Modal title="确认发送范围后分析" onClose={() => setConsent(null)}>
          <p>
            本次会将
            {consent.scope.length ? '所选对象及其必要证据链' : '本研究中已解析、可定位的文字与证据'}
            发送至外部 DeepSeek
            服务。资料作为待分析数据处理，不会发送API密钥给浏览器。图片原图和视频不会被自动发送。
          </p>
          <p>完成阶段后请求结束，等待人工确认时不保持模型连接。</p>
          <button
            className="lab-primary"
            onClick={() => {
              const own = consent;
              setConsent(null);
              void analyze(own.stage, own.scope, own.tasks, own.planning);
            }}
          >
            我确认并开始本次分析
          </button>
        </Modal>
      )}
      {indexOpen && (
        <Modal title="资料与关系列表" onClose={() => setIndexOpen(false)} wide>
          <div className="form-stack">
            <h3>原始资料</h3>
            {p.sources.map((s) => (
              <article className="lab-history-row" key={s.id}>
                <strong>
                  {s.title} ·{' '}
                  {s.removed
                    ? '已移除'
                    : s.status === 'ready'
                      ? '解析完成'
                      : s.status === 'error'
                        ? '解析失败'
                        : s.status === 'partial'
                          ? '部分解析'
                          : s.status}
                </strong>
                {s.error && <p>{s.error}</p>}
                <div className="explore-inline-actions">
                  <button
                    onClick={() => {
                      setIndexOpen(false);
                      openNode(`source:${s.id}`);
                    }}
                  >
                    查看资料节点
                  </button>
                  <button
                    onClick={() => {
                      setIndexOpen(false);
                      openSource(s.id);
                    }}
                  >
                    查看原文
                  </button>
                  {['image', 'document', 'video'].includes(s.kind) && (
                    <button
                      onClick={() => {
                        setIndexOpen(false);
                        setAnnotation(s.id);
                      }}
                    >
                      区域标注
                    </button>
                  )}
                </div>
              </article>
            ))}
            <h3>全部关系（含删除记录）</h3>
            {lab.edges.map((e) => (
              <button
                className="lab-proof"
                key={e.id}
                onClick={() => {
                  setIndexOpen(false);
                  setEdgeId(e.id);
                }}
              >
                {relationNames[e.relationType]} ·{' '}
                {lab.nodes.find((n) => n.id === e.sourceNodeId)?.title} →{' '}
                {lab.nodes.find((n) => n.id === e.targetNodeId)?.title} ·{' '}
                {e.status === 'deleted' ? '已删除' : e.status === 'pending' ? '待审核' : e.status}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {history && (
        <Modal title="历史快照 · 不可变研究版本" onClose={() => setHistory(false)} wide>
          <div className="form-stack">
            {!readonly && (
              <button className="lab-primary" onClick={() => void snapshotNow()}>
                保存当前研究快照
              </button>
            )}
            {p.snapshots.map((s) => (
              <article key={s.snapshotId} className="lab-history-row">
                <strong>
                  V{s.version} · {s.title}
                </strong>
                <small>
                  {new Date(s.createdAt).toLocaleString('zh-CN')} · 父版本{' '}
                  {s.lineage?.parentSnapshotId ?? '无'}
                </small>
                <Link href={`/lab/snapshots/${s.snapshotId}`}>在证据板打开旧版本</Link>
                <Link href={`/explore/snapshots/${s.snapshotId}`}>查看全过程、比较与复制</Link>
              </article>
            ))}
            {!p.snapshots.length && <p>尚未保存快照；草稿自动保存与正式快照分别管理。</p>}
          </div>
        </Modal>
      )}
      {runsOpen && (
        <Modal title="分析阶段与操作记录" onClose={() => setRunsOpen(false)} wide>
          <div className="form-stack">
            {lab.runs
              .slice()
              .reverse()
              .map((r) => (
                <article className="lab-history-row" key={r.id}>
                  <strong>
                    {stageNames[r.stage]} ·{' '}
                    {
                      {
                        queued: '排队',
                        running: '运行中',
                        succeeded: '成功',
                        partial: '部分完成',
                        failed: '失败',
                        cancelled: '已取消',
                        stale: '过期',
                      }[r.status]
                    }
                  </strong>
                  <p>{r.resultSummary || r.errorMessage || '等待真实响应，不生成虚假进度。'}</p>
                  <small>
                    {r.promptVersion} · 输入版本{r.inputRevision} · {r.startedAt}
                  </small>
                  {!readonly &&
                    aiStages.includes(r.stage as (typeof aiStages)[number]) &&
                    r.status !== 'running' && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRunsOpen(false);
                          requestAnalysis(r.stage as (typeof aiStages)[number], r.scopeNodeIds);
                        }}
                      >
                        仅重试这个阶段
                      </button>
                    )}
                </article>
              ))}
            <h3>统一操作历史</h3>
            {p.operations?.slice(0, 80).map((o) => (
              <article key={o.id}>
                <span>
                  {o.label} · {o.undone ? '已撤销' : '已执行'}
                </span>
                {!readonly && !o.undone && (
                  <button onClick={() => update((n) => undoResearch(n, o.id))}>撤销此操作</button>
                )}
              </article>
            ))}
          </div>
        </Modal>
      )}
      {guide && (
        <Modal
          title="从资料到岗位 · 五阶段研究"
          onClose={() => {
            setGuide(false);
            ui({ guided: true });
          }}
        >
          <ol className="lab-guide">
            <li>整理资料：保存产品构想，添加资料并核对真实解析状态。</li>
            <li>确认证据：先看关键片段与冲突双方，次要问题可以稍后处理。</li>
            <li>整理产品需求：编辑、合并或排除候选功能，区分参考能力与自己的需求。</li>
            <li>比较岗位方案：查看成立条件和取舍，选择或组合方案，独立确认岗位要求。</li>
            <li>导出并继续共创：保存不可变快照，预览并部分导入工作台，任务与要求默认待确认。</li>
          </ol>
          <button
            className="lab-primary"
            onClick={() => {
              setGuide(false);
              ui({ guided: true });
            }}
          >
            关闭说明，继续研究
          </button>
          <button
            onClick={() => {
              setGuide(false);
              setTutorialLaunch({ token: Date.now(), restart: false });
            }}
          >
            继续交互教程
          </button>
          <button
            onClick={() => {
              setGuide(false);
              setTutorialLaunch({ token: Date.now(), restart: true });
            }}
          >
            重新演示教程
          </button>
          <p>数据只保存在此浏览器与设备。请导出完整研究包备份。</p>
          <p>随时打开完整证据板，深入查看来源、关系、标注与撤销历史；返回后仍在当前阶段。</p>
        </Modal>
      )}
      {connecting && (
        <Modal title="创建明确语义的关联" onClose={() => setConnecting(null)}>
          <div className="form-stack">
            <p>
              {lab.nodes.find((n) => n.id === connecting.from)?.title} →{' '}
              {lab.nodes.find((n) => n.id === connecting.to)?.title}
            </p>
            <label>
              关系类型
              <select
                value={relation}
                onChange={(e) => setRelation(e.target.value as GraphEdge['relationType'])}
              >
                {relationTypes
                  .filter((t) => t !== 'conflicts_with')
                  .map((t) => (
                    <option key={t} value={t}>
                      {relationNames[t]}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              具体依据
              <textarea
                value={reason}
                maxLength={4000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              disabled={!reason.trim()}
              onClick={() => {
                if (
                  update((n) => {
                    const next = mergeRelation(n, {
                      sourceNodeId: connecting.from,
                      targetNodeId: connecting.to,
                      relationType: relation,
                      evidenceRefs: [
                        ...new Set(
                          lab.nodes
                            .filter((v) => [connecting.from, connecting.to].includes(v.id))
                            .flatMap((v) => v.evidenceIds),
                        ),
                      ].slice(0, 60),
                      leftEvidenceIds: [],
                      rightEvidenceIds: [],
                      generatedBy: 'user',
                      rationale: reason,
                      uncertainty: '用户建立的候选关系，仍须核对。',
                      status: 'pending',
                      strengthClass: 'weak',
                    });
                    return touchExploration(
                      next,
                      `创建候选关系 ${relationKey(connecting.from, connecting.to, relation)}`,
                    );
                  })
                ) {
                  setConnecting(null);
                }
              }}
            >
              创建待审核关系
            </button>
          </div>
        </Modal>
      )}
      {importing && <LabImportDialog snapshot={importing} onClose={() => setImporting(null)} />}
      {readonly && snapshot && (
        <div className="lab-snapshot-actions">
          <span>此处回看 V{snapshot.version}，不改动原快照。</span>
          <button
            onClick={async () => {
              try {
                const next = forkResearch(snapshot, `${snapshot.title} · 继续研究`);
                await explorationStore.save(next);
                router.push(`/lab/${next.id}`);
              } catch {
                setError('派生草稿保存失败，原快照保留。');
              }
            }}
          >
            基于此版本继续研究
          </button>
        </div>
      )}
    </div>
  );
}
export function LabSnapshot({ id }: { id: string }) {
  const [state, setState] = useState<{ project: Exploration; snapshot: Snapshot } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    void explorationStore
      .snapshots()
      .then((rows) => {
        const row = rows.find((r) => r.snapshot.snapshotId === id);
        if (!row) throw new Error('找不到本机快照。');
        const project = synchronizeLab(forkResearch(row.snapshot, row.snapshot.title));
        if (row.snapshot.research?.lab)
          project.lab = rebindLabProject(structuredClone(row.snapshot.research.lab), project.id);
        project.lab!.ui.researchView = 'board';
        project.snapshots = row.project.snapshots;
        setState({ project, snapshot: row.snapshot });
      })
      .catch((e) => setError(e instanceof Error ? e.message : '读取失败'));
  }, [id]);
  if (!state) return <p role="status">{error || '正在恢复完整快照与画布…'}</p>;
  return (
    <LabSurface
      project={state.project}
      current={{ current: state.project }}
      update={(fn) => {
        setState((current) => (current ? { ...current, project: fn(current.project) } : current));
        return true;
      }}
      flush={async () => {}}
      saveState="saved"
      error={error}
      setError={setError}
      retry={() => {}}
      readonly
      snapshot={state.snapshot}
    />
  );
}
