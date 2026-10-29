'use client';
/* eslint-disable @next/next/no-img-element -- Local Blob image previews */
import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, Upload, History, ArrowLeft, BookOpen } from 'lucide-react';
import { Modal } from './modal';
import Link from 'next/link';
import { SnapshotImport } from '../exploration/snapshot-import';
import { importRequirementMaterial } from '@/lib/exploration/workbench-import';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Field } from '../common';
import { parseResume } from '@/lib/documents/parse';
import { MAX_FILE } from '@/lib/schemas';
import { now, uid, type Reference, type Source, type Workspace } from '@/lib/workbench/model';
import { log, reviseSource, touch, validateReference } from '@/lib/workbench/domain';
import { clipboardImages, preparePastedImages } from '@/lib/exploration/clipboard';
import { prepareSourceImage, type SourceImage } from '@/lib/workbench/images';
import { explorationStore } from '@/lib/exploration/storage';
import { useAssetURL } from '@/hooks/use-exploration';
export type SourceFocus = { ref: Reference; token: number };
export function SourcePanel({
  w,
  update,
  focus,
  onReferenceDone,
  flush,
}: {
  w: Workspace;
  update: (fn: (w: Workspace) => Workspace) => boolean;
  focus: SourceFocus | null;
  onReferenceDone: () => void;
  flush: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [importSnapshot, setImportSnapshot] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [person, setPerson] = useState('');
  const [type, setType] = useState<Source['type']>('person');
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<{ metadata: SourceImage; file: File; url: string } | null>(
    null,
  );
  const importing = useRef(false);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  const mark = useRef<HTMLElement>(null);
  const focused = focus ? validateReference(w.sources, focus.ref) : null;
  const active = focus?.ref.sourceId ?? selected ?? w.ui.sourceId;
  const source = w.sources.find((s) => s.id === active);
  const sourceRevision = focus
    ? source?.versions.find((v) => v.revision === focus.ref.sourceRevision)
    : (source?.versions.find((v) => v.revision === revision) ?? source?.versions.at(-1));
  const savedImage = useAssetURL(sourceRevision?.image?.assetId);
  useEffect(() => {
    if (focus) {
      const timer = setTimeout(() => {
        mark.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
          block: 'center',
        });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [focus]);
  function openAdd() {
    setImage(null);
    setTitle('');
    setText('');
    setPerson('');
    setType('person');
    setError('');
    setEditing(false);
    setAdding(true);
  }
  async function save() {
    if (saving || importing.current) return;
    if (!text.trim() && !image && !(editing && sourceRevision?.image)) {
      setError('请填写原文，以便后续引用和核对；资料标题可以留空。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (image)
        await explorationStore.saveAsset({
          id: image.metadata.assetId,
          explorationId: `workspace:${w.id}`,
          blob: image.file,
          name: image.metadata.filename,
        });
      const ok = update((current) => {
        if (editing && source) return reviseSource(current, source.id, text.trim());
        const n = structuredClone(current);
        n.sources.push({
          id: uid(),
          title:
            title.trim() ||
            image?.metadata.filename.slice(0, 200) ||
            text.trim().split('\n')[0].slice(0, 48) ||
            '用户提供的资料',
          type,
          person: person.trim() || '本地操作者录入',
          createdAt: now(),
          removed: false,
          versions: [
            {
              revision: 1,
              text: text.trim(),
              createdAt: now(),
              ...(image ? { image: image.metadata } : {}),
            },
          ],
        });
        log(n, `录入资料「${title.trim()}」；未自动成为岗位条件`);
        return touch(n);
      });
      if (ok) {
        setAdding(false);
        setImage(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，图片与文字保留，可重试。');
    } finally {
      setSaving(false);
    }
  }
  async function importFile(file?: File) {
    if (!file || importing.current) return;
    importing.current = true;
    setParsing(true);
    setError('');
    try {
      if (
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|svg|bmp|avif|heic)$/i.test(file.name)
      ) {
        const metadata = await prepareSourceImage(file);
        setImage({ metadata, file, url: URL.createObjectURL(file) });
        if (!title) setTitle(file.name.slice(0, 200));
        setType('file');
        return;
      }
      if (file.size === 0 || file.size > MAX_FILE) throw new Error('文件为空或超过10MB限制');
      const ext = file.name.toLowerCase().split('.').pop();
      let value: string;
      if (['txt', 'md', 'markdown'].includes(ext ?? '')) {
        value = await file.text();
        if (value.includes('\u0000') || value.includes('�'))
          throw new Error('请使用UTF-8文本文件，或直接粘贴文字。');
      } else value = await parseResume(file);
      if (value.length > 30000) throw new Error('文本超过30000字，请精简。');
      setText(value);
      setImage(null);
      if (!title) setTitle(file.name.slice(0, 200));
      setType('file');
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败，请粘贴文本。');
    } finally {
      importing.current = false;
      setParsing(false);
    }
  }
  return (
    <>
      <div className="panel-title">
        <span>
          <BookOpen size={16} />
          资料与来源 <b>{w.sources.filter((s) => !s.removed).length}</b>
        </span>
        <button className="icon-button" aria-label="添加资料" onClick={openAdd}>
          <Plus size={17} />
        </button>
      </div>
      <div className="source-list">
        {w.sources
          .filter((s) => !s.removed)
          .map((s, index) => (
            <button
              key={s.id}
              className={`source-tile ${active === s.id ? 'active' : ''}`}
              title={`${s.title} · ${s.person}`}
              onClick={() => {
                onReferenceDone();
                setSelected(s.id);
                setRevision(null);
              }}
            >
              <span className="source-letter">{String.fromCharCode(65 + index)}</span>
              <span>
                <strong>{s.title}</strong>
                <small>
                  {s.person} · v{s.versions.at(-1)?.revision}
                </small>
              </span>
              <FileText size={14} />
            </button>
          ))}
        {!w.sources.some((s) => !s.removed) && (
          <div className="compact-empty">
            先录入负责人说明、项目材料或旧JD。资料保留原文，不直接成为已确认条件。
          </div>
        )}
      </div>
      {source && sourceRevision ? (
        <section className="source-reader">
          <div className="source-reader-heading">
            <h3>{source.title}</h3>
            <select
              aria-label="查看资料版本"
              value={sourceRevision.revision}
              onChange={(e) => {
                setSelected(source.id);
                onReferenceDone();
                setRevision(Number(e.target.value));
              }}
            >
              {source.versions.map((v) => (
                <option key={v.revision} value={v.revision}>
                  原文 v{v.revision}
                </option>
              ))}
            </select>
          </div>
          <p className="muted tiny">
            {source.person} · {new Date(source.createdAt).toLocaleDateString('zh-CN')}
            {source.removed ? ' · 已移除，历史留存' : ''}
          </p>
          {source.snapshotOrigin && (
            <div className="snapshot-origin-note">
              来自产品探索快照 V{source.snapshotOrigin.version} ·{' '}
              {source.snapshotOrigin.mode === 'example'
                ? '演示数据，非真实AI分析'
                : '真实模式需求整理'}
              <br />
              <Link href={`/explore/snapshots/${source.snapshotOrigin.snapshotId}`}>
                查看需求快照与证据 →
              </Link>
              <br />
              导入会添加来源资料、待讨论任务与能力候选，岗位分工和要求仍需独立确认。
            </div>
          )}
          <div className="source-original" data-testid="source-original">
            {focused?.verified &&
            focused.sourceRevision === sourceRevision.revision &&
            focused.start !== null ? (
              <>
                {sourceRevision.text.slice(0, focused.start)}
                <mark ref={mark} key={focus?.token} className="source-highlight">
                  {sourceRevision.text.slice(focused.start, focused.start + focused.excerpt.length)}
                </mark>
                {sourceRevision.text.slice(focused.start + focused.excerpt.length)}
              </>
            ) : (
              sourceRevision.text
            )}
          </div>
          {sourceRevision.image && (
            <figure className="workbench-image-preview">
              {savedImage.url && (
                <a href={savedImage.url} target="_blank" rel="noreferrer" aria-label="打开资料原图">
                  <img src={savedImage.url} alt={source.title} />
                </a>
              )}
              {savedImage.error && <p role="alert">{savedImage.error}</p>}
              <figcaption>
                {sourceRevision.image.filename} · {sourceRevision.image.width}×
                {sourceRevision.image.height}
                。原图本地保存；AI整理仅使用已填写的图片说明，不会自动读取画面。
              </figcaption>
            </figure>
          )}
          {focused && !focused.verified && (
            <p className="callout warning">引用待核实：未在对应版本中找到此片段。</p>
          )}
          <div className="source-actions">
            <button
              className="text-button"
              onClick={() => {
                setTitle(source.title);
                setText(source.versions.at(-1)!.text);
                setPerson(source.person);
                setType(source.type);
                setImage(null);
                setEditing(true);
                setAdding(true);
              }}
            >
              新增修订版本
            </button>
            {!source.removed && (
              <button
                className="text-button danger-text"
                onClick={() => {
                  if (window.confirm('移除此资料？历史原文保留，关联内容将标记需复核。'))
                    update((c) => reviseSource(c, source.id, '', true));
                }}
              >
                移除资料
              </button>
            )}
          </div>
          <p className="tiny muted">
            <History size={12} /> 修订保留旧原文，依赖条目会提示复核。
          </p>
        </section>
      ) : (
        <div className="source-placeholder">
          <ArrowLeft size={18} />
          <p>
            选择资料查看原文
            <br />
            点击“查看依据”可定位引用
          </p>
        </div>
      )}
      <div className="source-bottom">
        <button className="text-button" onClick={() => setImportSnapshot(true)}>
          <BookOpen size={14} />
          导入产品需求快照
        </button>
        <button data-tour="workbench-add-source" className="text-button" onClick={openAdd}>
          <Plus size={14} />
          录入或导入资料
        </button>
        <p className="tiny muted">
          资料仅保存在此浏览器。
          <br />
          TXT · Markdown · PDF · DOCX · PNG/JPG/WebP（支持粘贴）
        </p>
      </div>
      {importSnapshot && (
        <SnapshotImport
          target={{ id: w.id, title: w.title }}
          onClose={() => setImportSnapshot(false)}
          onInsert={async (material, featureIds, acknowledge) => {
            const ok = update((current) =>
              importRequirementMaterial(current, material, featureIds, acknowledge),
            );
            if (ok) await flush();
            return ok;
          }}
        />
      )}
      {adding && (
        <Modal
          title={editing ? '新增资料修订版本' : '录入岗位资料'}
          onClose={() => {
            if (!saving && !parsing) {
              setAdding(false);
              setImage(null);
            }
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            onPaste={(e) => {
              if (editing || saving || parsing) return;
              const files = clipboardImages(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              try {
                if (files.length > 1) throw new Error('每份岗位资料添加一张图片，请分次保存。');
                void importFile(preparePastedImages(files)[0]);
              } catch (err) {
                setError(err instanceof Error ? err.message : '粘贴失败');
              }
            }}
          >
            <Field label="资料标题（可选）" id="source-title">
              <Input
                id="source-title"
                aria-label="资料标题"
                maxLength={200}
                value={title}
                disabled={editing}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <div className="form-row">
              <Field label="资料类型" id="source-type">
                <select
                  id="source-type"
                  className="field"
                  value={type}
                  disabled={editing}
                  onChange={(e) => setType(e.target.value as Source['type'])}
                >
                  <option value="person">负责人说明</option>
                  <option value="project">项目材料</option>
                  <option value="old-jd">旧JD模板</option>
                  <option value="supplement">用户补充</option>
                  <option value="file">导入文件</option>
                </select>
              </Field>
              <Field label="来源人物或渠道" id="source-person">
                <Input
                  id="source-person"
                  maxLength={200}
                  value={person}
                  disabled={editing}
                  onChange={(e) => setPerson(e.target.value)}
                  placeholder="如：技术负责人会议记录"
                />
              </Field>
            </div>
            {!editing && (
              <label className="import-button">
                <Upload size={16} />
                导入文件
                <input
                  aria-label="导入岗位资料文件"
                  type="file"
                  accept=".txt,.md,.markdown,.pdf,.docx,.png,.jpg,.jpeg,.webp"
                  disabled={parsing || saving}
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {!editing && (
              <p className="callout subtle">
                可上传PNG、JPG、WebP图片（≤8MB），也可在此窗口按Ctrl+V粘贴截图或图片本身。原图保存在当前浏览器，不自动发送给AI；补充的文字说明会用于后续整理。
              </p>
            )}
            {image && (
              <figure className="workbench-image-preview">
                <img src={image.url} alt="待保存岗位资料图片" />
                <figcaption>
                  {image.metadata.filename} · {image.metadata.width}×{image.metadata.height}
                </figcaption>
                <button className="text-button" type="button" onClick={() => setImage(null)}>
                  移除待保存图片
                </button>
              </figure>
            )}
            <Field
              label={
                image || (sourceRevision?.image && editing)
                  ? '图片说明（可选，填写后供AI整理）'
                  : '原文（保存后通过新版本修订）'
              }
              id="source-text"
              hint="最多30000字；请校对解析内容。扫描件无OCR，可直接粘贴。"
            >
              <Textarea
                id="source-text"
                rows={10}
                required={!image && !(editing && sourceRevision?.image)}
                maxLength={30000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            {parsing && <p role="status">正在本地解析文件…</p>}
            {error && (
              <p role="alert" className="callout error">
                {error}
              </p>
            )}
            <p className="callout subtle">
              资料中的说法是待讨论依据。只有人确认后，才成为岗位条件。
            </p>
            <div className="modal-footer">
              <Button
                variant="outline"
                type="button"
                disabled={saving || parsing}
                onClick={() => {
                  setAdding(false);
                  setImage(null);
                }}
              >
                取消
              </Button>
              <Button type="submit" disabled={parsing || saving}>
                {saving ? '正在保存…' : editing ? '保存新版本' : '保存资料'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
