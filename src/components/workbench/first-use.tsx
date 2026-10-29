'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, HelpCircle } from 'lucide-react';
import type { Workspace } from '@/lib/workbench/model';
import { tutorialTargetVisible } from '@/lib/guidance/target';
import { workbenchNextAction, workbenchReviewChecks } from '@/lib/workbench/next-action';
import type { ConfirmationCheck } from '@/lib/workbench/domain';
import {
  InteractiveGuide,
  type TutorialLaunch,
  type TutorialStep,
} from '../guidance/interactive-guide';
export function WorkbenchFirstUse({
  workspace: w,
  onTasks,
  onRequirements,
  onJd,
  onSources,
  onReview,
  onSave,
  onCheck,
}: {
  workspace: Workspace;
  onTasks: () => void;
  onRequirements: () => void;
  onJd: () => void;
  onSources: () => void;
  onReview: () => void;
  onSave: () => void;
  onCheck: (check: ConfirmationCheck) => void;
}) {
  const [launch, setLaunch] = useState<TutorialLaunch>(null),
    [help, setHelp] = useState(false),
    [exported, setExported] = useState(false);
  const [navigationTick, setNavigationTick] = useState(0);
  const [checksExpanded, setChecksExpanded] = useState(true);
  const helpPanel = useRef<HTMLElement>(null),
    nextTrigger = useRef<HTMLButtonElement>(null),
    helpTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (help) {
      const frame = requestAnimationFrame(() => helpPanel.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [help]);
  const next = workbenchNextAction(w),
    checks = next.id === 'review-jd' ? workbenchReviewChecks(w) : [],
    tasks = w.items.filter((i) => i.kind === 'task' && i.status !== 'excluded'),
    requirements = w.items.filter((i) => i.kind === 'requirement' && i.status !== 'excluded'),
    blocks = w.items.filter((i) => i.kind === 'block' && i.status !== 'excluded');
  useEffect(() => {
    const listener = () => setExported(true);
    window.addEventListener('jd-document-exported', listener);
    return () => window.removeEventListener('jd-document-exported', listener);
  }, []);
  useEffect(() => {
    let target: HTMLElement | undefined;
    const frame = requestAnimationFrame(() => {
      target =
        [...document.querySelectorAll<HTMLElement>(next.target)].find(tutorialTargetVisible) ??
        nextTrigger.current ??
        undefined;
      target?.classList.add('current-business-action');
    });
    return () => {
      cancelAnimationFrame(frame);
      target?.classList.remove('current-business-action');
    };
  }, [next.target, w.ui.view, w.ui.objectTab, w.ui.rightOpen, navigationTick]);
  function goToCheck(check: ConfirmationCheck) {
    if (window.matchMedia('(max-width: 600px)').matches) setChecksExpanded(false);
    onCheck(check);
    setNavigationTick((v) => v + 1);
  }
  function prepare(id: string) {
    if (id === 'sources') onSources();
    else if (id === 'tasks') onTasks();
    else if (id === 'requirements') onRequirements();
    else if (id === 'jd') onJd();
    else if (id === 'review') onReview();
  }
  const steps: TutorialStep[] = [
    {
      id: 'sources',
      title: '从真实资料开始',
      description: '导入研究资料，或录入负责人说明。已有导入内容无需重填。',
      target: '[data-tour="workbench-add-source"]',
      complete: w.sources.some((s) => !s.removed),
    },
    {
      id: 'tasks',
      title: '确认实际工作与边界',
      description: '查看依据，确认本岗位要承担的任务；排除不承担的工作，不必猜技术。',
      target: tasks.some((i) => i.status !== 'confirmed')
        ? '[data-tour="workbench-confirm-task"]'
        : '[data-tour="workbench-extract"]',
      complete: !!tasks.length && tasks.every((i) => i.status === 'confirmed'),
    },
    {
      id: 'requirements',
      title: '区分必要、加分与可培养',
      description: '先核对必要能力。未知条件可保留待确认；回答问题不会自动确认要求。',
      target: requirements.some((i) => i.status !== 'confirmed')
        ? '[data-tour="workbench-confirm-requirement"]'
        : '[data-tour="workbench-requirements-tab"]',
      complete: !!requirements.length && requirements.every((i) => i.status === 'confirmed'),
    },
    {
      id: 'jd',
      title: '主动生成JD草稿',
      description: '点击生成，根据已经确认的内容形成草稿；不会替企业承诺薪资或福利。',
      target: '[data-tour="workbench-generate-jd"]',
      complete: !!blocks.length,
    },
    {
      id: 'review',
      title: '先看差异，再采纳修改',
      description: '选中内容后提出局部要求，查看建议并决定应用或拒绝；锁定和撤销继续有效。',
      target: '[data-tour="workbench-review-suggestion"], [data-tour="workbench-local-ai"]',
      complete: w.suggestions.some((s) => s.status === 'applied' || s.status === 'rejected'),
    },
    {
      id: 'save',
      title: '保存版本或导出',
      description: '版本管理保留不可变内容。未完成确认也可导出带草稿标识的JD。',
      target: '[data-tour="workbench-versions"], [data-tour="workbench-export"]',
      complete: !!w.versions.length || exported,
    },
  ];
  function nextAction() {
    if (next.id === 'sources') onSources();
    else if (next.id === 'tasks') onTasks();
    else if (next.id === 'requirements') onRequirements();
    else if (next.id === 'review-jd' && checks[0]) goToCheck(checks[0]);
    else if (next.id === 'jd') onJd();
    else if (next.id === 'review') onReview();
    else onSave();
  }
  return (
    <section
      className="workbench-orientation"
      aria-label="岗位状态与下一步"
      onKeyDownCapture={(e) => {
        // The trigger can still own focus before the next animation frame.
        if (help && e.key === 'Escape' && !document.querySelector('dialog[open],[role="dialog"]')) {
          e.preventDefault();
          e.stopPropagation();
          setHelp(false);
          helpTrigger.current?.focus();
        }
      }}
    >
      <div className="workbench-next-summary">
        <CheckCircle2 size={18} />
        <div>
          <strong>
            {blocks.length
              ? 'JD草稿已形成，继续人工审阅'
              : w.researchImports?.length
                ? '研究资料已带入，接着确认岗位边界'
                : '从真实工作开始，共同明确岗位'}
          </strong>
          <p>
            {checks.length
              ? `还有 ${checks.length} 项待核对，点击下方入口逐项处理后，即可保存确认版本。`
              : next.note}
            {w.researchImports?.length ? ' · 已导入信息和来源无需重新填写' : ''}
          </p>
          <small>
            最近修改：{w.activity[0]?.text ?? '尚无修改记录'} · 其他待办
            {Math.max(0, next.other - 1)}项
          </small>
        </div>
        <button className="workbench-next-button" ref={nextTrigger} onClick={nextAction}>
          下一步：{next.label}
          <ArrowRight size={14} />
        </button>
        <button
          ref={helpTrigger}
          aria-label="岗位使用引导"
          aria-expanded={help}
          onClick={() => setHelp(!help)}
        >
          <HelpCircle size={16} />
          帮助
        </button>
      </div>
      {checks.length > 0 && (
        <div className="workbench-review-checklist" aria-label="JD核对待办">
          <div>
            <strong>正式确认前，还需处理 {checks.length} 项</strong>
            <button
              aria-expanded={checksExpanded}
              onClick={() => setChecksExpanded(!checksExpanded)}
            >
              {checksExpanded ? '收起核对待办' : '展开核对待办'}
            </button>
          </div>
          {checksExpanded && (
            <p className="workbench-review-hint">点击入口定位；不会代你确认或调用AI。</p>
          )}
          {checksExpanded && (
            <>
              <ul>
                {checks.slice(0, 1).map((check) => (
                  <li key={check.id}>
                    <div>
                      <strong>{check.message}</strong>
                      <p>{check.instruction}</p>
                    </div>
                    <button onClick={() => goToCheck(check)}>
                      {check.actionLabel}
                      <ArrowRight size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              {checks.length > 1 && (
                <details>
                  <summary>查看其他 {checks.length - 1} 项待办</summary>
                  <ul>
                    {checks.slice(1).map((check) => (
                      <li key={check.id}>
                        <div>
                          <strong>{check.message}</strong>
                          <p>{check.instruction}</p>
                        </div>
                        <button onClick={() => goToCheck(check)}>
                          {check.actionLabel}
                          <ArrowRight size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          <button className="workbench-draft-shortcut" onClick={onSave}>
            暂时不确定？查看版本并保存草稿
          </button>
        </div>
      )}
      {help && (
        <aside
          ref={helpPanel}
          tabIndex={-1}
          className="workbench-first-guide"
          aria-label="岗位六步入门"
        >
          <h3>把需求逐步变成JD</h3>
          <p>资料 → 任务 → 能力 → JD → 审阅 → 版本。AI只提出候选，重要内容由你决定。</p>
          <button
            onClick={() => {
              setHelp(false);
              setLaunch({ token: Date.now(), restart: false });
            }}
          >
            继续交互教程
          </button>
          <button
            onClick={() => {
              setHelp(false);
              setLaunch({ token: Date.now(), restart: true });
            }}
          >
            重新演示教程
          </button>
          <button onClick={onSources}>查看资料与来源</button>
          <button onClick={onSave}>查看版本与恢复</button>
          <button onClick={() => setHelp(false)}>收起帮助</button>
        </aside>
      )}
      <InteractiveGuide
        scope="workbench"
        steps={steps}
        prepare={prepare}
        launch={launch}
        enabled={!help}
      />
    </section>
  );
}
