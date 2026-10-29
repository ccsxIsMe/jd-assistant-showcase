'use client';
import { useState } from 'react';
import type { Workspace } from '@/lib/workbench/model';
import { Modal } from './modal';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
export function JDUpdateDialog({
  w,
  onClose,
  onSubmit,
}: {
  w: Workspace;
  onClose: () => void;
  onSubmit: (targetId: string, intent: string) => void;
}) {
  const blocks = w.items.filter((i) => i.kind === 'block' && i.status !== 'excluded');
  const [targetId, setTargetId] = useState(
    blocks.find((i) => i.id === w.ui.selectedId && !i.locked)?.id ??
      blocks.find((i) => i.status === 'review' && !i.locked)?.id ??
      blocks.find((i) => !i.locked)?.id ??
      '',
  );
  const [intent, setIntent] = useState(
    '根据最新已确认的任务与岗位要求，检查并更新选中JD段落，保留人工编辑和原有表达。只提出该段落的差异，不修改其他对象；未确认信息保留待补充或省略。',
  );
  const confirmed = w.items.filter(
    (i) => i.kind !== 'block' && i.status === 'confirmed' && i.category !== 'omit',
  ).length;
  return (
    <Modal title="更新 JD · 先审阅再应用" onClose={onClose}>
      <p className="jd-update-explanation">
        已有正文已保留。每次只更新你选择的一个段落，生成前后差异；你可以应用、拒绝或撤销。锁定段落不能修改。
      </p>
      <label className="form-label" htmlFor="jd-update-target">
        选择要更新的段落
      </label>
      <select
        id="jd-update-target"
        className="field"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      >
        {!targetId && <option value="">没有可更新的未锁定段落</option>}
        {blocks.map((i) => (
          <option key={i.id} value={i.id} disabled={i.locked}>
            {i.title}
            {i.locked ? '（已锁定）' : i.status === 'review' ? '（需复核）' : ''}
          </option>
        ))}
      </select>
      <p className="muted tiny">
        当前有 {confirmed} 项已确认任务 / 要求。尚未确认的内容不会作为既定岗位条件。
      </p>
      <label className="form-label" htmlFor="jd-update-intent">
        本次更新要求
      </label>
      <Textarea
        id="jd-update-intent"
        rows={5}
        value={intent}
        maxLength={4000}
        onChange={(e) => setIntent(e.target.value)}
      />
      <p className="muted tiny">
        {w.mode === 'real'
          ? '点击后会将相关岗位资料发送至 DeepSeek。'
          : '示例演示：按已确认内容生成预置更新建议，非真实 AI 分析。'}
      </p>
      <div className="modal-actions">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button disabled={!targetId || !intent.trim()} onClick={() => onSubmit(targetId, intent)}>
          生成更新建议
        </Button>
      </div>
    </Modal>
  );
}
