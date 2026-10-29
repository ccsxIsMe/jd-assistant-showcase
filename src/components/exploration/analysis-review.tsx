'use client';
import { useState } from 'react';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
import { basisNames, type AnalysisRun, type Exploration } from '@/lib/exploration/model';
import { semanticSignature } from '@/lib/exploration/domain';
export function AnalysisReview({
  project: p,
  run,
  onApply,
  onClose,
  jumpEvidence,
}: {
  project: Exploration;
  run: AnalysisRun;
  onApply: (keys: string[], overview: boolean) => void;
  onClose: () => void;
  jumpEvidence: (id: string) => void;
}) {
  const [keys, setKeys] = useState(
    run.output.findings
      .filter((f) => !p.findings.some((old) => old.title === f.title && old.kind === f.kind))
      .map((f) => f.key),
  );
  const [overview, setOverview] = useState(!p.overviewConfirmed && !p.overview.goal.trim());
  const stale = semanticSignature(p) !== run.baseSignature;
  return (
    <Modal title="审阅产品分析草案" onClose={onClose} wide>
      <p className="callout">
        {p.mode === 'example' ? '演示数据，非真实AI分析。' : '真实模型草案。'}
        采纳后仍为待确认；已有人工编辑默认不替换。
      </p>
      {stale && (
        <p className="callout error" role="alert">
          分析期间资料或人工编辑发生变化，本次草案已过期；请重新分析，已有编辑保留。
        </p>
      )}
      <label className="explore-checkbox">
        <input type="checkbox" checked={overview} onChange={(e) => setOverview(e.target.checked)} />
        采用本次产品概览（现有内容会进入待确认）
      </label>
      <blockquote>{run.output.overview.goal || '模型未提供目标'}</blockquote>
      <div className="analysis-review-cards">
        {run.output.findings.map((f) => {
          const old = p.findings.find((old) => old.title === f.title && old.kind === f.kind);
          return (
            <article key={f.key}>
              <label className="explore-checkbox">
                <input
                  type="checkbox"
                  disabled={old?.locked}
                  checked={keys.includes(f.key)}
                  onChange={(e) =>
                    setKeys(
                      e.target.checked ? [...keys, f.key] : keys.filter((key) => key !== f.key),
                    )
                  }
                />
                <strong>{f.title}</strong>
              </label>
              <small>
                {basisNames[f.basis]} ·{' '}
                {old
                  ? old.locked
                    ? '原结论已锁定，禁止更新'
                    : '同名已有内容，需明确选择替换'
                  : '新增候选'}
              </small>
              {old && (
                <div className="analysis-before">
                  <b>修改前：</b>
                  <p>{old.description}</p>
                </div>
              )}
              <div className="analysis-after">
                <b>{old ? '建议修改后：' : '候选内容：'}</b>
                <p>{f.description}</p>
                <p>{f.behavior}</p>
                <p>{f.outcome}</p>
              </div>
              <div className="finding-evidence-links">
                {f.evidenceIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      jumpEvidence(id);
                      onClose();
                    }}
                  >
                    定位证据
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <p>
        {run.output.questions.length} 个待确认问题 · {run.output.notice}
      </p>
      <div className="modal-actions">
        <Button variant="outline" onClick={onClose}>
          保留草案，稍后审阅
        </Button>
        <Button
          disabled={stale || run.applied || (!keys.length && !overview)}
          onClick={() => onApply(keys, overview)}
        >
          采纳所选，进入人工确认
        </Button>
      </div>
    </Modal>
  );
}
