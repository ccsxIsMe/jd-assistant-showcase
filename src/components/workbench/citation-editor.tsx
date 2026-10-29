'use client';
import { useState } from 'react';
import { validateReference } from '@/lib/workbench/domain';
import { localRef } from '@/lib/workbench/ai-contract';
import type { Reference, Workspace } from '@/lib/workbench/model';
import { Textarea } from '../ui/textarea';
export function CitationEditor({
  w,
  refs,
  onChange,
}: {
  w: Workspace;
  refs: Reference[];
  onChange: (r: Reference[]) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [error, setError] = useState('');
  const source = w.sources.find((s) => s.id === sourceId);
  return (
    <fieldset className="check-list">
      <legend>资料依据（可选，可验证原文片段）</legend>
      {refs.map((r, index) => (
        <div key={index} className="citation-edit-row">
          <span>
            {w.sources.find((s) => s.id === r.sourceId)?.title ?? '资料缺失'} · v{r.sourceRevision}
            <small>{r.excerpt}</small>
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(refs.filter((_, i) => i !== index))}
          >
            移除引用
          </button>
        </div>
      ))}
      <select
        aria-label="关联资料"
        className="field"
        value={sourceId}
        onChange={(e) => {
          setSourceId(e.target.value);
          setError('');
        }}
      >
        <option value="">选择资料来源</option>
        {w.sources
          .filter((s) => !s.removed)
          .map((s) => (
            <option value={s.id} key={s.id}>
              {s.title} · v{s.versions.at(-1)!.revision}
            </option>
          ))}
      </select>
      {source && (
        <>
          <p className="citation-original">{source.versions.at(-1)!.text}</p>
          <Textarea
            aria-label="引用原文片段"
            maxLength={3000}
            rows={3}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="复制上方原文中的准确片段"
          />
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (!excerpt.trim()) return;
              const ref = validateReference(
                w.sources,
                localRef(source.id, source.versions.at(-1)!.revision, excerpt),
              );
              if (!ref.verified) {
                setError('该片段不在此版本原文中，请逐字复制。');
                return;
              }
              onChange([...refs, ref]);
              setExcerpt('');
              setError('');
            }}
          >
            添加可验证引用
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="callout error tiny">
          {error}
        </p>
      )}
    </fieldset>
  );
}
