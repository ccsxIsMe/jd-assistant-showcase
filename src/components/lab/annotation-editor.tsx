'use client';
/* eslint-disable @next/next/no-img-element -- Render local immutable source assets */
import { useEffect, useRef, useState } from 'react';
import { useAssetURL } from '@/hooks/use-exploration';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
import { addAnnotation, updateAnnotation } from '@/lib/lab/operations';
import type { Exploration, Rectangle } from '@/lib/exploration/model';
import type { Annotation } from '@/lib/lab/model';
import { visionOutputSchema } from '@/lib/lab/vision-contract';
import { touchExploration } from '@/lib/exploration/domain';
import { RecognizedTextEvidence } from './recognized-text-evidence';
type Props = {
  project: Exploration;
  sourceId: string;
  readonly?: boolean;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  onClose: () => void;
};
export function AnnotationEditor({
  project: p,
  sourceId,
  update,
  onClose,
  readonly = false,
}: Props) {
  const s = p.sources.find((v) => v.id === sourceId)!,
    v = s.versions.at(-1)!;
  const asset = useAssetURL(v.assetId);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rectangle | null>(null);
  const [page, setPage] = useState(1);
  const [rendered, setRendered] = useState<{
    url: string;
    width: number;
    height: number;
    page: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [visionStatus, setVisionStatus] = useState('');
  const [label, setLabel] = useState('');
  const [visionBusy, setVisionBusy] = useState(false),
    [visionConsent, setVisionConsent] = useState(false);
  const visionController = useRef<AbortController | null>(null);
  useEffect(() => () => visionController.current?.abort(), []);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    kind: 'move' | 'resize';
    x: number;
    y: number;
    rect: Rectangle;
  } | null>(null);
  const pdf = v.mime === 'application/pdf';
  useEffect(() => {
    if (!pdf || !asset.url) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const js = await import('pdfjs-dist');
        js.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const task = js.getDocument({
          url: asset.url,
          cMapUrl: '/pdf-cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdf-fonts/',
          useWasm: false,
        });
        destroy = () => task.destroy();
        const doc = await task.promise,
          sheet = await doc.getPage(page),
          size = sheet.getViewport({ scale: 1 }),
          viewport = sheet.getViewport({ scale: Math.min(1.5, 1200 / size.width) }),
          canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error();
        await sheet.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!cancelled)
          setRendered({
            url: canvas.toDataURL('image/png'),
            width: size.width,
            height: size.height,
            page,
          });
      } catch {
        if (!cancelled) setError('PDF页面渲染失败，可以在原资料中核对文字。');
      } finally {
        await destroy?.();
      }
    })();
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [asset.url, pdf, page]);
  const frame = p.evidence.find(
    (e) => e.sourceId === s.id && e.location.kind === 'video' && e.location.frameAssetId,
  );
  const frameAsset = useAssetURL(
    frame?.location.kind === 'video' ? frame.location.frameAssetId : null,
  );
  const url = pdf
    ? rendered?.page === page
      ? rendered.url
      : ''
    : s.kind === 'video'
      ? frameAsset.url
      : asset.url;
  const width = pdf ? rendered?.width : v.width;
  const height = pdf ? rendered?.height : v.height;
  const marks = p.lab!.annotations.filter(
    (a) =>
      a.sourceId === s.id &&
      a.sourceRevision === v.revision &&
      a.status !== 'deleted' &&
      (!pdf || a.page === page),
  );
  const active = marks.find((a) => a.id === selected);
  function commit(a: Annotation, geometry: Rectangle) {
    update((n) => updateAnnotation(n, a.id, { geometry }));
    setDraft(null);
  }
  async function recognize() {
    if (visionBusy || !url || !width || !height) return;
    setVisionConsent(false);
    setVisionBusy(true);
    setError('');
    setVisionStatus('正在读取实际图像并请求识别…');
    const own = new AbortController();
    visionController.current = own;
    const timer = setTimeout(() => own.abort('timeout'), 65000);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight),
        canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法读取图像');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png').split(',')[1];
      const response = await fetch('/api/lab/image-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: own.signal,
        body: JSON.stringify({
          projectId: p.id,
          sourceId: s.id,
          sourceRevision: v.revision,
          mode: p.mode,
          consent: true,
          png,
          width: canvas.width,
          height: canvas.height,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          `${data.error || '图像识别失败'} · ${data.code ?? response.status} · 请求编号：${data.requestId ?? ''}`,
        );
      own.signal.throwIfAborted();
      const output = visionOutputSchema.parse(data.output);
      if (
        data.projectId !== p.id ||
        data.sourceId !== s.id ||
        data.sourceRevision !== v.revision ||
        data.mode !== p.mode
      )
        throw new Error('图像结果绑定不一致，未应用');
      const saved = update((current) => {
        if (
          current.sources.find((source) => source.id === s.id)?.versions.at(-1)?.revision !==
          v.revision
        )
          throw new Error('图像版本已改变，返回结果已过期，现有内容保留。');
        let next = structuredClone(current);
        if (next.lab!.visualResults.some((r) => r.requestId === data.requestId)) return next;
        next.lab!.visualResults.push({
          id: crypto.randomUUID(),
          sourceId: s.id,
          sourceRevision: v.revision,
          requestId: data.requestId,
          promptVersion: data.promptVersion,
          mode: p.mode,
          createdAt: new Date().toISOString(),
          output,
        });
        for (const region of output.regions) {
          if (!region.geometry) continue;
          next = addAnnotation(next, {
            sourceId: s.id,
            sourceRevision: v.revision,
            shapeType: 'rectangle',
            normalizedGeometry: region.geometry,
            label: `${region.label}：${region.excerpt}`.slice(0, 2000),
            status: 'pending',
            createdBy: p.mode === 'example' ? 'example' : 'ai',
            originalWidth: width!,
            originalHeight: height!,
            ...(pdf
              ? { page }
              : s.kind === 'video' && frame?.location.kind === 'video'
                ? { time: frame.location.time, assetId: frame.location.frameAssetId ?? undefined }
                : { assetId: v.assetId }),
          });
        }
        return touchExploration(next, '保存图像识别候选，仍待人工核对');
      });
      if (saved)
        setVisionStatus(
          output.text || output.regions.length
            ? '识图已完成，候选结果已保存；请核对文字或接受标注后参与关联。'
            : '识图请求已结束，未提取可用文字或区域；可手动补充说明。',
        );
      else setVisionStatus('结果未保存，请查看保存错误；原有资料保留。');
    } catch (e) {
      setVisionStatus('图像分析未完成；已有标注和文字保留。');
      setError(
        own.signal.aborted
          ? '图像请求超时或已取消；已有标注保留。'
          : e instanceof Error
            ? e.message
            : '图像识别失败',
      );
    } finally {
      clearTimeout(timer);
      visionController.current = null;
      setVisionBusy(false);
    }
  }
  return (
    <Modal title={`区域标注 · ${s.title}`} onClose={onClose} wide>
      <p className="callout">
        虚线框为待确认候选。接受只确认区域，不确认任何功能或岗位结论。拖动框移动；拖动右下角调整尺寸，也可使用下方数字输入。
      </p>
      <p className="callout">
        上传文件不会自动识图。框选只记录位置，不会识别文字。点击下方按钮才发送当前图片、PDF页或关键帧。请核对文字并保存为证据，或接受有坐标的候选标注，再运行关联分析。
      </p>
      {!readonly && url && (
        <div className="explore-inline-actions">
          <button
            disabled={visionBusy}
            onClick={() => (p.mode === 'real' ? setVisionConsent(true) : void recognize())}
          >
            {visionBusy ? '正在分析图像…' : '提取图像文字与标注候选'}
          </button>
          {visionBusy && (
            <button onClick={() => visionController.current?.abort('user')}>取消图像分析</button>
          )}
        </div>
      )}
      {visionStatus && (
        <p className="callout" role="status">
          {visionStatus}
        </p>
      )}
      {visionConsent && (
        <div className="callout warning">
          <p>
            本次会把当前图像、PDF页面或单个视频关键帧（缩放至最长边1600像素）发送给外部DeepSeek视觉模型。识别文字与坐标仅为候选，需要人工核对；不会自动确认结论，不发送整段视频或声音。
          </p>
          <button onClick={() => void recognize()}>我确认发送此图像</button>
          <button onClick={() => setVisionConsent(false)}>取消</button>
        </div>
      )}
      {p
        .lab!.visualResults.filter((r) => r.sourceId === s.id && r.sourceRevision === v.revision)
        .map((r) => (
          <details
            key={r.id}
            open={
              r.id ===
              p
                .lab!.visualResults.filter(
                  (result) => result.sourceId === s.id && result.sourceRevision === v.revision,
                )
                .at(-1)?.id
            }
          >
            <summary>
              {r.mode === 'example' ? '演示数据，非真实AI分析' : 'AI识别候选，需核对'} ·{' '}
              {r.promptVersion}
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{r.output.text || '未提取到可读文字'}</pre>
            {r.output.regions
              .filter((region) => !region.geometry)
              .map((region, i) => (
                <p key={i}>
                  {region.label}：{region.excerpt} · 无可靠坐标，请人工标注。
                </p>
              ))}
            {r.output.limitations.map((value, i) => (
              <p key={i}>{value}</p>
            ))}
            {s.kind === 'image' && (
              <RecognizedTextEvidence
                key={r.id}
                project={p}
                resultId={r.id}
                update={update}
                readonly={readonly}
              />
            )}
          </details>
        ))}
      {pdf && (
        <label>
          PDF页码{' '}
          <input
            aria-label="标注PDF页码"
            type="number"
            min={1}
            max={v.pageCount}
            value={page}
            onChange={(e) => {
              setPage(Number(e.target.value));
              setSelected(null);
            }}
          />
        </label>
      )}
      {(error || asset.error) && <p role="alert">{error || asset.error}</p>}
      {url ? (
        <div ref={surface} className="lab-annotation-surface">
          <img src={url} alt={`${s.title} 原始资料预览`} />
          {marks.map((a) => {
            const r = a.id === selected && draft ? draft : a.normalizedGeometry;
            return (
              <div
                key={a.id}
                data-testid="annotation-box"
                data-status={a.status}
                tabIndex={0}
                role="button"
                aria-label={`${a.label}，${a.status === 'accepted' ? '已接受' : '待确认'}`}
                className={`lab-annotation-box ${a.status} ${selected === a.id ? 'selected' : ''}`}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
                }}
                onClick={() => {
                  setSelected(a.id);
                  setLabel(a.label);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSelected(a.id);
                    setLabel(a.label);
                  }
                }}
                onPointerDown={(e) => {
                  if (readonly) return;
                  e.stopPropagation();
                  setSelected(a.id);
                  setLabel(a.label);
                  e.currentTarget.setPointerCapture(e.pointerId);
                  gesture.current = {
                    id: a.id,
                    kind: (e.target as HTMLElement).dataset.resize ? 'resize' : 'move',
                    x: e.clientX,
                    y: e.clientY,
                    rect: a.normalizedGeometry,
                  };
                }}
                onPointerMove={(e) => {
                  const g = gesture.current,
                    b = surface.current?.getBoundingClientRect();
                  if (!g || g.id !== a.id || !b) return;
                  const dx = (e.clientX - g.x) / b.width,
                    dy = (e.clientY - g.y) / b.height,
                    r = g.rect;
                  setDraft(
                    g.kind === 'move'
                      ? {
                          ...r,
                          x: Math.max(0, Math.min(1 - r.width, r.x + dx)),
                          y: Math.max(0, Math.min(1 - r.height, r.y + dy)),
                        }
                      : {
                          ...r,
                          width: Math.max(0.01, Math.min(1 - r.x, r.width + dx)),
                          height: Math.max(0.01, Math.min(1 - r.y, r.height + dy)),
                        },
                  );
                }}
                onPointerUp={(e) => {
                  if (gesture.current?.id === a.id) {
                    gesture.current = null;
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    if (draft) commit(a, draft);
                  }
                }}
                onPointerCancel={() => {
                  gesture.current = null;
                  setDraft(null);
                }}
              >
                <span>
                  {a.status === 'accepted' ? '✓' : '待确认'} · {a.label}
                </span>
                {!readonly && <i data-resize="true" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      ) : (
        <p role="status">
          {s.kind === 'video' && !frame
            ? '请先在原资料中保存一个可定位关键帧。'
            : '正在读取原始图像…'}
        </p>
      )}
      <div className="lab-annotation-list">
        {marks.map((a) => (
          <button
            key={a.id}
            className={selected === a.id ? 'selected' : ''}
            onClick={() => {
              setSelected(a.id);
              setLabel(a.label);
            }}
          >
            {a.label} · {a.status === 'accepted' ? '已接受' : '待确认'}
          </button>
        ))}
      </div>
      {!readonly && active && (
        <div className="form-stack">
          <label>
            标注名称
            <input
              aria-label="标注名称"
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <div className="lab-geometry">
            {(['x', 'y', 'width', 'height'] as const).map((k) => (
              <label key={k}>
                {{ x: '左侧', y: '顶部', width: '宽度', height: '高度' }[k]}（0–1）
                <input
                  aria-label={`标注${k}`}
                  type="number"
                  min={k === 'width' || k === 'height' ? 0.01 : 0}
                  max={1}
                  step={0.01}
                  value={(draft ?? active.normalizedGeometry)[k]}
                  onChange={(e) =>
                    setDraft({
                      ...(draft ?? active.normalizedGeometry),
                      [k]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="explore-inline-actions">
            <Button
              onClick={() => {
                if (
                  update((n) =>
                    updateAnnotation(n, active.id, {
                      geometry: draft ?? active.normalizedGeometry,
                      label,
                    }),
                  )
                )
                  setDraft(null);
              }}
            >
              保存标注调整
            </Button>
            <Button
              variant="outline"
              disabled={active.status === 'accepted'}
              onClick={() => update((n) => updateAnnotation(n, active.id, { status: 'accepted' }))}
            >
              接受此标注
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                update((n) => updateAnnotation(n, active.id, { status: 'deleted' }));
                setSelected(null);
              }}
            >
              删除此标注
            </Button>
          </div>
          <p>
            关联证据：{active.evidenceId}；来源 V{active.sourceRevision}。移动标注不会改变原始文件。
          </p>
        </div>
      )}
      {!readonly && width && height && (
        <Button
          variant="outline"
          onClick={() => {
            update((n) =>
              addAnnotation(n, {
                sourceId: s.id,
                sourceRevision: v.revision,
                shapeType: 'rectangle',
                normalizedGeometry: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
                label: '请调整区域并填写证据说明',
                status: 'pending',
                createdBy: 'user',
                originalWidth: width,
                originalHeight: height,
                ...(pdf
                  ? { page }
                  : s.kind === 'video' && frame?.location.kind === 'video'
                    ? {
                        time: frame.location.time,
                        assetId: frame.location.frameAssetId ?? undefined,
                      }
                    : { assetId: v.assetId }),
              }),
            );
          }}
        >
          新增人工区域标注
        </Button>
      )}
    </Modal>
  );
}
