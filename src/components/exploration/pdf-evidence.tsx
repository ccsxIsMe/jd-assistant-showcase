'use client';
import { useEffect, useState } from 'react';
import { MediaAnnotator } from './media-annotator';
import type { Rectangle } from '@/lib/exploration/model';
export function PDFEvidence({
  url,
  page,
  pageCount,
  onPage,
  onAnnotate,
  onUpdate,
  marks,
  selectedId,
  readonly,
}: {
  url: string;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  onAnnotate: (rect: Rectangle | null, note: string) => void;
  onUpdate: (id: string, rect: Rectangle | null, note: string) => void;
  marks: { id: string; rect: Rectangle | null; label: string }[];
  selectedId?: string | null;
  readonly: boolean;
}) {
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const key = `${url}:${page}`;
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const task = pdfjs.getDocument({
          url,
          cMapUrl: '/pdf-cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdf-fonts/',
          useWasm: false,
        });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        const sheet = await pdf.getPage(page);
        const viewport = sheet.getViewport({
          scale: Math.min(1.5, 1200 / sheet.getViewport({ scale: 1 }).width),
        });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error();
        await sheet.render({ canvas, canvasContext: context, viewport }).promise;
        if (!cancelled) {
          setRendered({ key, url: canvas.toDataURL('image/png') });
          setError('');
        }
      } catch {
        if (!cancelled) setError('PDF页面渲染失败。仍可核对下方已解析文字，或打开原文件。');
      } finally {
        await destroy?.();
      }
    }
    void render();
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [url, page, key]);
  return (
    <div className="pdf-evidence">
      <div className="explore-inline-actions">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <span>
          第 {page} / {pageCount} 页
        </span>
        <button disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          下一页
        </button>
        <a href={url} target="_blank" rel="noreferrer">
          打开原PDF
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {rendered?.key === key ? (
        <MediaAnnotator
          url={rendered.url}
          title={`原PDF第${page}页渲染`}
          marks={marks}
          selectedId={selectedId}
          disabled={readonly}
          onCreate={onAnnotate}
          onUpdate={onUpdate}
        />
      ) : (
        !error && <p role="status">正在渲染原PDF页面…</p>
      )}
      <p className="muted">
        文本引用只定位页码和原文；没有可靠区域坐标时不自动画框。区域框由人工另行标注。
      </p>
    </div>
  );
}
