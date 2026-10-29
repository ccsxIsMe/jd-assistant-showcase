'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const d = ref.current;
    d?.showModal();
    return () => {
      d?.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`work-modal ${wide ? 'wide' : ''}`}
      aria-label={title}
    >
      <header className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="关闭弹窗" className="icon-button" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
