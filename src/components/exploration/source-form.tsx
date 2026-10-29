'use client';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { ACCEPT_MATERIALS, addUserIntent, ingestFile } from '@/lib/exploration/files';
import { ideaSource, urlSource } from '@/lib/exploration/sources';
import { purposeNames, type Exploration, type ExploreSource } from '@/lib/exploration/model';
import { clipboardImages, preparePastedImages } from '@/lib/exploration/clipboard';
import { referenceLink, VIDEO_LINK_NOTICE } from '@/lib/exploration/reference-link';
function ImagePreview({ file }: { file: File }) {
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(file);
    const element = preview.current;
    if (element) element.src = value;
    return () => {
      element?.removeAttribute('src');
      URL.revokeObjectURL(value);
    };
  }, [file]);
  // Local immutable object URLs are previews, not remote Next Image assets.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={preview} alt={`待添加图片预览：${file.name}`} />;
}
export function SourceForm({
  project,
  onAdd,
  onClose,
  initial = 'text',
  initialFiles = [],
  initialLinkedSourceId = '',
}: {
  project: Exploration;
  onAdd: (source: ExploreSource) => void;
  onClose: () => void;
  initial?: 'text' | 'url' | 'file';
  initialFiles?: File[];
  initialLinkedSourceId?: string;
}) {
  const [kind, setKind] = useState(initial);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setURL] = useState('');
  const [purpose, setPurpose] = useState<ExploreSource['purpose']>('main');
  const [borrow, setBorrow] = useState('');
  const [avoid, setAvoid] = useState('');
  const [referencePurpose, setReferencePurpose] = useState('');
  const [linkedSourceId, setLinked] = useState(initialLinkedSourceId);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  async function save() {
    if (busy) return;
    setError('');
    setBusy(true);
    const own = new AbortController();
    controller.current = own;
    try {
      const output: ExploreSource[] = [];
      if (kind === 'text') output.push(ideaSource(title || '我的想法', text));
      if (kind === 'url') {
        const normalized = referenceLink(url).url;
        if (
          project.sources.some(
            (s) =>
              !s.removed &&
              s.kind === 'url' &&
              s.versions.some((v) => [v.originalUrl, v.normalizedUrl].includes(normalized)),
          )
        )
          throw new Error('此链接已在研究中，请更新原资料版本或补充说明，避免重复导入。');
        setStatus('正在受控读取公开网页正文');
        output.push(await urlSource(url, own.signal, title));
      }
      if (kind === 'file') {
        if (!files.length) throw new Error('请选择文件。');
        if (files.length > 10) throw new Error('每次最多选择10份文件。');
        for (const file of files) {
          own.signal.throwIfAborted();
          setStatus(`${file.name} · 正在读取与解析`);
          try {
            output.push((await ingestFile(project.id, file, own.signal)).source);
          } catch (error) {
            throw new Error(`${file.name}：${error instanceof Error ? error.message : '解析失败'}`);
          }
        }
      }
      if (project.sources.length + output.length > 40)
        throw new Error('每个探索最多40份来源，请先精简。');
      own.signal.throwIfAborted();
      for (const source of output) {
        Object.assign(source, {
          purpose,
          borrow,
          avoid,
          referencePurpose,
          linkedSourceId: linkedSourceId || null,
        });
        addUserIntent(source);
        if (source.kind === 'image' && linkedSourceId)
          source.versions.at(-1)!.screenshotStatus = 'user-provided';
        onAdd(source);
      }
      onClose();
    } catch (error) {
      setError(
        own.signal.aborted
          ? '已取消，已有资料保留。'
          : error instanceof Error
            ? error.message
            : '添加失败',
      );
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <Modal
      title="添加探索资料"
      onClose={() => {
        controller.current?.abort();
        onClose();
      }}
    >
      <form
        className="form-stack exploration-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onPaste={(event) => {
          const images = clipboardImages(event.clipboardData);
          if (!images.length) {
            if (event.target instanceof HTMLElement && event.target.closest('.explore-paste-zone'))
              setError(
                '剪贴板没有图片文件。请使用“复制图片”或截图后再粘贴；复制图片地址不会带上原图。',
              );
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (busy) return;
          try {
            const next = preparePastedImages(images, files.length);
            setFiles([...files, ...next]);
            setKind('file');
            setError('');
          } catch (error) {
            setError(error instanceof Error ? error.message : '无法粘贴图片');
          }
        }}
      >
        <div className="explore-segment" role="group" aria-label="资料入口">
          {(
            [
              ['text', '描述想法'],
              ['url', '参考产品网址'],
              ['file', '上传材料'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
        {kind !== 'file' && (
          <label>
            资料 / 产品名称
            <Input
              aria-label="资料或产品名称"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="可选，可从网页提取标题"
              disabled={busy}
            />
          </label>
        )}
        {kind === 'text' && (
          <label>
            想法与上下文
            <Textarea
              aria-label="想法与上下文"
              rows={9}
              required
              maxLength={30000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="想解决什么问题？谁会使用？已有资源、预算、时间与不确定之处……只写一段自然语言也可以。"
              disabled={busy}
            />
          </label>
        )}
        {kind === 'url' && (
          <>
            <label>
              公开产品网址
              <Input
                aria-label="公开产品网址"
                type="url"
                required
                value={url}
                maxLength={2000}
                onChange={(e) => setURL(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="muted">
              只读取公开静态正文，不绕过登录或访问限制；动态页面可补充截图和文字。网页不会自动视为需要完整复刻的产品。
            </p>
            {referenceLink(url).video && <p className="callout warning">{VIDEO_LINK_NOTICE}</p>}
          </>
        )}
        {kind === 'file' && (
          <>
            <div
              className="explore-paste-zone"
              tabIndex={0}
              role="region"
              aria-label="粘贴图片区域"
            >
              <strong>复制图片或截图后，在这里按Ctrl+V</strong>
              <p>
                支持PNG、JPG、WebP，每张≤8MB；先预览，再点击保存。复制图片地址或网页链接不会带上原图。
              </p>
            </div>
            <label>
              参考文件
              <input
                aria-label="参考文件"
                type="file"
                multiple
                accept={ACCEPT_MATERIALS}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                disabled={busy}
              />
            </label>
            <p className="muted">
              PNG / JPG / WebP ≤8MB；PDF / DOCX / TXT / Markdown ≤10MB；MP4
              ≤30MB、10分钟。图片可在需求实验室主动识图；无自动整段视频分析、语音转写或批量OCR。
            </p>
            <ul className="explore-file-previews">
              {files.map((file, index) => (
                <li key={file.name + file.size + index}>
                  {['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && (
                    <ImagePreview file={file} />
                  )}
                  {file.name} · {(file.size / 1024).toFixed(1)} KB ·{' '}
                  {busy ? '等待 / 解析中' : '待解析'}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`移除待添加文件${file.name}`}
                    onClick={() => setFiles(files.filter((_, i) => i !== index))}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <label>
          这份资料的用途
          <select
            className="field"
            aria-label="资料用途"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as ExploreSource['purpose'])}
            disabled={busy}
          >
            {Object.entries(purposeNames).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            想借鉴的功能
            <Textarea
              aria-label="想借鉴的功能"
              rows={2}
              value={borrow}
              onChange={(e) => setBorrow(e.target.value)}
              maxLength={2000}
              disabled={busy}
            />
          </label>
          <label>
            不借鉴的部分
            <Textarea
              aria-label="不借鉴的部分"
              rows={2}
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              maxLength={2000}
              disabled={busy}
            />
          </label>
        </div>
        <label>
          参考目的 / 人工补充说明
          <Textarea
            aria-label="参考目的"
            rows={3}
            value={referencePurpose}
            onChange={(e) => setReferencePurpose(e.target.value)}
            maxLength={2000}
            disabled={busy}
          />
        </label>
        {(kind === 'file' || !!initialLinkedSourceId) && (
          <label>
            关联原始网页或视频链接（可选）
            <select
              className="field"
              aria-label="关联原始链接"
              value={linkedSourceId}
              onChange={(e) => setLinked(e.target.value)}
              disabled={busy}
            >
              <option value="">独立参考材料</option>
              {project.sources
                .filter((s) => s.kind === 'url' && !s.removed)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        {status && busy && <p role="status">{status}</p>}
        {error && (
          <p role="alert" className="callout error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              controller.current?.abort();
              onClose();
            }}
          >
            {busy ? '取消解析' : '取消'}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? '处理资料中…' : '保存资料并查看结果'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
