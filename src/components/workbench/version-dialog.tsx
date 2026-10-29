'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Download, Copy, Printer, History, Check, Undo2 } from 'lucide-react';
import { Modal } from './modal';
import { TextDiff } from './diff';
import { Button } from '../ui/button';
import {
  confirmationIssues,
  jdBody,
  restoreVersion,
  saveVersion,
  undoOperation,
} from '@/lib/workbench/domain';
import type { Workspace } from '@/lib/workbench/model';
export function downloadText(filename: string, text: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PreviewDialog({ w, onClose }: { w: Workspace; onClose: () => void }) {
  const [notice, setNotice] = useState('');
  const [appendix, setAppendix] = useState(false);
  const body = jdBody(w);
  function exportJd(filename: string, text: string, type?: string) {
    downloadText(filename, text, type);
    if (w.items.some((i) => i.kind === 'block' && i.status !== 'excluded' && i.text.trim()))
      window.dispatchEvent(new Event('jd-document-exported'));
  }
  const content =
    body +
    (appendix
      ? '\n\n---\n\n## 依据附录（内部参考）\n\n' +
        w.sources
          .filter((s) => !s.removed)
          .map((s) => `- ${s.title} · v${s.versions.at(-1)?.revision} · ${s.person}`)
          .join('\n')
      : '');
  return (
    <Modal title="JD预览与导出" onClose={onClose} wide>
      <div className="preview-controls">
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(body).then(
              () => setNotice('JD正文已复制'),
              () => setNotice('复制失败，请手动选择正文'),
            );
          }}
        >
          <Copy size={14} />
          复制JD正文
        </Button>
        <Button variant="outline" onClick={() => exportJd(`${w.title}.md`, content)}>
          <Download size={14} />
          下载Markdown
        </Button>
        <Button
          variant="outline"
          onClick={() => exportJd(`${w.title}.txt`, content, 'text/plain;charset=utf-8')}
        >
          导出纯文本
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer size={14} />
          打印 / 存为PDF
        </Button>
        <label>
          <input
            type="checkbox"
            checked={appendix}
            onChange={(e) => setAppendix(e.target.checked)}
          />
          附依据摘要
        </label>
      </div>
      <p className="callout subtle no-print">
        正式正文不含来源ID或内部讨论。当前
        {confirmationIssues(w).length
          ? '仍为草稿，未确认段落会保留标识。'
          : '内容已确认；确认版本可在版本管理中保存。'}
      </p>
      <div className="print-document markdown">
        <ReactMarkdown skipHtml>{content}</ReactMarkdown>
      </div>
      <p role="status">{notice}</p>
    </Modal>
  );
}
export function VersionsDialog({
  w,
  update,
  onClose,
}: {
  w: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(w.versions[0]?.id ?? '');
  const [view, setView] = useState<'versions' | 'operations'>('versions');
  const v = w.versions.find((v) => v.id === selected);
  const issues = confirmationIssues(w);
  return (
    <Modal title="版本与修改记录" onClose={onClose} wide>
      <div className="versions-actions">
        <div>
          <Button
            onClick={() => update((c) => saveVersion(c, 'confirmed'))}
            disabled={issues.length > 0}
          >
            <Check size={14} />
            保存确认版本
          </Button>
          <Button variant="outline" onClick={() => update((c) => saveVersion(c, 'draft'))}>
            保存草稿快照
          </Button>
        </div>
        <div className="segmented">
          <button
            className={view === 'versions' ? 'active' : ''}
            onClick={() => setView('versions')}
          >
            版本比较
          </button>
          <button
            className={view === 'operations' ? 'active' : ''}
            onClick={() => setView('operations')}
          >
            修改记录
          </button>
        </div>
      </div>
      {issues.length > 0 && (
        <details className="version-issues">
          <summary>正式确认前还需处理 {issues.length} 项</summary>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
          <p>不必要的条件可明确排除，不能靠忽略提示确认未知事实。</p>
        </details>
      )}
      {view === 'versions' ? (
        <div className="version-layout">
          <div className="version-list">
            {w.versions.map((v) => (
              <button
                className={selected === v.id ? 'selected' : ''}
                key={v.id}
                onClick={() => setSelected(v.id)}
              >
                <History size={15} />
                <span>
                  <strong>{v.title}</strong>
                  <small>{new Date(v.createdAt).toLocaleString('zh-CN')}</small>
                </span>
              </button>
            ))}
            {!w.versions.length && (
              <div className="compact-empty">还没有快照。保存后可回看、比较及恢复到新草稿。</div>
            )}
          </div>
          <div className="version-comparison">
            {v ? (
              <>
                <div className="version-comparison-heading">
                  <h3>{v.title} ↔ 当前草稿</h3>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (
                        window.confirm('将此历史版本恢复到新草稿？历史快照保留，当前资料也保留。')
                      )
                        update((c) => restoreVersion(c, v.id));
                    }}
                  >
                    恢复到新草稿
                  </button>
                </div>
                <TextDiff
                  before={v.items
                    .filter((i) => i.kind === 'block' && i.status !== 'excluded')
                    .map((i) => `${i.title}\n${i.text}`)
                    .join('\n\n')}
                  after={w.items
                    .filter((i) => i.kind === 'block' && i.status !== 'excluded')
                    .map((i) => `${i.title}\n${i.text}`)
                    .join('\n\n')}
                />
                <div className="version-snapshot markdown">
                  <ReactMarkdown skipHtml>
                    {jdBody({
                      ...w,
                      items: v.items,
                      sources: v.sources,
                      questions: v.questions,
                      mode: v.mode,
                    })}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <p className="compact-empty">选择左侧版本，查看当时正文与当前草稿差异。</p>
            )}
          </div>
        </div>
      ) : (
        <div className="operations-list">
          {w.operations.map((op) => (
            <article key={op.id}>
              <div>
                <strong>{op.label}</strong>
                <span>{op.undone ? '已撤销' : new Date(op.createdAt).toLocaleString('zh-CN')}</span>
                {op.suggestionId && (
                  <button
                    className="text-button"
                    disabled={op.undone}
                    onClick={() => update((c) => undoOperation(c, op.id))}
                  >
                    <Undo2 size={13} />
                    撤销本次AI应用
                  </button>
                )}
              </div>
              {op.before.map((before) => (
                <details key={before.id}>
                  <summary>{before.title}</summary>
                  <TextDiff
                    before={before.text}
                    after={op.after.find((i) => i.id === before.id)?.text ?? ''}
                  />
                </details>
              ))}
            </article>
          ))}
          <h3>工作区事件</h3>
          {!!w.aiHistory?.length && (
            <details>
              <summary>AI任务执行记录 · {w.aiHistory.length} 次</summary>
              {[...w.aiHistory].reverse().map((record) => (
                <p className="activity-line" key={record.requestId}>
                  <span>{new Date(record.at).toLocaleString('zh-CN')}</span>
                  <span>
                    {record.task} · {record.promptVersion}
                    <br />
                    请求编号 {record.requestId} · 基于岗位版本 {record.baseRevision}
                  </span>
                </p>
              ))}
            </details>
          )}
          {w.activity.map((a) => (
            <p className="activity-line" key={a.id}>
              <span>{new Date(a.at).toLocaleString('zh-CN')}</span>
              {a.text}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}
