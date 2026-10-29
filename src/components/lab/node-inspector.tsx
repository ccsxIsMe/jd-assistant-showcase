'use client';
import { useState } from 'react';
import { Modal } from '../workbench/modal';
import {
  nodeTypeNames,
  relationNames,
  requirementTypeNames,
  type GraphNode,
  type GraphEdge,
  relationTypes,
} from '@/lib/lab/model';
import {
  editFindingNode,
  editRequirement,
  editSolution,
  excludeNode,
  nodeImpact,
  pinEvidence,
  deleteRelation,
  restoreRelation,
  verifyRelation,
  editRelationType,
} from '@/lib/lab/operations';
import type { Exploration } from '@/lib/exploration/model';
import { ResearchDecision } from '../decisions/repairable-decision';
import { resolveDecision, decisionAnswer } from '@/lib/decisions/records';
type Props = {
  project: Exploration;
  node: GraphNode;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  onClose: () => void;
  onSource: (id: string) => void;
  onAnnotation: (id: string) => void;
  onAnalyze: (id: string) => void;
  readonly?: boolean;
};
export function NodeInspector({
  project: p,
  node: n,
  update,
  onClose,
  onSource,
  onAnnotation,
  onAnalyze,
  readonly = false,
}: Props) {
  const solution =
    n.type === 'role' ? p.lab!.solutions.find((s) => s.id === n.content.solutionId) : undefined;
  const [title, setTitle] = useState(solution?.title ?? n.title),
    [description, setDescription] = useState(
      solution
        ? solution.description
        : 'description' in n.content
          ? n.content.description
          : n.type === 'question'
            ? n.content.answer
            : n.summary,
    ),
    [type, setType] = useState(n.type === 'requirement' ? n.content.requirementType : 'pending'),
    [confirmDelete, setConfirmDelete] = useState(false);
  const edges = p.lab!.edges.filter(
    (e) => e.status !== 'deleted' && (e.sourceNodeId === n.id || e.targetNodeId === n.id),
  );
  function save() {
    const ok = update((v) => {
      if (n.type === 'feature' || n.type === 'inference')
        return editFindingNode(v, n.content.findingId, { title, description });
      if (n.type === 'requirement')
        return editRequirement(v, n.content.requirementId, {
          title,
          description,
          requirementType: type,
        });
      if (n.type === 'role') return editSolution(v, n.content.solutionId, { title, description });
      return v;
    });
    if (ok) onClose();
  }
  return (
    <Modal title={`${nodeTypeNames[n.type]} · ${n.title}`} onClose={onClose} wide>
      <div className="lab-inspector">
        <p className="callout">
          {n.originType === 'ai_inference'
            ? 'AI推断或建议；用户接受后仍保留推断来源。'
            : n.originType === 'source_fact'
              ? '可定位的原始资料内容。'
              : '用户提供的内容；确认状态单独记录。'}{' '}
          当前状态：{n.status}
        </p>
        {n.type === 'source' ? (
          <>
            <p>{n.content.preview || n.summary}</p>
            <p>{n.content.limitations}</p>
            <button onClick={() => onSource(n.content.sourceId)}>
              查看原始资料、解析文本与版本
            </button>
            {['image', 'video', 'document'].includes(n.content.sourceType) && (
              <button onClick={() => onAnnotation(n.content.sourceId)}>查看或调整区域标注</button>
            )}
          </>
        ) : n.type === 'evidence' ? (
          <>
            <blockquote>{n.content.excerpt}</blockquote>
            <p>
              来源版本：V{n.content.sourceRevision}；定位类型：{n.content.locatorKind}
            </p>
            <button onClick={() => onSource(n.content.sourceId)}>定位原始证据</button>
            {!readonly && (
              <button
                onClick={() =>
                  update((v) => pinEvidence(v, n.content.evidenceId, !n.content.independent))
                }
              >
                {n.content.independent ? '收回资料节点内' : '作为独立证据展开'}
              </button>
            )}
          </>
        ) : n.type === 'question' ? (
          <>
            {(() => {
              const q = resolveDecision(p.questions, n.content.questionId);
              return q ? (
                <>
                  <p>{q.detail}</p>
                  {readonly ? (
                    <p>当前记录：{decisionAnswer(q)}</p>
                  ) : (
                    <ResearchDecision project={p} question={q} update={update} />
                  )}
                </>
              ) : (
                <p>关联决定不存在，请检查引用。</p>
              );
            })()}
          </>
        ) : (
          <>
            <label>
              标题
              <input
                aria-label="节点标题"
                value={title}
                maxLength={200}
                readOnly={readonly}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              完整描述
              <textarea
                aria-label="节点完整描述"
                rows={6}
                value={description}
                maxLength={4000}
                readOnly={readonly}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {n.type === 'requirement' && (
              <label>
                要求类型
                <select
                  aria-label="岗位要求类型"
                  value={type}
                  disabled={readonly}
                  onChange={(e) => setType(e.target.value as typeof type)}
                >
                  {Object.entries(requirementTypeNames).map(([v, k]) => (
                    <option key={v} value={v}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {'rationale' in n.content && <p>理由：{n.content.rationale}</p>}
            {'uncertainty' in n.content && <p>不确定性：{n.content.uncertainty}</p>}
            {!readonly && (
              <div className="explore-inline-actions">
                <button className="lab-primary" onClick={save}>
                  保存节点修改
                </button>
                {(n.type === 'feature' || n.type === 'inference') && (
                  <button
                    onClick={() =>
                      update((v) =>
                        editFindingNode(v, n.content.findingId, { status: 'confirmed' }),
                      )
                    }
                  >
                    确认此项
                  </button>
                )}
                <button onClick={() => onAnalyze(n.id)}>重新分析相关范围</button>
              </div>
            )}
          </>
        )}
        <h3>来源与证据</h3>
        {p.evidence
          .filter((e) => n.evidenceIds.includes(e.evidenceId))
          .map((e) => (
            <button
              className="lab-proof"
              key={e.evidenceId}
              onClick={() => e.sourceId && onSource(e.sourceId)}
            >
              <strong>{e.title}</strong>
              <span>{e.excerpt}</span>
              <small>
                V{e.sourceRevision} · {e.verificationStatus === 'verified' ? '已定位' : '待核对'}
              </small>
            </button>
          ))}
        {!n.evidenceIds.length && <p>没有直接证据；不能把推断视作资料事实。</p>}
        <h3>关联关系（{edges.length}）</h3>
        {edges.map((e) => (
          <p key={e.id}>
            {relationNames[e.relationType]} · {e.rationale} ·{' '}
            {e.status === 'pending' ? '待审核' : e.status}
          </p>
        ))}
        {!readonly && n.type !== 'evidence' && (
          <>
            <button onClick={() => setConfirmDelete(true)}>排除 / 移除这个节点…</button>
            {confirmDelete && (
              <div role="alert" className="callout error">
                <p>
                  影响 {nodeImpact(p, n.id).relations} 条关系、{nodeImpact(p, n.id).requirements}{' '}
                  项要求。来源和历史快照保留；相关内容会需复核，支持撤销。
                </p>
                <button
                  onClick={() => {
                    if (update((v) => excludeNode(v, n.id))) onClose();
                  }}
                >
                  确认排除并保留引用历史
                </button>
                <button onClick={() => setConfirmDelete(false)}>取消</button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
export function EdgeInspector({
  project: p,
  id,
  update,
  onClose,
  onSource,
  readonly = false,
}: {
  project: Exploration;
  id: string;
  update: Props['update'];
  onClose: () => void;
  onSource: Props['onSource'];
  readonly?: boolean;
}) {
  const e = p.lab!.edges.find((e) => e.id === id);
  const [nextType, setNextType] = useState<GraphEdge['relationType']>(
    e?.relationType ?? 'weakly_related',
  );
  if (!e) return null;
  const proofs = (ids: string[]) =>
    p.evidence
      .filter((v) => ids.includes(v.evidenceId))
      .map((v) => (
        <button
          className="lab-proof"
          key={v.evidenceId}
          onClick={() => v.sourceId && onSource(v.sourceId)}
        >
          <strong>{v.title}</strong>
          <span>{v.excerpt}</span>
          <small>来源V{v.sourceRevision}</small>
        </button>
      ));
  return (
    <Modal title={`关系详情 · ${relationNames[e.relationType]}`} onClose={onClose}>
      <div className="form-stack">
        <p>
          {p.lab!.nodes.find((n) => n.id === e.sourceNodeId)?.title} →{' '}
          {p.lab!.nodes.find((n) => n.id === e.targetNodeId)?.title}
        </p>
        <p>依据：{e.rationale}</p>
        <p>不确定性：{e.uncertainty || '请人工核对适用范围。'}</p>
        <p>
          生成来源：{e.generatedBy}；状态：{e.status === 'pending' ? '待审核' : e.status}；
          {e.strengthClass === 'strong'
            ? '直接可定位依据'
            : e.strengthClass === 'conflict'
              ? '冲突待核实'
              : '弱关联或推导'}
        </p>
        {e.relationType === 'conflicts_with' ? (
          <>
            <h3>一方依据</h3>
            {proofs(e.leftEvidenceIds)}
            <h3>另一方依据</h3>
            {proofs(e.rightEvidenceIds)}
          </>
        ) : (
          proofs(e.evidenceRefs)
        )}
        {!readonly && e.status !== 'deleted' && (
          <label>
            调整关系语义
            <select
              aria-label="关系类型修改"
              value={nextType}
              onChange={(event) => setNextType(event.target.value as GraphEdge['relationType'])}
            >
              {relationTypes
                .filter(
                  (type) =>
                    type !== 'conflicts_with' ||
                    (e.leftEvidenceIds.length > 0 && e.rightEvidenceIds.length > 0),
                )
                .map((type) => (
                  <option key={type} value={type}>
                    {relationNames[type]}
                  </option>
                ))}
            </select>
            <button
              disabled={nextType === e.relationType}
              onClick={() => {
                if (update((p) => editRelationType(p, e.id, nextType))) onClose();
              }}
            >
              保存关系类型（可撤销）
            </button>
          </label>
        )}
        {!readonly && (
          <div className="explore-inline-actions">
            <button
              disabled={!e.evidenceRefs.length || e.status === 'deleted'}
              onClick={() => update((p) => verifyRelation(p, e.id))}
            >
              我已核对全部依据
            </button>
            <button
              onClick={() => {
                if (
                  update((p) =>
                    e.status === 'deleted' ? restoreRelation(p, e.id) : deleteRelation(p, e.id),
                  )
                )
                  onClose();
              }}
            >
              {e.status === 'deleted' ? '恢复关系' : '删除此关系（可撤销）'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
