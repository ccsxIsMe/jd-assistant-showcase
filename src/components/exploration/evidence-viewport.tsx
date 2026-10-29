'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
export function EvidenceViewport({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const reopening = useRef(false);
  useLayoutEffect(() => {
    if (!open || !reopening.current) return;
    reopening.current = false;
    scroll.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [open]);
  return (
    <section className="evidence-viewport">
      <div className="evidence-view-controls" role="group" aria-label="证据查看控制">
        <button
          type="button"
          aria-label="缩小证据"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          − 缩小
        </button>
        <output aria-label="证据缩放比例">{Math.round(zoom * 100)}%</output>
        <button
          type="button"
          aria-label="放大证据"
          disabled={zoom >= 3}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        >
          ＋ 放大
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            scroll.current?.scrollTo({ left: 0, top: 0 });
          }}
        >
          返回原始位置
        </button>
        <button
          type="button"
          onClick={() => {
            if (onClose) onClose();
            else {
              reopening.current = !open;
              setOpen(!open);
            }
          }}
        >
          {onClose ? '关闭证据并返回' : open ? '关闭预览' : '重新打开预览'}
        </button>
      </div>
      {open && (
        <div className="evidence-zoom-scroll" ref={scroll}>
          <div className="evidence-zoom-content" style={{ width: `${zoom * 100}%` }}>
            {children}
          </div>
        </div>
      )}
    </section>
  );
}
