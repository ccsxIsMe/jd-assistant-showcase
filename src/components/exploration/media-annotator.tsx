'use client';
/* eslint-disable @next/next/no-img-element -- original local Blob assets, never remote optimized images */
import { useRef, useState } from 'react';
import type { Rectangle } from '@/lib/exploration/model';
import { rectangleSchema } from '@/lib/exploration/model';
import { Button } from '../ui/button';
import { EvidenceViewport } from './evidence-viewport';
export function MediaAnnotator({
  url,
  title,
  marks,
  selectedId,
  onCreate,
  onUpdate,
  disabled = false,
}: {
  url: string;
  title: string;
  marks: { id: string; rect: Rectangle | null; label: string }[];
  selectedId?: string | null;
  onCreate: (rect: Rectangle | null, note: string) => void;
  onUpdate?: (id: string, rect: Rectangle | null, note: string) => void;
  disabled?: boolean;
}) {
  const [rect, setRect] = useState<Rectangle | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const selected = marks.find((mark) => mark.id === selectedId);
  const start = useRef<{ x: number; y: number } | null>(null);
  function coordinates(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }
  return (
    <div className="media-annotator">
      <EvidenceViewport>
        <div
          className={`annotate-image ${disabled ? 'readonly' : ''}`}
          data-testid="annotation-canvas"
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = coordinates(event);
            setRect(null);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            const point = coordinates(event);
            const value = {
              x: Math.min(start.current.x, point.x),
              y: Math.min(start.current.y, point.y),
              width: Math.abs(point.x - start.current.x),
              height: Math.abs(point.y - start.current.y),
            };
            setRect(value);
          }}
          onPointerUp={() => {
            start.current = null;
          }}
          onPointerCancel={() => {
            start.current = null;
            setRect(null);
          }}
        >
          <img src={url} alt={title} draggable={false} />
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="独立保存的原图区域标注"
          >
            {marks
              .filter((m) => m.rect)
              .map((m) => (
                <rect
                  key={m.id}
                  x={m.rect!.x * 1000}
                  y={m.rect!.y * 1000}
                  width={m.rect!.width * 1000}
                  height={m.rect!.height * 1000}
                  className={selectedId === m.id ? 'selected' : ''}
                >
                  <title>{m.label}</title>
                </rect>
              ))}
            {rect && (
              <rect
                x={rect.x * 1000}
                y={rect.y * 1000}
                width={rect.width * 1000}
                height={rect.height * 1000}
                className="draft"
              />
            )}
          </svg>
        </div>
      </EvidenceViewport>
      {!disabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!note.trim()) {
              setError('请填写你实际观察到的内容。');
              return;
            }
            if (rect && !rectangleSchema.safeParse(rect).success) {
              setError('请绘制有效区域，或选择整张图。');
              return;
            }
            if (editingId && onUpdate) onUpdate(editingId, rect, note.trim());
            else onCreate(rect, note.trim());
            setRect(null);
            setNote('');
            setEditingId(null);
          }}
        >
          <p className="muted">拖动框选区域，或使用整张图。框选不识字，填写说明后保存为证据。</p>
          {selected && onUpdate && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setEditingId(selected.id);
                setRect(selected.rect);
                setNote(selected.label);
              }}
            >
              编辑选中标注
            </button>
          )}
          {editingId && (
            <p className="callout">
              正在修改原有标注；保存后依赖它的结论将需复核。
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setRect(null);
                  setNote('');
                }}
              >
                取消修改
              </button>
            </p>
          )}
          <div className="coordinate-fields">
            {(['x', 'y', 'width', 'height'] as const).map((key, index) => (
              <label key={key}>
                {['左侧', '顶部', '宽度', '高度'][index]} %
                <input
                  aria-label={`标注${['左侧', '顶部', '宽度', '高度'][index]}百分比`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={
                    Math.round(
                      (rect?.[key] ?? (key === 'width' || key === 'height' ? 1 : 0)) * 1000,
                    ) / 10
                  }
                  onChange={(e) =>
                    setRect({
                      ...(rect ?? { x: 0, y: 0, width: 1, height: 1 }),
                      [key]: Number(e.target.value) / 100,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            区域说明
            <textarea
              className="field"
              aria-label="区域说明"
              rows={3}
              maxLength={3000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：右侧为编辑结果的实时预览，不包含支付功能。"
            />
          </label>
          {error && (
            <p role="alert" className="callout error">
              {error}
            </p>
          )}
          <div className="explore-inline-actions">
            <button className="text-button" type="button" onClick={() => setRect(null)}>
              使用整张图
            </button>
            <Button type="submit">{editingId ? '保存标注修改' : '保存区域证据'}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
