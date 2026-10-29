'use client';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Field } from '../common';
import { Modal } from './modal';
import { CitationEditor } from './citation-editor';
import {
  categoryNames,
  kindNames,
  fields,
  type WorkItem,
  type Workspace,
  type Reference,
  type ItemFields,
} from '@/lib/workbench/model';
export function ItemEditor({
  item,
  w,
  onSave,
  onClose,
}: {
  item: WorkItem;
  w: Workspace;
  onSave: (
    values: ItemFields,
    taskIds: string[],
    requirementIds: string[],
    confirm: boolean,
    refs: Reference[],
  ) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(fields(item));
  const [taskIds, setTaskIds] = useState(item.taskIds);
  const [requirementIds, setRequirementIds] = useState(item.requirementIds);
  const [confirm, setConfirm] = useState(false);
  const [refs, setRefs] = useState(item.refs);
  return (
    <Modal title={`人工编辑${kindNames[item.kind]}`} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(values, taskIds, requirementIds, confirm, refs);
        }}
      >
        <p className="callout subtle">
          人工编辑不会自动代表负责人审批。
          {item.locked
            ? '当前已锁定；人仍可明确编辑，AI不得修改。'
            : '已确认内容实质修改后会转为需复核。'}
        </p>
        <Field label="名称 / 标题" id="item-title">
          <Input
            id="item-title"
            required
            maxLength={300}
            value={values.title}
            onChange={(e) => setValues({ ...values, title: e.target.value })}
          />
        </Field>
        <Field
          label={item.kind === 'block' ? '段落正文（Markdown）' : '具体工作 / 条件与交付'}
          id="item-text"
        >
          <Textarea
            id="item-text"
            maxLength={10000}
            rows={8}
            value={values.text}
            onChange={(e) => setValues({ ...values, text: e.target.value })}
          />
        </Field>
        {item.kind !== 'block' && (
          <Field label="职责范围 / 适用情境" id="item-scope">
            <Textarea
              id="item-scope"
              maxLength={2000}
              rows={3}
              value={values.scope}
              onChange={(e) => setValues({ ...values, scope: e.target.value })}
            />
          </Field>
        )}
        {item.kind === 'requirement' && (
          <Field label="条件分类" id="item-category">
            <select
              id="item-category"
              className="field"
              value={values.category}
              onChange={(e) =>
                setValues({ ...values, category: e.target.value as WorkItem['category'] })
              }
            >
              {Object.entries(categoryNames).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {item.kind === 'task' && (
          <Field label="优先级" id="item-priority">
            <select
              id="item-priority"
              className="field"
              value={values.priority}
              onChange={(e) =>
                setValues({ ...values, priority: e.target.value as WorkItem['priority'] })
              }
            >
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </Field>
        )}
        {item.kind !== 'task' && (
          <fieldset className="check-list">
            <legend>关联任务</legend>
            {w.items
              .filter((i) => i.kind === 'task')
              .map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={taskIds.includes(t.id)}
                    onChange={(e) =>
                      setTaskIds(
                        e.target.checked ? [...taskIds, t.id] : taskIds.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.title}
                  {t.status === 'excluded' ? '（已排除）' : ''}
                </label>
              ))}
          </fieldset>
        )}
        {item.kind === 'block' && (
          <fieldset className="check-list">
            <legend>关联岗位要求</legend>
            {w.items
              .filter((i) => i.kind === 'requirement')
              .map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={requirementIds.includes(r.id)}
                    onChange={(e) =>
                      setRequirementIds(
                        e.target.checked
                          ? [...requirementIds, r.id]
                          : requirementIds.filter((id) => id !== r.id),
                      )
                    }
                  />
                  {r.title}
                </label>
              ))}
          </fieldset>
        )}
        <CitationEditor w={w} refs={refs} onChange={setRefs} />
        <label className="checkbox-row">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          本次明确“修改并确认”该内容
        </label>
        <div className="modal-footer">
          <Button variant="outline" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit">{confirm ? '修改并确认' : '保存为待复核内容'}</Button>
        </div>
      </form>
    </Modal>
  );
}
