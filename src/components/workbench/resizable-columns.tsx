'use client';
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Workspace } from '@/lib/workbench/model';
import { fitColumns } from '@/lib/workbench/layout';

type Widths = Pick<Workspace['ui'], 'leftWidth' | 'rightWidth'>;
export function ResizableColumns({
  layout,
  onResize,
  mobilePane,
  children,
}: {
  layout: Pick<Workspace['ui'], 'leftOpen' | 'rightOpen' | 'leftWidth' | 'rightWidth'>;
  onResize: (widths: Partial<Widths>) => void;
  mobilePane: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1440);
  const [live, setLive] = useState<Partial<Widths> | null>(null);
  const drag = useRef<{ side: 'left' | 'right'; x: number; start: number; value: number } | null>(
    null,
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitted = fitColumns(width, { ...layout, ...live });
  const panes = Children.toArray(children);
  function handle(side: 'left' | 'right') {
    const key = side === 'left' ? 'leftWidth' : 'rightWidth';
    const value = fitted[key];
    const bounds = side === 'left' ? fitted.leftBounds : fitted.rightBounds;
    const label = side === 'left' ? '调整资料栏宽度' : '调整助手栏宽度';
    return (
      <div
        className={`column-resizer ${side}-resizer ${layout[side === 'left' ? 'leftOpen' : 'rightOpen'] ? '' : 'desktop-hidden'}`}
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={value}
        aria-valuetext={`${value} 像素`}
        tabIndex={0}
        title="拖动调整宽度；方向键微调，Home 恢复默认"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { side, x: event.clientX, start: value, value };
          setLive({ [key]: value });
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.side !== side) return;
          current.value = Math.round(
            Math.min(
              bounds.max,
              Math.max(
                bounds.min,
                current.start + (event.clientX - current.x) * (side === 'left' ? 1 : -1),
              ),
            ),
          );
          setLive({ [key]: current.value });
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          onResize({ [key]: drag.current.value });
          drag.current = null;
          setLive(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setLive(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setLive(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            drag.current = null;
            setLive(null);
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? side === 'left'
                ? 240
                : 340
              : value + (event.key === 'ArrowRight' ? 24 : -24) * (side === 'left' ? 1 : -1);
          onResize({ [key]: Math.min(bounds.max, Math.max(bounds.min, next)) });
        }}
      >
        <span />
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className={`work-columns ${layout.leftOpen ? '' : 'left-collapsed'} ${layout.rightOpen ? '' : 'right-collapsed'} mobile-${mobilePane} ${live ? 'is-resizing' : ''}`}
      style={
        {
          '--left-width': `${fitted.leftWidth}px`,
          '--right-width': `${fitted.rightWidth}px`,
        } as React.CSSProperties
      }
    >
      {panes[0]}
      {handle('left')}
      {panes[1]}
      {handle('right')}
      {panes[2]}
    </div>
  );
}
