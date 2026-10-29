'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, HelpCircle, X } from 'lucide-react';
import {
  revealTutorialAncestors,
  tutorialTargetVisible,
  tutorialVisibleBox,
} from '@/lib/guidance/target';
export type TutorialStep = {
  id: string;
  title: string;
  description: string;
  target: string;
  complete: boolean;
  unavailable?: string;
};
export type TutorialLaunch = { token: number; restart: boolean } | null;
type Preference = { status: 'active' | 'paused' | 'skipped' | 'completed'; stepId: string };
const event = 'jd-tutorial-preference';
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(event, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(event, callback);
  };
}
function read(scope: string) {
  try {
    return (
      localStorage.getItem(`jd-interactive-guide:${scope}:v2`) ??
      (scope === 'workbench' && localStorage.getItem('jd-workbench-guide-v1') === 'seen'
        ? '{"status":"skipped","stepId":""}'
        : '')
    );
  } catch {
    return '';
  }
}
const sessionPreferences = new Map<string, string>();
function write(scope: string, value: Preference) {
  const raw = JSON.stringify(value);
  sessionPreferences.set(scope, raw);
  try {
    localStorage.setItem(`jd-interactive-guide:${scope}:v2`, raw);
  } catch {
    /* Tutorial preference only: business storage has its own error handling. */
  }
  window.dispatchEvent(new Event(event));
}
function parse(raw: string): Preference | undefined {
  try {
    const p = JSON.parse(raw);
    if (
      ['active', 'paused', 'skipped', 'completed'].includes(p.status) &&
      typeof p.stepId === 'string'
    )
      return p;
  } catch {}
  return undefined;
}
export function InteractiveGuide({
  scope,
  steps,
  prepare,
  launch = null,
  enabled = true,
  auto = true,
}: {
  scope: 'lab' | 'workbench';
  steps: TutorialStep[];
  prepare: (id: string) => void;
  launch?: TutorialLaunch;
  enabled?: boolean;
  auto?: boolean;
}) {
  const raw = useSyncExternalStore(
      subscribe,
      () => sessionPreferences.get(scope) ?? read(scope),
      () => '',
    ),
    pref = parse(raw);
  const initial = steps.findIndex((s) => !s.complete),
    index = Math.max(
      0,
      steps.findIndex((s) => s.id === pref?.stepId),
    );
  const step = steps[pref?.stepId ? index : Math.max(0, initial)],
    currentIndex = steps.indexOf(step);
  const active = enabled && (pref?.status === 'active' || (!pref && auto));
  const hasPreference = !!pref;
  const [box, setBox] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
      step: string;
      selector: string;
    } | null>(null),
    [missing, setMissing] = useState(false);
  const [locateToken, setLocateToken] = useState(0);
  const lastLaunch = useRef<number | null>(null),
    lastPrepared = useRef(''),
    card = useRef<HTMLElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const prepareRef = useRef(prepare);
  useEffect(() => {
    prepareRef.current = prepare;
  }, [prepare]);
  useEffect(() => {
    if (!enabled || !launch || lastLaunch.current === launch.token) return;
    lastLaunch.current = launch.token;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    write(scope, {
      status: 'active',
      stepId: launch.restart ? steps[0].id : pref?.stepId || step.id,
    });
  }, [enabled, launch, scope, steps, pref?.stepId, step.id]);
  useEffect(() => {
    if (active && !pref) write(scope, { status: 'active', stepId: step.id });
  }, [active, pref, scope, step.id]);
  useEffect(() => {
    if (!active || !card.current) return;
    const element = card.current;
    const root = document.documentElement;
    let frame = 0;
    const reserve = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const shell = document.querySelector(
          scope === 'workbench' ? '.workspace-root' : '.lab-app',
        );
        const offset = Math.max(0, shell?.getBoundingClientRect().top ?? 0);
        root.style.setProperty(
          '--interactive-guide-reserve',
          `${Math.ceil(element.getBoundingClientRect().height + 24 + offset)}px`,
        );
      });
    };
    // The tutorial has its own bottom dock. Reserve its measured height so it
    // cannot cover the toolbar, mobile tabs or the actual highlighted control.
    const observer = new ResizeObserver(reserve);
    observer.observe(element);
    window.addEventListener('resize', reserve);
    reserve();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', reserve);
      root.style.removeProperty('--interactive-guide-reserve');
    };
  }, [active, scope]);
  useEffect(() => {
    if (!active) return;
    let disposed = false,
      frame = 0,
      attempts = 0,
      positioned = false;
    let observer: ResizeObserver | undefined;
    const revealed = new WeakSet<HTMLElement>();
    const measure = () => {
      if (disposed) return;
      const candidates = [...document.querySelectorAll<HTMLElement>(step.target)];
      for (const candidate of candidates)
        if (!candidate.closest('[hidden]') && !revealed.has(candidate)) {
          revealTutorialAncestors(candidate);
          revealed.add(candidate);
        }
      const target = candidates.find(tutorialTargetVisible);
      if (!target) {
        setBox(null);
        if (attempts++ < 60) {
          frame = requestAnimationFrame(measure);
          return;
        }
        setBox(null);
        setMissing(true);
        return;
      }
      if (!positioned)
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      positioned = true;
      const visible = tutorialVisibleBox(target);
      if (!visible) {
        setBox(null);
        setMissing(true);
        return;
      }
      const next = { ...visible, step: step.id, selector: step.target };
      setBox((old) =>
        old &&
        old.step === next.step &&
        old.selector === next.selector &&
        Math.abs(old.x - next.x) < 1 &&
        Math.abs(old.y - next.y) < 1 &&
        Math.abs(old.width - next.width) < 1 &&
        Math.abs(old.height - next.height) < 1
          ? old
          : next,
      );
      setMissing(false);
      if (!observer) {
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(measure);
        });
        observer.observe(target);
      }
    };
    const preparationKey = `${scope}:${step.id}:${step.target}:${launch?.token ?? 'auto'}:${locateToken}`;
    // Restoring a page must restore its saved view, even with an unfinished tutorial.
    if (!lastPrepared.current && hasPreference && launch?.token === undefined)
      lastPrepared.current = preparationKey;
    if (lastPrepared.current !== preparationKey) {
      lastPrepared.current = preparationKey;
      prepareRef.current(step.id);
    }
    frame = requestAnimationFrame(measure);
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          (r) => !(r.target instanceof Element && r.target.closest('.interactive-guide-layer')),
        )
      )
        schedule();
    });
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'open', 'style', 'class', 'aria-hidden'],
    });
    document.addEventListener('animationend', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !document.querySelector('dialog[open], [role="dialog"]')
      ) {
        write(scope, { status: 'paused', stepId: step.id });
        trigger.current?.focus();
      }
    };
    window.addEventListener('keydown', escape);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations.disconnect();
      document.removeEventListener('animationend', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('keydown', escape);
    };
  }, [active, step.id, step.target, scope, launch?.token, hasPreference, locateToken]);
  if (!active || typeof document === 'undefined') return null;
  function close(status: Preference['status']) {
    write(scope, { status, stepId: step.id });
    trigger.current?.focus();
  }
  function advance(skipped = false) {
    void skipped; // Tutorial navigation never grants business confirmation.
    const next = steps[currentIndex + 1];
    if (next) write(scope, { status: 'active', stepId: next.id });
    else close('completed');
  }
  return createPortal(
    <div className="interactive-guide-layer" aria-label="交互教程">
      {box && box.step === step.id && box.selector === step.target && !missing && (
        <div
          className="interactive-guide-highlight"
          data-testid="tutorial-highlight"
          style={{
            left: box.x - 5,
            top: box.y - 5,
            width: box.width + 10,
            height: box.height + 10,
          }}
        />
      )}
      <aside
        ref={card}
        className="interactive-guide-card"
        aria-label={`${scope === 'lab' ? '研究' : '岗位'}交互教程`}
      >
        <div>
          <span>
            <HelpCircle size={15} />
            操作教程 · 第{currentIndex + 1}步 / {steps.length}
          </span>
          <button aria-label="退出教程" onClick={() => close('paused')}>
            <X size={17} />
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{step.description}</p>
        {missing ? (
          <p className="tutorial-target-warning" role="status">
            {step.unavailable || '当前控件尚不可用，请先完成前置操作，或暂时跳过本步。'}{' '}
            没有绘制空白高亮。
          </p>
        ) : (
          <p className="tutorial-completion">
            {step.complete
              ? '已检测到这一步的实际成果，可以继续。'
              : '可操作高亮控件，也可先看下一步；浏览教程不会确认或修改业务内容。'}
          </p>
        )}
        <footer>
          <button onClick={() => close('skipped')}>跳过教程</button>
          <button onClick={() => advance(true)}>本步稍后处理</button>
          {missing && <button onClick={() => setLocateToken((v) => v + 1)}>定位本步控件</button>}
          <button className="lab-primary" onClick={() => advance()}>
            {currentIndex === steps.length - 1 ? '完成教程' : '下一步'}
            <ArrowRight size={14} />
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
