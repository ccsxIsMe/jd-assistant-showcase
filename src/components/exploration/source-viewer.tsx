'use client';
import { sourceParseNotice } from '@/lib/exploration/media-capabilities';
import { useEffect, useRef, useState } from 'react';
import { FileText, Link as LinkIcon, Scan, Video } from 'lucide-react';
import { Button } from '../ui/button';
import { Modal } from '../workbench/modal';
import { MediaAnnotator } from './media-annotator';
import { PDFEvidence } from './pdf-evidence';
import { useAssetURL } from '@/hooks/use-exploration';
import { paragraphs, sourceChanged, touchExploration } from '@/lib/exploration/domain';
import {
  makeId,
  parseNames,
  timestamp,
  type Evidence,
  type Exploration,
  type ExploreSource,
  type Rectangle,
} from '@/lib/exploration/model';
import { explorationStore } from '@/lib/exploration/storage';
import { ingestFile } from '@/lib/exploration/files';
import { urlSource } from '@/lib/exploration/sources';
import { referenceLink, VIDEO_LINK_NOTICE, safePublicHref } from '@/lib/exploration/reference-link';
export function SourceViewer({
  project: p,
  source,
  update,
  jumpFinding,
  onReturn,
  onSupplement,
  onRecognize,
}: {
  project: Exploration;
  source: ExploreSource | undefined;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  jumpFinding: (id: string) => void;
  onReturn: () => void;
  onSupplement: (kind: 'file' | 'text', sourceId: string) => void;
  onRecognize?: (sourceId: string) => void;
}) {
  const selectedEvidence = p.evidence.find(
    (e) => e.evidenceId === p.ui.evidenceId && e.sourceId === source?.id,
  );
  const version =
    source?.versions.find((v) => v.revision === selectedEvidence?.sourceRevision) ??
    source?.versions.at(-1);
  const asset = useAssetURL(version?.assetId);
  const frame = useAssetURL(
    selectedEvidence?.location.kind === 'video'
      ? selectedEvidence.location.frameAssetId
      : undefined,
  );
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState<ExploreSource['purpose']>('main');
  const [borrow, setBorrow] = useState('');
  const [avoid, setAvoid] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [page, setPage] = useState(1);
  const [pointNote, setPointNote] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const paragraphRefs = useRef(new Map<string, HTMLDivElement>());
  const controller = useRef<AbortController | null>(null);
  const location = selectedEvidence?.location;
  const activePage =
    location?.kind === 'document' || (location?.kind === 'text' && location.page)
      ? location.page!
      : page;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (location?.kind === 'text')
      paragraphRefs.current
        .get(location.paragraphId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (location?.kind === 'video' && video.current) video.current.currentTime = location.time;
  }, [location, source?.id]);
  if (!source || !version)
    return (
      <div className="explore-empty">
        <FileText size={32} />
        <h3>资料是探索的起点</h3>
        <p>从左侧选择来源查看原文、证据和已关联的结论。</p>
      </div>
    );
  const sourceId = source.id;
  const currentRevision = source.versions.at(-1)!.revision;
  const historical = source.removed || version.revision !== currentRevision;
  const marks = p.evidence.filter(
    (e) => e.sourceId === sourceId && e.sourceRevision === version.revision,
  );
  function addEvidence(
    type: Evidence['evidenceType'],
    location: Evidence['location'],
    note: string,
  ) {
    update((current) => {
      const next = structuredClone(current);
      const currentSource = next.sources.find((s) => s.id === sourceId);
      if (!currentSource || currentSource.versions.at(-1)!.revision !== version!.revision)
        throw new Error('来源已变化，请先回到最新版本标注。');
      const evidenceId = makeId();
      next.evidence.push({
        evidenceId,
        sourceId,
        sourceRevision: version!.revision,
        evidenceType: type,
        title: note.slice(0, 100) || '人工证据',
        excerpt: note,
        location,
        createdAt: timestamp(),
        verificationStatus: 'verified',
        relatedFindingIds: [],
      });
      next.ui.evidenceId = evidenceId;
      return touchExploration(next, '人工新增证据标注');
    });
  }
  function createImage(rect: Rectangle | null, note: string) {
    addEvidence(
      version!.screenshotStatus === 'user-provided' ? 'web-screenshot' : 'image',
      { kind: 'image', assetId: version!.assetId!, rect },
      note,
    );
  }
  async function reparse(file?: File) {
    // Reparse creates a source revision, never overwrites an old attachment.
    if (busy) return;
    setBusy(true);
    setError('');
    const own = new AbortController();
    controller.current = own;
    try {
      let result: ExploreSource;
      if (file) result = (await ingestFile(p.id, file, own.signal, source)).source;
      else if (source!.kind === 'url')
        result = await urlSource(version!.originalUrl ?? '', own.signal, source!.title);
      else if (version!.assetId) {
        const stored = await explorationStore.asset(version!.assetId);
        if (!stored) throw new Error('原始文件缺失，请替换文件。');
        result = (
          await ingestFile(
            p.id,
            new File([stored.blob], version!.fileName ?? source!.title, { type: stored.blob.type }),
            own.signal,
            source,
          )
        ).source;
      } else throw new Error('文字资料请使用“修订文字与用途”。');
      result.id = sourceId;
      Object.assign(result, {
        purpose: source!.purpose,
        borrow: source!.borrow,
        avoid: source!.avoid,
        referencePurpose: source!.referencePurpose,
      });
      update((current) => {
        if (
          current.sources.find((s) => s.id === sourceId)?.versions.at(-1)!.revision !==
          currentRevision
        )
          throw new Error('解析期间来源已有新编辑，结果未覆盖。');
        return sourceChanged(current, result, result.versions.at(-1)!);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  function updateAnnotation(id: string, rect: Rectangle | null, note: string) {
    update((current) => {
      const n = structuredClone(current);
      const evidence = n.evidence.find((e) => e.evidenceId === id);
      if (
        !evidence ||
        evidence.sourceId !== sourceId ||
        evidence.sourceRevision !==
          n.sources.find((s) => s.id === sourceId)?.versions.at(-1)?.revision
      )
        throw new Error('证据或来源已变化，请重新核实。');
      if (
        evidence.location.kind === 'image' ||
        evidence.location.kind === 'video' ||
        evidence.location.kind === 'document'
      )
        evidence.location.rect = rect;
      evidence.excerpt = note;
      evidence.title = note.slice(0, 100);
      evidence.verificationStatus = 'verified';
      for (const f of n.findings.filter(
        (f) => f.evidenceIds.includes(id) && f.status !== 'excluded',
      )) {
        f.revision++;
        f.status = 'review';
      }
      if (n.overview.evidenceIds.includes(id)) {
        n.overviewConfirmed = false;
        n.overviewRevision++;
      }
      return touchExploration(n, '人工修改证据区域与说明；关联结论需复核');
    });
  }
  async function capture() {
    const player = video.current;
    if (!player || player.readyState < 2) {
      setError('请等待视频画面加载后暂停，再保存关键帧。');
      return;
    }
    if (marks.filter((e) => e.evidenceType === 'video-frame').length >= 20) {
      setError('每份视频最多保存20个关键帧。');
      return;
    }
    if (!pointNote.trim()) {
      setError('请先填写当前时间点 / 关键帧的人工说明。');
      return;
    }
    player.pause();
    const capturedTime = player.currentTime;
    const scale = Math.min(1, 1280 / player.videoWidth, 720 / player.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(player.videoWidth * scale);
    canvas.height = Math.round(player.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(player, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    );
    if (!blob) {
      setError('关键帧保存失败。');
      return;
    }
    const assetId = makeId();
    await explorationStore.saveAsset({
      id: assetId,
      explorationId: p.id,
      blob,
      name: `${source!.title}-${capturedTime.toFixed(2)}s.jpg`,
    });
    addEvidence(
      'video-frame',
      { kind: 'video', time: capturedTime, frameAssetId: assetId, rect: null },
      pointNote.trim(),
    );
    setPointNote('');
  }
  return (
    <div className="explore-source-viewer">
      <button className="text-button" onClick={onReturn}>
        关闭证据并返回研究画布
      </button>
      <header>
        <div>
          <span className={`parse-badge ${source.status}`}>{parseNames[source.status]}</span>
          <h2>{source.title}</h2>
          <p>
            来源版本 v{version.revision} · {version.fileName ?? ''}{' '}
            {version.size !== undefined ? `${(version.size / 1024).toFixed(1)} KB` : ''}
          </p>
        </div>
        <div className="explore-inline-actions">
          <button
            disabled={busy}
            onClick={() => {
              setTitle(source.title);
              setText(source.versions.at(-1)!.text);
              setPurpose(source.purpose);
              setBorrow(source.borrow);
              setAvoid(source.avoid);
              setNotes(source.referencePurpose);
              setEditing(true);
            }}
          >
            修订文字与用途
          </button>
          <button disabled={busy} onClick={() => void reparse()}>
            重新解析
          </button>
          <label className="explore-import">
            替换文件
            <input
              type="file"
              aria-label="替换当前来源文件"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.mp4"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.[0]) void reparse(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </header>
      {(source.error || historical) && (
        <p className="callout warning">
          {historical
            ? '正在查看历史引用；来源已有新版本，此证据须重新核实。'
            : sourceParseNotice(source)}
        </p>
      )}
      {busy && (
        <p role="status">
          正在实际读取与解析… <button onClick={() => controller.current?.abort()}>取消</button>
        </p>
      )}
      {error && (
        <p role="alert" className="callout error">
          {error}
        </p>
      )}
      {asset.error && <p role="alert">{asset.error}</p>}
      {version.userEdited && (
        <p className="callout warning">
          当前文字由用户校订或补充，不作为程序抓取原文；原始附件与旧版本仍保留。
        </p>
      )}
      {source.kind === 'url' && (
        <div className="explore-url-meta">
          <a
            href={safePublicHref(version.normalizedUrl ?? version.originalUrl)}
            target="_blank"
            rel="noreferrer"
          >
            <LinkIcon size={14} />
            查看原始网页 ↗
          </a>
          <p>
            抓取：
            {version.fetchedAt ? new Date(version.fetchedAt).toLocaleString('zh-CN') : '尚未成功'}
            {version.updatedAt ? ` · 页面标注更新：${version.updatedAt}` : ''}
          </p>
          <p>{version.description}</p>
          <p>本次只获取正文，未获取网页截图。可添加自己的截图补充，系统不会生成图片冒充原页面。</p>
          {referenceLink(version.originalUrl ?? '').video &&
            !source.error.includes(VIDEO_LINK_NOTICE) && (
              <p className="callout warning">{VIDEO_LINK_NOTICE}</p>
            )}
          <div className="explore-inline-actions">
            <Button
              variant="outline"
              disabled={busy || historical}
              onClick={() => onSupplement('file', sourceId)}
            >
              粘贴截图或上传材料
            </Button>
            <Button
              variant="outline"
              disabled={busy || historical}
              onClick={() => onSupplement('text', sourceId)}
            >
              补充文字说明
            </Button>
          </div>
        </div>
      )}
      {source.kind === 'image' && asset.url && (
        <>
          {!historical && onRecognize && (
            <div className="callout">
              <p>图片已保存。框选仅记录区域；需要AI读取画面时，请先识图并核对文字或标注。</p>
              <button className="lab-primary" onClick={() => onRecognize(source.id)}>
                识别图片文字与画面
              </button>
            </div>
          )}
          <MediaAnnotator
            key={sourceId + version.revision}
            url={asset.url}
            title={source.title}
            disabled={historical}
            selectedId={selectedEvidence?.evidenceId}
            marks={marks.flatMap((e) =>
              e.location.kind === 'image'
                ? [{ id: e.evidenceId, rect: e.location.rect, label: e.excerpt }]
                : [],
            )}
            onCreate={createImage}
            onUpdate={updateAnnotation}
          />
        </>
      )}
      {version.mime === 'application/pdf' && asset.url && (
        <PDFEvidence
          url={asset.url}
          page={Math.min(activePage, version.pageCount ?? 1)}
          pageCount={version.pageCount ?? 1}
          onPage={(value) => {
            setPage(value);
            update((current) => {
              const n = structuredClone(current);
              n.ui.evidenceId = null;
              return touchExploration(n);
            });
          }}
          selectedId={selectedEvidence?.evidenceId}
          readonly={historical}
          marks={marks.flatMap((e) =>
            e.location.kind === 'document' && e.location.page === activePage
              ? [{ id: e.evidenceId, rect: e.location.rect, label: e.excerpt }]
              : [],
          )}
          onAnnotate={(rect, note) =>
            addEvidence('document-region', { kind: 'document', page: activePage, rect }, note)
          }
          onUpdate={updateAnnotation}
        />
      )}
      {source.kind === 'video' && asset.url && (
        <section className="video-evidence">
          <video
            key={asset.url}
            ref={video}
            controls
            preload="metadata"
            src={asset.url}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onError={() => setError('浏览器无法播放此视频编码，请替换MP4或提供截图。')}
          />
          <label>
            视频时间轴
            <input
              aria-label="视频时间轴"
              type="range"
              min="0"
              max={version.duration ?? 0}
              step="0.1"
              value={Math.min(time, version.duration ?? 0)}
              onChange={(e) => {
                if (video.current) video.current.currentTime = Number(e.target.value);
              }}
            />
          </label>
          <p>
            <Video size={16} />
            {time.toFixed(1)} / {(version.duration ?? 0).toFixed(1)} 秒 · 手动关键帧，最多20帧
          </p>
          <label>
            当前时间点 / 关键帧说明
            <textarea
              className="field"
              aria-label="关键帧说明"
              maxLength={3000}
              rows={3}
              value={pointNote}
              onChange={(e) => setPointNote(e.target.value)}
            />
          </label>
          <div className="explore-inline-actions">
            <Button
              disabled={historical}
              onClick={() => {
                void capture().catch(() => setError('关键帧保存失败，请重试。'));
              }}
            >
              <Scan size={16} />
              保存当前关键帧
            </Button>
            <button
              disabled={historical || !pointNote.trim()}
              onClick={() => {
                addEvidence(
                  'video-time',
                  {
                    kind: 'video',
                    time: video.current?.currentTime ?? time,
                    frameAssetId: null,
                    rect: null,
                  },
                  pointNote,
                );
                setPointNote('');
              }}
            >
              记录时间点
            </button>
          </div>
          <div className="video-frame-list">
            {marks
              .filter((e) => e.location.kind === 'video')
              .map((e) => (
                <button
                  key={e.evidenceId}
                  onClick={() =>
                    update((current) => {
                      const n = structuredClone(current);
                      n.ui.evidenceId = e.evidenceId;
                      return touchExploration(n);
                    })
                  }
                >
                  {e.location.kind === 'video' && e.location.time.toFixed(1)}s · {e.title}
                </button>
              ))}
          </div>
          {location?.kind === 'video' && frame.url && (
            <MediaAnnotator
              key={selectedEvidence!.evidenceId}
              url={frame.url}
              title={`实际关键帧 ${location.time.toFixed(2)}s`}
              selectedId={selectedEvidence?.evidenceId}
              marks={[
                {
                  id: selectedEvidence!.evidenceId,
                  rect: location.rect,
                  label: selectedEvidence!.excerpt,
                },
              ]}
              disabled={historical}
              onCreate={(rect, note) => addEvidence('video-frame', { ...location, rect }, note)}
              onUpdate={updateAnnotation}
            />
          )}
        </section>
      )}
      {version.paragraphs.length > 0 && (
        <section className="extracted-paragraphs">
          <h3>可定位正文与人工说明</h3>
          {version.paragraphs.map((para) => {
            const selected = location?.kind === 'text' && location.paragraphId === para.id;
            return (
              <div
                key={para.id}
                className={`evidence-paragraph ${selected ? 'highlighted' : ''}`}
                ref={(node) => {
                  if (node) paragraphRefs.current.set(para.id, node);
                  else paragraphRefs.current.delete(para.id);
                }}
                data-testid="evidence-paragraph"
              >
                <div>
                  <small>
                    {para.origin === 'user' ? '用户提供文字' : '解析原文'}
                    {para.page ? ` · 第${para.page}页` : ''}
                  </small>
                  <button
                    onClick={() => {
                      const e = marks.find(
                        (e) => e.location.kind === 'text' && e.location.paragraphId === para.id,
                      );
                      if (e)
                        update((current) => {
                          const n = structuredClone(current);
                          n.ui.evidenceId = e.evidenceId;
                          return touchExploration(n);
                        });
                    }}
                  >
                    定位此段证据
                  </button>
                </div>
                <p>
                  {selected && location?.kind === 'text' ? (
                    <>
                      {para.text.slice(0, location.start)}
                      <mark>{para.text.slice(location.start, location.end)}</mark>
                      {para.text.slice(location.end)}
                    </>
                  ) : (
                    para.text
                  )}
                </p>
              </div>
            );
          })}
        </section>
      )}
      <section className="explore-evidence-list">
        <h3>此来源的证据与关联结论</h3>
        {marks.length ? (
          marks.map((e) => (
            <div
              className={`explore-evidence-card ${selectedEvidence?.evidenceId === e.evidenceId ? 'selected' : ''}`}
              key={e.evidenceId}
            >
              <button
                onClick={() =>
                  update((current) => {
                    const n = structuredClone(current);
                    n.ui.evidenceId = e.evidenceId;
                    return touchExploration(n);
                  })
                }
              >
                {e.title || '证据'}{' '}
                <span>{e.verificationStatus === 'verified' ? '已定位' : '待核实'}</span>
              </button>
              <p>{e.excerpt || '没有人工说明，不能发送模型。'}</p>
              {e.relatedFindingIds.map((id) => (
                <button className="text-button" key={id} onClick={() => jumpFinding(id)}>
                  {p.findings.find((f) => f.id === id)?.title}
                </button>
              ))}
              {e.location.kind !== 'text' && !historical && (
                <div className="explore-inline-actions">
                  <button
                    onClick={() => {
                      const description = window.prompt('编辑证据说明', e.excerpt);
                      if (description === null || !description.trim() || description.length > 3000)
                        return;
                      update((current) => {
                        const n = structuredClone(current);
                        const target = n.evidence.find((v) => v.evidenceId === e.evidenceId)!;
                        target.excerpt = description.trim();
                        target.verificationStatus = 'verified';
                        for (const f of n.findings.filter(
                          (f) => f.evidenceIds.includes(e.evidenceId) && f.status !== 'excluded',
                        )) {
                          f.status = 'review';
                          f.revision++;
                        }
                        return touchExploration(n, '人工修改证据说明，关联结论需复核');
                      });
                    }}
                  >
                    编辑说明
                  </button>
                  <button
                    onClick={() =>
                      update((current) => {
                        const n = structuredClone(current);
                        const target = n.evidence.find((v) => v.evidenceId === e.evidenceId)!;
                        if (
                          target.location.kind === 'image' ||
                          target.location.kind === 'video' ||
                          target.location.kind === 'document'
                        )
                          target.location.rect = null;
                        for (const f of n.findings.filter(
                          (f) => f.evidenceIds.includes(e.evidenceId) && f.status !== 'excluded',
                        )) {
                          f.status = 'review';
                          f.revision++;
                        }
                        return touchExploration(n, '移除区域标注，保留原图与证据');
                      })
                    }
                  >
                    删除区域标注
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="muted">暂无可用证据。请先成功解析资料，或为图片 / 视频补充标注说明。</p>
        )}
      </section>
      {editing && (
        <Modal title="修订来源与参考边界" onClose={() => setEditing(false)}>
          <form
            className="form-stack exploration-form"
            onSubmit={(event) => {
              event.preventDefault();
              const changed = structuredClone(source);
              Object.assign(changed, {
                title,
                purpose,
                borrow,
                avoid,
                referencePurpose: notes,
                status: text.trim() ? 'ready' : changed.status,
              });
              const v = {
                ...version,
                createdAt: timestamp(),
                text,
                userEdited: true,
                paragraphs: paragraphs(text, 'user'),
              };
              v.paragraphs.push(
                ...paragraphs(
                  [
                    borrow && `明确希望借鉴：${borrow}`,
                    avoid && `明确不借鉴：${avoid}`,
                    notes && `参考目的：${notes}`,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                  'user',
                ),
              );
              if (update((current) => sourceChanged(current, changed, v))) setEditing(false);
            }}
          >
            <label>
              来源名称
              <input
                className="field"
                required
                maxLength={200}
                aria-label="修订来源名称"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              用途
              <select
                className="field"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as ExploreSource['purpose'])}
              >
                <option value="main">主要参考</option>
                <option value="supplement">补充说明</option>
                <option value="excluded">反例 / 不需要</option>
                <option value="conflict">冲突待核实</option>
              </select>
            </label>
            <label>
              可编辑文本预览
              <textarea
                className="field"
                aria-label="可编辑文本预览"
                rows={10}
                value={text}
                maxLength={30000}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label>
              借鉴的功能
              <textarea
                className="field"
                value={borrow}
                maxLength={2000}
                onChange={(e) => setBorrow(e.target.value)}
              />
            </label>
            <label>
              不借鉴的部分
              <textarea
                className="field"
                value={avoid}
                maxLength={2000}
                onChange={(e) => setAvoid(e.target.value)}
              />
            </label>
            <label>
              补充说明
              <textarea
                className="field"
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <p className="muted">保存新版本，历史引用保留；依赖旧来源的结论会标为需复核。</p>
            <Button type="submit">保存来源新版本</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
