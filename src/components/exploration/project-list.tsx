'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowRight, Compass, RotateCcw, Trash2 } from 'lucide-react';
import type { Exploration } from '@/lib/exploration/model';
import { explorationStore } from '@/lib/exploration/storage';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';

export function ExplorationProjectList({
  rows,
  loaded,
  laboratory,
  onChange,
  onError,
}: {
  rows: Exploration[];
  loaded: boolean;
  laboratory: boolean;
  onChange: (project: Exploration) => void;
  onError: (message: string) => void;
}) {
  const [trash, setTrash] = useState(false),
    [deleting, setDeleting] = useState<Exploration | null>(null),
    [undo, setUndo] = useState<Exploration | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState('');
  const gate = useRef(false);
  const active = rows.filter((p) => !p.trashedAt),
    removed = rows.filter((p) => p.trashedAt),
    shown = trash ? removed : active;
  async function change(project: Exploration, remove: boolean) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    onError('');
    setLocalError('');
    try {
      const saved = await explorationStore.setTrashed(project.id, project.revision, remove);
      onChange(saved);
      setDeleting(null);
      setUndo(remove ? saved : null);
      setNotice(
        remove
          ? `“${project.title}”已移至回收站，资料和快照完整保留。`
          : `“${project.title}”已恢复到我的探索。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，原探索保留。';
      onError(message);
      setLocalError(message);
      const current = await explorationStore.get(project.id).catch(() => null);
      if (current) {
        onChange(current);
        if (deleting) setDeleting(current);
      }
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="explore-project-tabs" role="group" aria-label="探索列表范围">
        <button aria-pressed={!trash} onClick={() => setTrash(false)}>
          我的探索（{active.length}）
        </button>
        <button aria-pressed={trash} onClick={() => setTrash(true)}>
          <Trash2 size={15} />
          回收站（{removed.length}）
        </button>
      </div>
      {notice && (
        <div className="explore-project-notice" role="status">
          <span>{notice}</span>
          {undo && (
            <button disabled={busy} onClick={() => void change(undo, false)}>
              <RotateCcw size={14} />
              撤销删除
            </button>
          )}
        </div>
      )}
      {trash && (
        <p className="explore-trash-note">
          这里保留已删除探索的完整资料、快照和附件。恢复不会改写已导入的岗位；当前不提供永久清除。
        </p>
      )}
      <div className="explore-projects">
        {!loaded ? (
          <p role="status">正在读取本机探索…</p>
        ) : (
          shown.map((project) => {
            const content = (
              <>
                <Compass />
                <h3>{project.title}</h3>
                <p>
                  {project.sources.filter((s) => !s.removed).length} 份来源 ·{' '}
                  {project.findings.filter((f) => f.status === 'confirmed').length} 项已确认 ·{' '}
                  {project.snapshots.length} 个快照
                </p>
                <small>{new Date(project.updatedAt).toLocaleString('zh-CN')}</small>
                {!trash && <ArrowRight size={18} />}
              </>
            );
            return (
              <article
                className="explore-project-card"
                key={project.id}
                data-testid="exploration-project-card"
              >
                {trash ? (
                  <div className="explore-project-content">{content}</div>
                ) : (
                  <Link href={`/${laboratory ? 'lab' : 'explore'}/${project.id}`}>{content}</Link>
                )}
                <footer>
                  {trash ? (
                    <button
                      disabled={busy}
                      aria-label={`恢复探索：${project.title}`}
                      onClick={() => void change(project, false)}
                    >
                      <RotateCcw size={15} />
                      恢复探索
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      className="project-delete-button"
                      aria-label={`删除探索：${project.title}`}
                      onClick={() => {
                        setDeleting(project);
                        onError('');
                        setLocalError('');
                      }}
                    >
                      <Trash2 size={15} />
                      删除
                    </button>
                  )}
                </footer>
              </article>
            );
          })
        )}
      </div>
      {loaded && !shown.length && (
        <p className="explore-trash-note">
          {trash ? '回收站为空。' : '暂无匹配的探索；可新建探索，或查看回收站。'}
        </p>
      )}
      {deleting && (
        <Modal
          title="删除这个探索？"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          {localError && (
            <p role="alert" className="callout error">
              {localError}
            </p>
          )}
          <p>
            将“{deleting.title}”移至回收站，包含 {deleting.sources.filter((s) => !s.removed).length}{' '}
            份来源和 {deleting.snapshots.length}{' '}
            个快照。可随时恢复，不永久清除附件，也不删除或改写已经导入的岗位内容。
          </p>
          <div className="modal-actions">
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void change(deleting, true)}>
              {busy ? '正在保存…' : '确认删除探索'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
