'use client';
import { useRef, useState } from 'react';
import { useAssetURL } from '@/hooks/use-exploration';
import { fullResearch } from '@/lib/exploration/research';
import type { Snapshot } from '@/lib/exploration/model';
import { MediaAnnotator } from './media-annotator';
import { PDFEvidence } from './pdf-evidence';
import { EvidenceViewport } from './evidence-viewport';
export function ArchivedEvidence({
  snapshot,
  evidenceId,
  sourceId,
}: {
  snapshot: Snapshot;
  evidenceId?: string;
  sourceId?: string;
}) {
  const research = fullResearch(snapshot);
  const evidence = research.evidence.find((e) => e.evidenceId === evidenceId);
  const source = research.sources.find((s) => s.id === (evidence?.sourceId ?? sourceId));
  const version = evidence
    ? source?.versions.find((v) => v.revision === evidence.sourceRevision)
    : source?.versions.at(-1);
  const asset = useAssetURL(version?.assetId);
  const location = evidence?.location;
  const frame = useAssetURL(location?.kind === 'video' ? location.frameAssetId : undefined);
  const video = useRef<HTMLVideoElement>(null);
  const [pageOverride, setPageOverride] = useState<{ key: string; page: number } | null>(null);
  if (!source || !version)
    return (
      <p className="callout warning">
        尚未选择原始来源，或保存时缺少该版本。不会用当前新版本冒充历史证据。
      </p>
    );
  const verified = evidence?.verificationStatus === 'verified';
  const rect = verified && location && 'rect' in location ? location.rect : null;
  const positionKey = `${source.id}:${evidenceId ?? ''}`;
  const originalPage =
    location?.kind === 'document' || (location?.kind === 'text' && location.page)
      ? (location.page ?? 1)
      : 1;
  const page = pageOverride?.key === positionKey ? pageOverride.page : originalPage;
  const link = version.normalizedUrl ?? version.originalUrl;
  return (
    <div className="archived-evidence">
      <h3>
        {source.title} · 来源v{version.revision}
      </h3>
      <p>
        {version.fetchedAt
          ? `实际获取：${new Date(version.fetchedAt).toLocaleString('zh-CN')}`
          : `原始文件 / 用户输入：${version.createdAt}`}
      </p>
      {link && /^https?:\/\//i.test(link) && (
        <a href={link} target="_blank" rel="noreferrer">
          打开原始网页 ↗
        </a>
      )}
      {evidence && (
        <p className={`callout ${verified ? '' : 'warning'}`}>
          {evidence.title} ·{' '}
          {verified ? '已按保存的来源版本定位' : '未定位 / 待核实，不显示未验证框'}
        </p>
      )}
      {source.error && <p className="callout warning">保存时解析反馈：{source.error}</p>}
      {asset.error && <p role="alert">{asset.error}</p>}
      {source.kind === 'image' && asset.url && (
        <MediaAnnotator
          url={asset.url}
          title={source.title}
          marks={evidence ? [{ id: evidence.evidenceId, rect, label: evidence.excerpt }] : []}
          selectedId={evidence?.evidenceId}
          disabled
          onCreate={() => {}}
        />
      )}
      {version.mime === 'application/pdf' && asset.url && (
        <PDFEvidence
          url={asset.url}
          page={page}
          pageCount={version.pageCount ?? 1}
          onPage={(value) => setPageOverride({ key: positionKey, page: value })}
          onAnnotate={() => {}}
          onUpdate={() => {}}
          marks={
            evidence && location?.kind === 'document' && page === originalPage
              ? [{ id: evidence.evidenceId, rect, label: evidence.excerpt }]
              : []
          }
          selectedId={evidence?.evidenceId}
          readonly
        />
      )}
      {source.kind === 'video' && asset.url && (
        <>
          <EvidenceViewport>
            <video
              ref={video}
              controls
              src={asset.url}
              onLoadedMetadata={() => {
                if (video.current && location?.kind === 'video')
                  video.current.currentTime = location.time;
              }}
            />
          </EvidenceViewport>
          {location?.kind === 'video' && <p>保存的时间点：{location.time.toFixed(2)}秒</p>}
          {frame.url && (
            <MediaAnnotator
              url={frame.url}
              title="实际保存的视频关键帧"
              marks={evidence ? [{ id: evidence.evidenceId, rect, label: evidence.excerpt }] : []}
              selectedId={evidence?.evidenceId}
              disabled
              onCreate={() => {}}
            />
          )}
        </>
      )}
      {version.paragraphs.map((p) => {
        const match =
          location?.kind === 'text' &&
          location.paragraphId === p.id &&
          p.text.slice(location.start, location.end) === evidence?.excerpt;
        return (
          <div key={p.id} className={`evidence-paragraph ${match ? 'highlighted' : ''}`}>
            <small>
              {p.page ? `第${p.page}页 · ` : ''}
              {p.origin === 'user' ? '用户提供文字' : '保存的解析原文'}
            </small>
            <p>
              {match && location?.kind === 'text' ? (
                <>
                  {p.text.slice(0, location.start)}
                  <mark>{p.text.slice(location.start, location.end)}</mark>
                  {p.text.slice(location.end)}
                </>
              ) : (
                p.text
              )}
            </p>
          </div>
        );
      })}
      {evidence && location?.kind !== 'text' && (
        <blockquote>{evidence.excerpt || '没有保存文字说明。'}</blockquote>
      )}
    </div>
  );
}
