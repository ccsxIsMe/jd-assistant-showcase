'use client';
import { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronRight,
  GripVertical,
  Link2,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  Scissors,
  Unlock,
  Archive,
  X,
  Layers,
  Sparkles,
  FileText,
} from 'lucide-react';
import { Button } from '../ui/button';
import { ItemEditor } from './item-editor';
import {
  categoryNames,
  kindNames,
  newItem,
  statusNames,
  type Reference,
  type WorkItem,
  type Workspace,
} from '@/lib/workbench/model';
import {
  editItem,
  log,
  mergeTasks,
  reorderTask,
  setItemState,
  splitTask,
  toggleLock,
  touch,
  referenceStale,
} from '@/lib/workbench/domain';
export function Status({ item }: { item: WorkItem }) {
  return (
    <span className={`item-status ${item.status}`}>
      {item.status === 'confirmed' ? (
        <Check size={12} />
      ) : item.status === 'review' ? (
        <span>↻</span>
      ) : item.status === 'excluded' ? (
        <X size={12} />
      ) : (
        <span>○</span>
      )}
      {statusNames[item.status]}
    </span>
  );
}
export function References({
  refs,
  onReference,
}: {
  refs: Reference[];
  onReference: (r: Reference) => void;
}) {
  return (
    <div className="reference-links">
      {refs.length ? (
        refs.map((r, index) => (
          <button
            key={`${r.sourceId}:${r.sourceRevision}:${index}`}
            className={`reference-button ${!r.verified ? 'unverified' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onReference(r);
            }}
          >
            <Link2 size={12} />
            {r.verified ? '查看依据' : '引用待核实'}
            {refs.length > 1 ? ` ${index + 1}` : ''}
            <span>v{r.sourceRevision}</span>
          </button>
        ))
      ) : (
        <span className="tiny muted">用户补充 / 暂无来源引用</span>
      )}
    </div>
  );
}
export function ItemsPanel({
  w,
  update,
  select,
  onReference,
  onSuggest,
  onJumpJD,
}: {
  w: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  select: (id: string) => void;
  onReference: (r: Reference) => void;
  onSuggest: () => void;
  onJumpJD: (id: string) => void;
}) {
  const tab = w.ui.objectTab;
  const setTab = (value: 'task' | 'requirement') =>
    update((c) => {
      const n = structuredClone(c);
      n.ui.objectTab = value;
      return n;
    });
  const [showExcluded, setShowExcluded] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [merge, setMerge] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const pointerDrag = useRef<{ id: string; x: number; y: number } | null>(null);
  function pointerTarget(x: number, y: number) {
    return document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-testid="item-task"]')
      ?.id.replace(/^item-/, '');
  }
  function move(id: string, direction: number | { beforeId: string }) {
    const before = new Map(
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="item-task"]')).map((el) => [
        el.id,
        el.getBoundingClientRect().top,
      ]),
    );
    update((c) => reorderTask(c, id, direction));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('[data-testid="item-task"]').forEach((el) => {
        const top = before.get(el.id);
        const difference = top === undefined ? 0 : top - el.getBoundingClientRect().top;
        if (difference)
          el.animate(
            [{ transform: `translateY(${difference}px)` }, { transform: 'translateY(0)' }],
            { duration: 220, easing: 'ease-out' },
          );
      });
    });
  }
  const list = w.items.filter((i) => i.kind === tab && (showExcluded || i.status !== 'excluded'));
  const tasks = w.items.filter((i) => i.kind === 'task' && i.status !== 'excluded');
  function add(kind: WorkItem['kind']) {
    const item = newItem(kind, kind === 'task' ? '新任务' : '新岗位要求');
    if (kind === 'requirement') item.category = 'unknown';
    setEditing(item);
    setCreating(true);
  }
  return (
    <>
      <div className="object-toolbar">
        <div className="segmented" role="tablist" aria-label="任务或岗位要求">
          <button role="tab" aria-selected={tab === 'task'} onClick={() => setTab('task')}>
            岗位任务{' '}
            <b>{w.items.filter((i) => i.kind === 'task' && i.status !== 'excluded').length}</b>
          </button>
          <button
            role="tab"
            data-tour="workbench-requirements-tab"
            aria-selected={tab === 'requirement'}
            onClick={() => setTab('requirement')}
          >
            岗位要求{' '}
            <b>
              {w.items.filter((i) => i.kind === 'requirement' && i.status !== 'excluded').length}
            </b>
          </button>
        </div>
        <button className="text-button" onClick={() => add(tab)}>
          <Plus size={14} />
          新增{tab === 'task' ? '任务' : '要求'}
        </button>
      </div>
      <div className="list-note">
        <p>
          {tab === 'task'
            ? '先确认真正要完成的工作，再讨论岗位条件。'
            : '条件不等于能力清单。每一项都应该有工作情境。'}
        </p>
        <label>
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
          />
          显示已排除
        </label>
      </div>
      {merge.length > 0 && tab === 'task' && (
        <div className="merge-toolbar">
          <span>已选 {merge.length} 项</span>
          <button
            disabled={merge.length < 2}
            className="text-button"
            onClick={() => {
              update((c) => mergeTasks(c, merge));
              setMerge([]);
            }}
          >
            合并为新任务
          </button>
          <button className="text-button" onClick={() => setMerge([])}>
            取消
          </button>
        </div>
      )}
      <div className="item-list">
        {list.map((item, index) => {
          const requirements = w.items.filter(
            (i) => i.kind === 'requirement' && i.taskIds.includes(item.id),
          );
          const blocks = w.items.filter(
            (i) =>
              i.kind === 'block' &&
              (i.taskIds.includes(item.id) || i.requirementIds.includes(item.id)),
          );
          const active = w.ui.selectedId === item.id;
          const pendingSuggestion = w.suggestions.some(
            (s) => s.status === 'pending' && s.changes.some((c) => c.targetId === item.id),
          );
          return (
            <article
              id={`item-${item.id}`}
              key={item.id}
              data-testid={`item-${item.kind}`}
              className={`object-card ${active ? 'selected' : ''} ${item.status === 'excluded' ? 'excluded-card' : ''} ${dragId === item.id ? 'dragging' : ''} ${dropId === item.id ? 'drop-target' : ''} ${pendingSuggestion ? 'has-suggestion' : ''}`}
              onDragOver={(e) => {
                if (tab === 'task') {
                  e.preventDefault();
                  setDropId(item.id);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const sourceId = e.dataTransfer.getData('text/plain') || dragId;
                if (sourceId && sourceId !== item.id && list.some((i) => i.id === sourceId))
                  move(sourceId, { beforeId: item.id });
                setDragId(null);
                setDropId(null);
              }}
            >
              <div className="object-card-top">
                {tab === 'task' && (
                  <button
                    draggable
                    className="drag-handle"
                    style={{ touchAction: 'none' }}
                    aria-label={`拖拽排序${item.title}`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      pointerDrag.current = { id: item.id, x: e.clientX, y: e.clientY };
                    }}
                    onPointerMove={(e) => {
                      const start = pointerDrag.current;
                      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6)
                        return;
                      setDragId(start.id);
                      setDropId(pointerTarget(e.clientX, e.clientY) ?? null);
                      const area = e.currentTarget.closest('.center-scroll');
                      const rect = area?.getBoundingClientRect();
                      if (area && rect) {
                        if (e.clientY < rect.top + 30) area.scrollBy(0, -16);
                        else if (e.clientY > rect.bottom - 30) area.scrollBy(0, 16);
                      }
                    }}
                    onPointerUp={(e) => {
                      const start = pointerDrag.current;
                      pointerDrag.current = null;
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      const targetId = pointerTarget(e.clientX, e.clientY);
                      if (
                        start &&
                        targetId &&
                        targetId !== start.id &&
                        list.some((i) => i.id === targetId) &&
                        Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 6
                      )
                        move(start.id, { beforeId: targetId });
                      setDragId(null);
                      setDropId(null);
                    }}
                    onPointerCancel={() => {
                      pointerDrag.current = null;
                      setDragId(null);
                      setDropId(null);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', item.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(item.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropId(null);
                    }}
                  >
                    <GripVertical size={16} />
                  </button>
                )}
                <button
                  className="object-title"
                  onClick={() => select(item.id)}
                  aria-pressed={active}
                >
                  <span className="item-number">
                    {tab === 'task' ? String(index + 1).padStart(2, '0') : <Layers size={15} />}
                  </span>
                  <h3>{item.title}</h3>
                </button>
                {item.locked && (
                  <span className="lock-label">
                    <LockKeyhole size={12} />
                    已锁定
                  </span>
                )}
                <Status item={item} />
              </div>
              <button className="object-main" onClick={() => select(item.id)}>
                <p>{item.text}</p>
                {item.scope && (
                  <div className="scope-note">
                    <span>范围</span>
                    {item.scope}
                  </div>
                )}
              </button>
              <div className="item-tags">
                {tab === 'task' ? (
                  <span className={`priority-${item.priority}`}>
                    {{ high: '高', medium: '中', low: '低' }[item.priority]}优先级
                  </span>
                ) : (
                  <span>{categoryNames[item.category]}</span>
                )}
                <span>{item.origin === 'ai' ? 'AI整理 · 人工决定' : '用户补充'}</span>
                {item.refs.some((r) => referenceStale(w, r)) && (
                  <span className="warning-text">依据已变化</span>
                )}
                {pendingSuggestion && (
                  <button
                    className="text-button"
                    onClick={() => {
                      select(item.id);
                      onSuggest();
                    }}
                  >
                    有待审阅建议 <ChevronRight size={12} />
                  </button>
                )}
              </div>
              <References refs={item.refs} onReference={onReference} />
              {tab === 'requirement' && (
                <div className="relationship-row">
                  <Link2 size={12} />
                  {item.taskIds.length ? (
                    item.taskIds.map((id) => (
                      <button
                        key={id}
                        onClick={() => {
                          setTab('task');
                          select(id);
                        }}
                      >
                        {w.items.find((i) => i.id === id)?.title ?? '关联任务缺失'}
                      </button>
                    ))
                  ) : (
                    <span className="warning-text">需要说明用途：尚未关联岗位任务</span>
                  )}
                </div>
              )}
              {(requirements.length > 0 || blocks.length > 0) && (
                <div className="relationship-row">
                  <Link2 size={12} />
                  {requirements.map((requirement) => (
                    <button
                      key={requirement.id}
                      onClick={() => {
                        setTab('requirement');
                        select(requirement.id);
                        requestAnimationFrame(() =>
                          document
                            .getElementById(`item-${requirement.id}`)
                            ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
                        );
                      }}
                    >
                      {requirement.title}
                      {requirement.status === 'review' ? ' · 需复核' : ''}
                    </button>
                  ))}
                  {blocks.map((b) => (
                    <button key={b.id} onClick={() => onJumpJD(b.id)}>
                      <FileText size={12} />
                      {b.title}
                      {b.status === 'review' ? ' · 需复核' : ''}
                    </button>
                  ))}
                </div>
              )}
              <div className="item-actions">
                <div>
                  {item.status !== 'confirmed' && item.status !== 'excluded' && (
                    <button
                      className="confirm-button"
                      data-tour={
                        item.kind === 'task'
                          ? 'workbench-confirm-task'
                          : 'workbench-confirm-requirement'
                      }
                      onClick={() => update((c) => setItemState(c, item.id, 'confirmed'))}
                    >
                      <CheckCheck size={14} />
                      确认
                    </button>
                  )}
                  <button
                    className="text-button"
                    data-review-edit
                    onClick={() => {
                      setEditing(item);
                      setCreating(false);
                    }}
                  >
                    <Pencil size={13} />
                    编辑
                  </button>
                  <button
                    className="text-button"
                    onClick={() => update((c) => toggleLock(c, item.id))}
                  >
                    {item.locked ? <Unlock size={13} /> : <LockKeyhole size={13} />}
                    {item.locked ? '解锁' : '锁定'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      select(item.id);
                      onSuggest();
                    }}
                  >
                    <Sparkles size={13} />
                    局部共创
                  </button>
                </div>
                <details className="item-more">
                  <summary aria-label={`更多操作${item.title}`}>
                    <MoreHorizontal size={17} />
                  </summary>
                  <div className="more-menu">
                    {tab === 'task' && (
                      <>
                        <button onClick={() => move(item.id, -1)}>
                          <ArrowUp size={13} />
                          上移
                        </button>
                        <button onClick={() => move(item.id, 1)}>
                          <ArrowDown size={13} />
                          下移
                        </button>
                        <button
                          disabled={item.locked}
                          onClick={() => update((c) => splitTask(c, item.id))}
                        >
                          <Scissors size={13} />
                          拆分并保留原项
                        </button>
                        <button
                          disabled={item.locked}
                          onClick={() =>
                            setMerge(
                              merge.includes(item.id)
                                ? merge.filter((id) => id !== item.id)
                                : [...merge, item.id],
                            )
                          }
                        >
                          <Layers size={13} />
                          选择合并
                        </button>
                      </>
                    )}
                    <button
                      onClick={() =>
                        update((c) =>
                          setItemState(
                            c,
                            item.id,
                            item.status === 'excluded' ? 'pending' : 'excluded',
                          ),
                        )
                      }
                    >
                      <Archive size={13} />
                      {item.status === 'excluded' ? '恢复待确认' : '排除本项'}
                    </button>
                  </div>
                </details>
              </div>
            </article>
          );
        })}
      </div>
      {!list.length && (
        <div className="work-empty">
          <Layers size={30} />
          <h3>{tab === 'task' ? '把资料整理成可讨论的任务' : '先说清工作，再说清条件'}</h3>
          <p>
            {tab === 'task'
              ? '左侧放入原始说明，再点击“从资料整理”；也可以手动新增。'
              : tasks.length
                ? '基于具体任务新增要求，并区分必要、加分和可培养条件。'
                : '岗位要求应有工作依据，不必从一长串技能开始。'}
          </p>
          <Button variant="outline" onClick={() => add(tab)}>
            <Plus size={15} />
            手动新增{tab === 'task' ? '任务' : '要求'}
          </Button>
        </div>
      )}
      {editing && (
        <ItemEditor
          item={editing}
          w={w}
          onClose={() => setEditing(null)}
          onSave={(values, taskIds, requirementIds, confirm, refs) => {
            update((c) => {
              if (creating) {
                const n = structuredClone(c);
                n.items.push({
                  ...editing,
                  ...values,
                  taskIds,
                  requirementIds,
                  refs,
                  status: confirm ? 'confirmed' : 'pending',
                });
                log(n, `用户新增${kindNames[editing.kind]}「${values.title}」`);
                return touch(n);
              }
              return editItem(c, editing.id, { ...values, taskIds, requirementIds, refs }, confirm);
            });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
