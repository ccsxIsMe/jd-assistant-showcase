'use client';
import { useState } from 'react';
import { Check, FileText, Link2, LockKeyhole, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { References, Status } from './items-panel';
import { Button } from '../ui/button';
import { ItemEditor } from './item-editor';
import {
  editItem,
  log,
  refreshSuggestions,
  setItemState,
  toggleLock,
  touch,
} from '@/lib/workbench/domain';
import { newItem, now, type Reference, type WorkItem, type Workspace } from '@/lib/workbench/model';
export function JDPanel({
  w,
  update,
  select,
  onReference,
  onAI,
  busy,
}: {
  w: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  select: (id: string) => void;
  onReference: (r: Reference) => void;
  onAI: (intent?: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const blocks = w.items.filter((i) => i.kind === 'block' && i.status !== 'excluded');
  function inlineText(id: string, text: string) {
    update((c) => {
      const n = structuredClone(c);
      const item = n.items.find((i) => i.id === id)!;
      item.text = text;
      item.status = item.status === 'confirmed' ? 'review' : item.status;
      item.revision++;
      item.lastChange = now();
      refreshSuggestions(n);
      return touch(n);
    });
  }
  return (
    <>
      <div className="jd-context-strip">
        <div>
          <FileText size={17} />
          <span>
            分块JD草稿 <small>修改段落，只影响该段落</small>
          </span>
        </div>
        <button
          className="text-button"
          onClick={() => {
            update((c) => {
              const n = structuredClone(c);
              const i = newItem('block', '手动补充段落', '');
              n.items.push(i);
              n.ui.selectedId = i.id;
              log(n, '新增人工JD段落，请填写并确认');
              return touch(n);
            });
          }}
        >
          <Plus size={14} />
          新增段落
        </button>
      </div>
      {blocks.length ? (
        <div className="jd-paper">
          <div className="jd-paper-header">
            <span>JOB DESCRIPTION</span>
            <h2>{w.title}</h2>
            <p>基于岗位任务和条件形成，发布前由人确认。</p>
          </div>
          {blocks.map((b) => (
            <section
              id={`item-${b.id}`}
              key={b.id}
              className={`jd-block ${w.ui.selectedId === b.id ? 'selected' : ''} ${w.suggestions.some((s) => s.status === 'pending' && s.changes.some((c) => c.targetId === b.id)) ? 'has-suggestion' : ''}`}
              onClick={() => select(b.id)}
              data-testid="jd-block"
            >
              <div className="jd-block-heading">
                <h3>{b.title}</h3>
                <div>
                  {b.locked && <LockKeyhole size={13} />}
                  <Status item={b} />
                </div>
              </div>
              <textarea
                aria-label={`${b.title}正文`}
                value={b.text}
                maxLength={10000}
                onFocus={() => select(b.id)}
                onChange={(e) => inlineText(b.id, e.target.value)}
                rows={Math.max(3, Math.min(14, b.text.split('\n').length + 2))}
                placeholder="手动填写此段内容；原文会自动保存"
              />
              <div className="jd-block-tools">
                <References refs={b.refs} onReference={onReference} />
                <div>
                  <button data-review-edit className="text-button" onClick={() => setEditing(b)}>
                    <Pencil size={12} />
                    关联与编辑
                  </button>
                  {b.status !== 'confirmed' && (
                    <button
                      className="text-button confirm-text"
                      data-tour="workbench-confirm-block"
                      onClick={() => update((c) => setItemState(c, b.id, 'confirmed'))}
                    >
                      <Check size={12} />
                      确认段落
                    </button>
                  )}
                  <button
                    aria-label={`锁定或解锁${b.title}`}
                    className="icon-button"
                    onClick={() => update((c) => toggleLock(c, b.id))}
                  >
                    <LockKeyhole size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`排除段落${b.title}`}
                    onClick={() => update((c) => setItemState(c, b.id, 'excluded'))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {(b.taskIds.length > 0 || b.requirementIds.length > 0) && (
                <div className="relationship-row">
                  <Link2 size={12} />
                  <span>
                    关联 {b.taskIds.length} 项任务、{b.requirementIds.length} 项要求
                  </span>
                  {[...b.taskIds, ...b.requirementIds].some(
                    (id) => w.items.find((i) => i.id === id)?.status === 'excluded',
                  ) && <span className="warning-text">关联内容已排除，需复核本段</span>}
                </div>
              )}
              {w.ui.selectedId === b.id && (
                <div className="block-ai-actions">
                  <button
                    onClick={() => onAI('澄清表述：仅依据当前确认的任务与要求，不增加未确认职责。')}
                    disabled={busy || b.locked}
                  >
                    澄清表述
                  </button>
                  <button
                    onClick={() => onAI('精简内容，保留已确认的岗位事实。')}
                    disabled={busy || b.locked}
                  >
                    精简内容
                  </button>
                  <button
                    onClick={() => onAI('检查关联要求，按当前已确认的岗位范围提出局部修改。')}
                    disabled={busy || b.locked}
                  >
                    检查关联要求
                  </button>
                  <button onClick={() => onAI()} disabled={busy || b.locked}>
                    按我的要求修改
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="work-empty jd-empty">
          <FileText size={36} />
          <h3>让已经确认的岗位，成为清晰的JD</h3>
          <p>先确认任务和必要条件，再生成分块草稿。没有提供的薪资、福利和工作地点会保持省略。</p>
          <Button disabled={busy} onClick={() => onAI('__draft__')}>
            <Sparkles size={15} />
            从确认内容生成JD草稿
          </Button>
          <p className="tiny muted">已有JD可从左侧录入为资料，或新增段落手动整理。</p>
        </div>
      )}
      {editing && (
        <ItemEditor
          item={editing}
          w={w}
          onClose={() => setEditing(null)}
          onSave={(values, taskIds, requirementIds, confirm, refs) => {
            update((c) =>
              editItem(c, editing.id, { ...values, taskIds, requirementIds, refs }, confirm),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
