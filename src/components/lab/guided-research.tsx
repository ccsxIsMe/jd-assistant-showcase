'use client';
import { ArrowRight, Check, Network } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  researchSteps,
  researchStepNames,
  researchProgress,
  type ResearchStep,
} from '@/lib/lab/guided';
import { markResearchCheckpoint } from '@/lib/lab/operations';
import { GuidedMaterials } from './guided-materials';
import { GuidedEvidence, GuidedQuestions } from './guided-evidence';
import { DecisionReferences } from '../decisions/decision-references';
import { GuidedRequirements } from './guided-requirements';
import { GuidedHandoff, ImportSelection } from './guided-handoff';
import { RolePanel } from './role-panel';
import type { GuidedActions } from './guided-types';
import { stageNames } from '@/lib/lab/model';
const descriptions = {
  materials: {
    goal: '说明产品构想，选出本轮要参考的资料。',
    next: '保存想法、添加资料，核对解析后确认资料集合。',
    outcome: '得到一组可追溯、可分批补充的研究材料。',
  },
  evidence: {
    goal: '了解资料里实际存在什么，保留不确定和冲突。',
    next: '查看少量关键证据；其余可以折叠或稍后处理。',
    outcome: '得到可核对的依据与状态明确的未决问题。',
  },
  requirements: {
    goal: '区分参考产品能力和你真正想实现的功能。',
    next: '编辑、合并或排除候选功能，再确认接受的范围。',
    outcome: '得到可用于比较岗位方案的功能集合。',
  },
  roles: {
    goal: '比较实现条件和分工，而不是直接决定招聘人数。',
    next: '查看方案依据，选择或组合，再确认准备导入的要求。',
    outcome: '得到有依据、有假设且经人选择的岗位方案。',
  },
  handoff: {
    goal: '让研究成为可继续使用的岗位资料。',
    next: '检查选定内容，保存快照，再预览导入岗位。',
    outcome: '进入岗位共创工作台，继续确认任务、要求与JD。',
  },
};
export function GuidedResearch(
  a: GuidedActions & {
    step: ResearchStep;
    onStep: (step: ResearchStep) => void;
    onBoard: () => void;
    hidden: boolean;
  },
) {
  const state = researchProgress(a.project),
    index = researchSteps.indexOf(a.step),
    desc = descriptions[a.step];
  const run = a.project.lab!.runs.at(-1);
  const scroll = useRef<HTMLDivElement>(null),
    scrollPositions = useRef<Partial<Record<ResearchStep, number>>>({});
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    function revealCurrent() {
      const current = nav!.querySelector<HTMLElement>('[aria-current="step"]');
      if (!current || nav!.scrollWidth <= nav!.clientWidth) return;
      const area = nav!.getBoundingClientRect(),
        button = current.getBoundingClientRect();
      nav!.scrollLeft += button.left - area.left - (area.width - button.width) / 2;
    }
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [a.step, a.hidden]);
  function changeStep(step: ResearchStep) {
    if (scroll.current) scrollPositions.current[a.step] = scroll.current.scrollTop;
    const top = scrollPositions.current[step] ?? 0;
    a.onStep(step);
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = top;
    });
  }
  function advance() {
    if (index === 0) {
      if (a.update((p) => markResearchCheckpoint(p, 'materials'))) changeStep('evidence');
    } else if (index === 1) {
      if (a.update((p) => markResearchCheckpoint(p, 'evidence'))) changeStep('requirements');
    } else if (index < 4) changeStep(researchSteps[index + 1]);
  }
  const canContinue =
    a.step === 'materials'
      ? state.validSources.length > 0
      : a.step === 'evidence'
        ? state.evidence.length > 0 || a.project.lab!.annotations.length > 0
        : a.step === 'requirements'
          ? state.features.length > 0
          : a.step === 'roles'
            ? state.selectedImportIds.length > 0
            : false;
  return (
    <main className="guided-research" hidden={a.hidden} aria-label="五阶段引导式研究">
      <nav ref={navigation} className="guided-stepper" aria-label="研究阶段">
        {researchSteps.map((step, i) => (
          <button
            key={step}
            aria-current={step === a.step ? 'step' : undefined}
            onClick={() => changeStep(step)}
          >
            <span className={state.states[step].done ? 'done' : ''}>
              {state.states[step].done ? <Check size={15} /> : i + 1}
            </span>
            <strong>{researchStepNames[step]}</strong>
            <small>{state.states[step].done ? '已有完成依据' : '可以继续处理'}</small>
          </button>
        ))}
      </nav>
      <div className="guided-scroll" ref={scroll}>
        <div className="guided-stage-heading">
          <div>
            <span className="guided-kicker">第{index + 1}阶段 / 共5阶段</span>
            <h1>{researchStepNames[a.step]}</h1>
            <p>{desc.goal}</p>
          </div>
          <button onClick={a.onBoard}>
            <Network size={16} />
            查看完整证据板
          </button>
        </div>
        <div className="guided-next-note">
          <strong>下一步</strong>
          <span>{desc.next}</span>
          <small>完成后：{desc.outcome}</small>
        </div>
        {run && (
          <div className="guided-analysis-status" role="status">
            <span>
              {stageNames[run.stage]} ·{' '}
              {
                {
                  queued: '等待处理',
                  running: '正在处理',
                  succeeded: '已完成，等待人工审阅',
                  partial: '部分完成，已有结果保留',
                  failed: '分析失败',
                  cancelled: '已取消',
                  stale: '结果过期',
                }[run.status]
              }
            </span>
            {['failed', 'cancelled', 'stale'].includes(run.status) &&
              !a.busy &&
              ['derive_features', 'link_evidence', 'propose_roles'].includes(run.stage) && (
                <button
                  onClick={() =>
                    a.onAnalyze(
                      run.stage as 'derive_features' | 'link_evidence' | 'propose_roles',
                      run.scopeNodeIds,
                    )
                  }
                >
                  只重试失败阶段
                </button>
              )}
          </div>
        )}
        <div className="guided-stage-status" role="status">
          {state.states[a.step].note}
          {a.busy ? ' · AI正在处理，已有内容可继续查看。' : ''}
        </div>
        <div className="guided-stage" hidden={a.step !== 'materials'}>
          <GuidedMaterials {...a} />
        </div>
        <div className="guided-stage" hidden={a.step !== 'evidence'}>
          <GuidedEvidence {...a} />
          <section className="guided-section">
            <h2>需要你决定</h2>
            <GuidedQuestions {...a} active={!a.hidden && a.step === 'evidence'} />
          </section>
          {!a.readonly && (
            <button
              className="guided-secondary-action"
              data-tour="lab-analysis"
              disabled={a.busy || !state.evidence.length}
              onClick={() => a.onAnalyze('link_evidence')}
            >
              辅助检查跨资料关联
            </button>
          )}
        </div>
        <div className="guided-stage" hidden={a.step !== 'requirements'}>
          <GuidedRequirements {...a} />
        </div>
        <div className="guided-stage" hidden={a.step !== 'roles'}>
          <div className="guided-section-heading">
            <div>
              <h2>先比较草案，再决定边界</h2>
              <p>预算、现有团队与交付时间未知时，方案保留条件，不编造确定人数。</p>
            </div>
            {!a.readonly && (
              <button
                data-tour="lab-generate-roles"
                disabled={a.busy || !state.features.length}
                onClick={() => a.onAnalyze('propose_roles')}
              >
                {a.project.lab!.solutions.length ? '按当前需求补充方案' : '比较岗位方案'}
              </button>
            )}
          </div>
          {!state.features.length && (
            <p className="guided-empty">先在产品需求阶段整理至少一个候选功能，再比较岗位方案。</p>
          )}
          <div className="guided-role-comparison">
            <RolePanel
              project={a.project}
              update={a.update}
              onFocus={(id) => a.onFocus(`requirement:${id}`)}
              onEdit={a.onEdit}
              onImport={a.onImport}
              onSource={a.onSource}
              onEdge={a.onEdge}
              readonly={a.readonly}
              guided
            />
          </div>
          <ImportSelection {...a} />
          <details className="guided-section">
            <summary>方案仍需核实的问题</summary>
            <DecisionReferences project={a.project} onAnswer={a.onAnswer} readonly={a.readonly} />
          </details>
        </div>
        <div className="guided-stage" hidden={a.step !== 'handoff'}>
          <GuidedHandoff {...a} />
        </div>
      </div>
      <footer className="guided-stage-footer">
        <button disabled={index === 0} onClick={() => changeStep(researchSteps[index - 1])}>
          返回上一阶段
        </button>
        <p>
          当前阶段：{state.states[a.step].done ? '已有真实完成依据' : '仍有待处理内容'} ·
          不强制逐条确认次要问题
        </p>
        {index < 4 && !a.readonly && (
          <button className="lab-primary" disabled={!canContinue || a.busy} onClick={advance}>
            {index === 0
              ? '确认资料集合，检查证据'
              : index === 1
                ? '已查看核心证据，继续整理'
                : index === 2
                  ? '带着功能集合比较方案'
                  : '预览导出与岗位共创'}
            <ArrowRight size={15} />
          </button>
        )}
      </footer>
    </main>
  );
}
