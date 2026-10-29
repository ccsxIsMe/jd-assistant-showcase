'use client';
import { useState } from 'react';
import type { Exploration } from '@/lib/exploration/model';
import { acceptImageTranscription } from '@/lib/lab/operations';
export function RecognizedTextEvidence({
  project,
  resultId,
  update,
  readonly,
}: {
  project: Exploration;
  resultId: string;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  readonly: boolean;
}) {
  const result = project.lab!.visualResults.find((r) => r.id === resultId)!;
  const candidate =
    result.output.text || result.output.regions.map((r) => `${r.label}：${r.excerpt}`).join('\n');
  const [text, setText] = useState(candidate.slice(0, 2000));
  const [error, setError] = useState('');
  const source = project.sources.find((s) => s.id === result.sourceId);
  const current =
    source?.kind === 'image' &&
    !source.removed &&
    source.versions.at(-1)?.revision === result.sourceRevision;
  const saved = project.lab!.annotations.some(
    (a) =>
      a.sourceId === result.sourceId &&
      a.sourceRevision === result.sourceRevision &&
      a.status === 'accepted' &&
      a.label === text.trim(),
  );
  if (!candidate || !current) return null;
  return (
    <section className="recognized-text-evidence">
      <h3>校对识别文字，加入关联分析</h3>
      <p>
        以下是AI候选转写。请对照原图校对后保存为整张图的证据；不声称定位到某一行文字，也不会自动确认功能或岗位要求。
      </p>
      {candidate.length > 2000 && <p>完整候选保留在上方。当前选取前2000字，可精简或分次保存。</p>}
      <label>
        核对后的图片文字或说明
        <textarea
          aria-label="核对后的图片文字或说明"
          rows={5}
          maxLength={2000}
          value={text}
          disabled={readonly}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button
        className="lab-primary"
        disabled={readonly || saved || !text.trim()}
        onClick={() => {
          setError('');
          try {
            update((p) => acceptImageTranscription(p, resultId, text));
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存失败，文字保留。');
          }
        }}
      >
        {saved ? '已保存为证据' : '已核对，保存整图文字证据'}
      </button>
      {saved && (
        <p role="status">
          文字证据已就绪。关闭此窗口，再点击关联分析；关系仍需依据和校验，不会自动补线。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
