'use client';
/* eslint-disable @next/next/no-img-element -- Original local Blob thumbnails, never remote images */
import { memo } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import {
  FileText,
  Image as ImageIcon,
  Video,
  Globe,
  Quote,
  Layers,
  Lightbulb,
  MessageCircleQuestion,
  BriefcaseBusiness,
  ListChecks,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { useAssetURL } from '@/hooks/use-exploration';
import { nodeTypeNames, type GraphNode, type Annotation } from '@/lib/lab/model';
import { sourceKindNames, type Evidence, type ExploreSource } from '@/lib/exploration/model';
import { sourceParseNotice } from '@/lib/exploration/media-capabilities';
export type BoardNodeData = Record<string, unknown> & {
  node: GraphNode;
  source?: ExploreSource;
  evidence: Evidence[];
  annotations: Annotation[];
  dimmed: boolean;
  onOpen: (id: string) => void;
  onCollapse: (id: string) => void;
  onEvidence: (id: string) => void;
  onPin: (id: string) => void;
};
export type FlowBoardNode = Node<BoardNodeData, 'investigation'>;
const statusNames: Record<string, string> = {
  pending: '待审核',
  confirmed: '已确认',
  excluded: '已排除',
  review: '需复核',
  stale: '已过期',
  failed: '解析失败',
  parsing: '解析中',
  ready: '解析完成',
  partial: '部分完成',
  verified: '已定位',
  open: '待回答',
  answered: '已回答',
  deferred: '已暂缓',
};
const originNames = {
  source_fact: '原始资料',
  user_confirmed: '用户明确确认',
  ai_inference: 'AI推断',
  user_provided: '用户补充 · 待确认',
};
const icons = {
  source: FileText,
  evidence: Quote,
  feature: Layers,
  inference: Lightbulb,
  question: MessageCircleQuestion,
  role: BriefcaseBusiness,
  requirement: ListChecks,
};
export function SourceThumbnail({
  source,
  evidence,
  annotations,
  onOpen,
}: {
  source: ExploreSource;
  evidence: Evidence[];
  annotations: Annotation[];
  onOpen: () => void;
}) {
  const version = source.versions.at(-1)!;
  const frame = evidence.find((e) => e.location.kind === 'video' && e.location.frameAssetId);
  const frameId = frame?.location.kind === 'video' ? frame.location.frameAssetId : undefined;
  const asset = useAssetURL(
    source.kind === 'image' ? version.assetId : source.kind === 'video' ? frameId : undefined,
  );
  const marks = annotations.filter(
    (a) =>
      a.sourceId === source.id &&
      a.sourceRevision === version.revision &&
      !['deleted', 'stale'].includes(a.status),
  );
  const manual = evidence.filter(
    (e) =>
      e.sourceId === source.id &&
      e.sourceRevision === version.revision &&
      'rect' in e.location &&
      e.location.rect &&
      !marks.some((a) => a.evidenceId === e.evidenceId),
  );
  if (!asset.url)
    return (
      <button className="lab-document-preview nodrag nopan" onClick={onOpen}>
        <span>
          {source.kind === 'video' ? (
            <Video size={26} />
          ) : source.kind === 'image' ? (
            <ImageIcon size={26} />
          ) : source.kind === 'url' ? (
            <Globe size={26} />
          ) : (
            <FileText size={26} />
          )}
        </span>
        <p>
          {version.text.slice(0, 180) ||
            sourceParseNotice(source) ||
            '原始文件已保存，可打开查看并标注。'}
        </p>
      </button>
    );
  return (
    <button
      className="lab-source-thumbnail nodrag nopan"
      onClick={onOpen}
      aria-label={`打开原始资料${source.title}`}
    >
      <div className="lab-thumbnail-coordinate-space">
        <img src={asset.url} alt={source.title} draggable={false} />
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-label="来源中实际保存的证据标记"
        >
          {marks.map((a) => (
            <rect
              key={a.id}
              x={a.normalizedGeometry.x * 1000}
              y={a.normalizedGeometry.y * 1000}
              width={a.normalizedGeometry.width * 1000}
              height={a.normalizedGeometry.height * 1000}
              className={a.status === 'pending' ? 'pending' : 'accepted'}
            >
              <title>
                {a.status === 'pending' ? '待确认标注：' : '已接受标注：'}
                {a.label}
              </title>
            </rect>
          ))}
          {manual.map((e) => {
            const r = 'rect' in e.location ? e.location.rect : null;
            return r ? (
              <rect
                key={e.evidenceId}
                x={r.x * 1000}
                y={r.y * 1000}
                width={r.width * 1000}
                height={r.height * 1000}
                className={e.verificationStatus === 'verified' ? 'accepted' : 'pending'}
              >
                <title>{e.excerpt}</title>
              </rect>
            ) : null;
          })}
        </svg>
      </div>
      <span>
        {marks.filter((a) => a.status === 'pending').length
          ? `${marks.filter((a) => a.status === 'pending').length}项标注待确认`
          : '查看原件与证据'}
      </span>
    </button>
  );
}
export const BoardNode = memo(function BoardNode({ data, selected }: NodeProps<FlowBoardNode>) {
  const { node: n, source, evidence, annotations } = data;
  const zoom = useStore((s) => s.transform[2]);
  const compact = zoom < 0.4;
  const Icon = icons[n.type];
  const refs = evidence.filter((e) => n.evidenceIds.includes(e.evidenceId));
  return (
    <article
      className={`lab-node lab-node-${n.type} ${selected ? 'selected' : ''} ${data.dimmed ? 'dimmed' : ''} ${compact ? 'compact' : zoom >= 1 ? 'close-view' : 'medium-view'} ${n.status === 'excluded' ? 'excluded' : ''}`}
      data-testid={`lab-node-${n.type}`}
      data-node-id={n.id}
    >
      <Handle type="target" position={Position.Left} id="in" aria-label="关系目标" />
      <header className="lab-node-drag-handle">
        <div>
          <Icon size={15} />
          <span>{nodeTypeNames[n.type]}</span>
          <span className={`lab-status ${n.status}`}>{statusNames[n.status] ?? n.status}</span>
        </div>
        <h3>{n.title}</h3>
      </header>
      <div className="lab-node-content">
        {source && (
          <>
            <div className="lab-node-source-meta">
              <span>{sourceKindNames[source.kind]}</span>
              <span>v{source.versions.at(-1)!.revision}</span>
              <span>{refs.length}条证据</span>
            </div>
            <SourceThumbnail
              source={source}
              evidence={refs}
              annotations={annotations}
              onOpen={() => data.onOpen(n.id)}
            />
          </>
        )}
        {!source && <p>{n.summary}</p>}
        <div className={`lab-origin ${n.originType}`}>
          <span>{originNames[n.originType]}</span>
          {n.acceptedByUser && n.originType === 'ai_inference' && (
            <small>用户已接受该推断，原始属性保留</small>
          )}
        </div>
        {n.type === 'inference' && <p className="lab-uncertainty">{n.content.uncertainty}</p>}
        {n.type === 'requirement' && (
          <small>
            要求类型：
            {
              (
                {
                  must: '必要条件',
                  bonus: '加分项',
                  trainable: '可培养',
                  pending: '尚未确认',
                } as const
              )[n.content.requirementType]
            }
            {n.content.locked ? ' · 已锁定' : ''}
          </small>
        )}
        {!n.collapsed && (
          <div className="lab-inline-evidence-list nodrag nopan">
            {refs.map((e) => (
              <div key={e.evidenceId}>
                <button onClick={() => data.onEvidence(e.evidenceId)}>
                  {e.verificationStatus === 'verified' ? (
                    <Quote size={12} />
                  ) : (
                    <MessageCircleQuestion size={12} />
                  )}
                  <span>{e.excerpt.slice(0, 120) || e.title}</span>
                </button>
                <button aria-label={`独立展开${e.title}`} onClick={() => data.onPin(e.evidenceId)}>
                  独立展开
                </button>
              </div>
            ))}
            {!refs.length && <p>没有直接证据；查看推断与待确认条件。</p>}
          </div>
        )}
      </div>
      <footer className="nodrag nopan">
        <button
          onClick={() => data.onCollapse(n.id)}
          aria-label={`${n.collapsed ? '展开' : '折叠'}${n.title}`}
          aria-expanded={!n.collapsed}
        >
          {n.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}证据与说明 ·{' '}
          {refs.length}
        </button>
        <button onClick={() => data.onOpen(n.id)} aria-label={`查看详情${n.title}`}>
          <ExternalLink size={12} />
          详情
        </button>
      </footer>
      <div className="lab-node-tooltip nodrag nopan" role="tooltip">
        <div>
          <b>
            {nodeTypeNames[n.type]} · {n.title}
          </b>
          <p>{n.summary.slice(0, 250)}</p>
          <small>
            {n.sourceIds.length}份来源 · {n.evidenceIds.length}条证据 ·{' '}
            {statusNames[n.status] ?? n.status}
          </small>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" aria-label="建立关联" />
    </article>
  );
});
