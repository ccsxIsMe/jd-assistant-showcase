'use client';
import { useState } from 'react';
import { Quote, ArrowUpRight, MessageCircleQuestion, ChevronDown } from 'lucide-react';
import { groupedEvidence, orderedQuestions } from '@/lib/lab/guided';
import { questionEvidence, answerQuestion } from '@/lib/lab/operations';
import { DecisionReferences } from '../decisions/decision-references';
import { ResearchDecision } from '../decisions/repairable-decision';
import { evidenceValid } from '@/lib/exploration/domain';
import { SourceThumbnail } from './board-node';
import { Modal } from '../workbench/modal';
import type { GuidedActions } from './guided-types';
export function GuidedQuestions(
  a: Pick<GuidedActions, 'project' | 'update' | 'readonly' | 'onEdit' | 'onFocus'> & {
    active?: boolean;
  },
) {
  const rows = orderedQuestions(a.project);
  return (
    <div className="guided-questions">
      {rows.slice(0, 3).map((q) => (
        <Question key={q.id} question={q} {...a} />
      ))}
      {rows.length > 3 && (
        <details>
          <summary>其他{rows.length - 3}个问题 · 按影响排序</summary>
          {rows.slice(3).map((q) => (
            <Question key={q.id} question={q} {...a} />
          ))}
        </details>
      )}
      {!rows.length && (
        <p className="guided-muted">暂无问题记录。信息不足仍应保留为未知，不代表没有风险。</p>
      )}
    </div>
  );
}
function Question({
  question: q,
  ...a
}: { question: ReturnType<typeof orderedQuestions>[number] } & Pick<
  GuidedActions,
  'project' | 'update' | 'readonly' | 'onEdit' | 'onFocus'
> & { active?: boolean }) {
  return (
    <article className="guided-question" data-testid="guided-question">
      <div className="guided-inline">
        <span className={`guided-priority ${q.priority.level}`}>{q.priority.label}</span>
        <span className="guided-badge">
          {{ open: '待回答', answered: '已回答', deferred: '已暂缓', excluded: '已排除' }[q.status]}
        </span>
      </div>
      <h3>{q.title}</h3>
      <p>{q.priority.reason}</p>
      {!a.readonly && (
        <ResearchDecision
          project={a.project}
          question={q}
          update={a.update}
          active={a.active !== false}
        />
      )}
      <details>
        <summary>依据与处理说明</summary>
        <p>{q.detail}</p>
        <button onClick={() => a.onFocus(`question:${q.id}`)}>查看关联对象</button>
        {q.answer && <blockquote>{q.answer}</blockquote>}
        {!a.readonly && a.active !== false && q.answer && (
          <button onClick={() => a.update((p) => answerQuestion(p, q.id, q.answer, 'excluded'))}>
            排除此问题并保留已有说明
          </button>
        )}
      </details>
    </article>
  );
}
export function GuidedEvidence(a: GuidedActions) {
  const [all, setAll] = useState(false),
    [ask, setAsk] = useState<string | null>(null),
    [question, setQuestion] = useState('');
  const p = a.project,
    groups = groupedEvidence(p),
    conflicts = p.lab!.edges.filter(
      (e) => e.relationType === 'conflicts_with' && e.status !== 'deleted',
    );
  return (
    <div>
      <div className="guided-section-heading">
        <div>
          <h2>先看最值得核对的证据</h2>
          <p>同文片段合并展示，独立来源仍完整保留。原文、用户决定和AI推断分开管理。</p>
        </div>
        <span className="guided-badge">{groups.length}组证据</span>
      </div>
      <div className="guided-evidence-grid">
        {groups.slice(0, all ? groups.length : 4).map((group) => {
          const e = group.items[0],
            source = p.sources.find((s) => s.id === e.sourceId);
          return (
            <article className="guided-evidence-card" key={group.id} data-testid="guided-evidence">
              <div className="guided-inline">
                <Quote size={17} />
                <span className="guided-badge">
                  {e.evidenceType === 'user-description' ? '用户提供的说明' : '原始资料内容'}
                </span>
                <small>{evidenceValid(p, e) ? '可定位原文' : '待人工核对'}</small>
              </div>
              {source && ['image', 'video'].includes(source.kind) && (
                <SourceThumbnail
                  source={source}
                  evidence={group.items}
                  annotations={p.lab!.annotations}
                  onOpen={() => a.onAnnotation(source.id)}
                />
              )}
              <blockquote>
                {group.excerpt.slice(0, 400) || '区域证据：请打开原始资料核对'}
              </blockquote>
              <details>
                <summary>{group.items.length}条独立引用与定位</summary>
                {group.items.map((ref) => (
                  <div key={ref.evidenceId}>
                    <p>
                      {p.sources.find((s) => s.id === ref.sourceId)?.title} · V{ref.sourceRevision}{' '}
                      ·{' '}
                      {ref.location.kind === 'document'
                        ? `第${ref.location.page}页`
                        : ref.location.kind === 'video'
                          ? `${ref.location.time}秒`
                          : ref.location.kind === 'image'
                            ? '图像区域'
                            : ref.location.kind === 'text'
                              ? `原文位置${ref.location.start}–${ref.location.end}`
                              : '待定位'}
                    </p>
                    <button
                      onClick={() => ref.sourceId && a.onSource(ref.sourceId, ref.evidenceId)}
                    >
                      定位此引用 ↗
                    </button>
                  </div>
                ))}
              </details>
              <div className="guided-inline">
                <button
                  data-tour="lab-evidence"
                  onClick={() => e.sourceId && a.onSource(e.sourceId, e.evidenceId)}
                >
                  <ArrowUpRight size={14} />
                  查看来源
                </button>
                {!a.readonly && (
                  <button
                    onClick={() => {
                      setAsk(e.evidenceId);
                      setQuestion('');
                    }}
                  >
                    <MessageCircleQuestion size={14} />
                    对此证据有疑问
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {groups.length > 4 && (
        <button className="guided-more" onClick={() => setAll(!all)}>
          <ChevronDown size={15} />
          {all ? '收起次要证据' : `另外${groups.length - 4}组证据，按需展开`}
        </button>
      )}
      {!groups.length && (
        <p className="guided-empty">
          还没有可定位的文字或区域，请补充正文，或打开图片、PDF页面手动标注。
        </p>
      )}
      {conflicts.length > 0 && (
        <section className="guided-section">
          <h2>重点核对双方材料</h2>
          <p>冲突保留待核实状态也可以继续；后续方案会带着这些条件。</p>
          {conflicts.map((e) => (
            <article key={e.id} className="guided-conflict">
              <strong>{e.rationale}</strong>
              <div className="guided-conflict-sides">
                {[e.leftEvidenceIds, e.rightEvidenceIds].map((ids, i) => (
                  <div key={i}>
                    <small>{i ? '另一方依据' : '一方依据'}</small>
                    {p.evidence
                      .filter((v) => ids.includes(v.evidenceId))
                      .map((v) => (
                        <blockquote key={v.evidenceId}>{v.excerpt}</blockquote>
                      ))}
                  </div>
                ))}
              </div>
              <button onClick={() => a.onEdge(e.id)}>核对、修改或排除这条冲突</button>
            </article>
          ))}
        </section>
      )}
      <DecisionReferences project={p} onAnswer={a.onAnswer} readonly={a.readonly} />
      {ask && (
        <Modal title="针对这项证据提出问题" onClose={() => setAsk(null)}>
          <label>
            需要核实什么？
            <textarea
              aria-label="证据疑问"
              value={question}
              rows={4}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <button
            className="lab-primary"
            disabled={!question.trim()}
            onClick={() => {
              if (a.update((p) => questionEvidence(p, ask, question))) setAsk(null);
            }}
          >
            保存为关联待确认问题
          </button>
        </Modal>
      )}
    </div>
  );
}
