'use client';
import { useState } from 'react';
import { Globe, FileUp, Text, CheckCircle2, ExternalLink, Trash2 } from 'lucide-react';
import { parseNames, sourceKindNames } from '@/lib/exploration/model';
import { saveProductIdea, excludeNode } from '@/lib/lab/operations';
import { researchProgress } from '@/lib/lab/guided';
import { sourceParseNotice } from '@/lib/exploration/media-capabilities';
import { Modal } from '../workbench/modal';
import type { GuidedActions } from './guided-types';
export function GuidedMaterials(a: GuidedActions & { hideIdea?: boolean }) {
  const p = a.project,
    ideaSource = p.sources.find(
      (s) => !s.removed && s.kind === 'text' && s.versions[0].text === p.initialObjective,
    );
  const [ideaDraft, setIdea] = useState<string | null>(null),
    [expected, setExpected] = useState<number | undefined>(),
    [removing, setRemoving] = useState<string | null>(null);
  const progress = researchProgress(p);
  const idea = ideaDraft ?? ideaSource?.versions.at(-1)?.text ?? p.initialObjective ?? '';
  return (
    <div className="guided-materials">
      {!a.hideIdea && (
        <section className="guided-idea">
          <span className="guided-kicker">先说清楚你想做什么</span>
          <h2>不用先懂技术，从一个想法开始。</h2>
          <p>你可以只写几句话，资料之后再分批补齐。</p>
          <label htmlFor="product-idea">
            产品构想
            <textarea
              id="product-idea"
              aria-label="产品构想"
              value={idea}
              maxLength={3000}
              rows={5}
              readOnly={a.readonly}
              onChange={(e) => {
                if (ideaDraft === null) setExpected(ideaSource?.versions.at(-1)?.revision);
                setIdea(e.target.value);
              }}
              placeholder="我想做一个在线设计工具，支持多人协作和文件导出，但不确定先实现哪些功能，也不知道需要招聘什么样的人。"
            />
          </label>
          {!a.readonly && (
            <div className="guided-inline">
              <button
                className="lab-primary"
                disabled={!idea.trim()}
                onClick={() => {
                  if (
                    a.update((n) =>
                      saveProductIdea(
                        n,
                        idea,
                        ideaDraft === null ? ideaSource?.versions.at(-1)?.revision : expected,
                      ),
                    )
                  ) {
                    setIdea(null);
                    setExpected(undefined);
                  }
                }}
              >
                保存产品构想
              </button>
              <small>保存后自动成为可追溯的资料；不调用模型。</small>
            </div>
          )}
        </section>
      )}
      <section className="guided-sources">
        <div className="guided-section-heading">
          <div>
            <h2>
              你的参考资料 <small>{p.sources.filter((s) => !s.removed).length}份</small>
            </h2>
            <p>{progress.validSources.length}份可用，可以分批添加，也可以稍后继续。</p>
            <p>
              关联分析只读取文字与已核对证据。图片需先“查看标注”并主动识图、接受候选；视频链接不包含视频画面或声音。
            </p>
          </div>
        </div>
        {!a.readonly && (
          <div className="guided-add-options">
            <button onClick={() => a.onAdd('url')}>
              <Globe size={20} />
              <strong>公开产品链接</strong>
              <small>先获取可访问的正文</small>
            </button>
            <button onClick={() => a.onAdd('file')}>
              <FileUp size={20} />
              <strong>图片、文档或视频</strong>
              <small>按已支持格式解析与预览</small>
            </button>
            <button onClick={() => a.onAdd('text')}>
              <Text size={20} />
              <strong>粘贴文字说明</strong>
              <small>补充目标、边界与未知项</small>
            </button>
          </div>
        )}
        {!p.sources.some((s) => !s.removed) && (
          <div className="guided-empty">
            <CheckCircle2 size={25} />
            <p>先保存构想，或添加一份资料。无需一次准备齐全。</p>
          </div>
        )}
        <div className="guided-source-list">
          {p.sources
            .filter((s) => !s.removed)
            .map((s) => (
              <article key={s.id} data-testid="guided-source">
                <div className="guided-source-icon">
                  {s.kind === 'url' ? <Globe size={18} /> : <FileUp size={18} />}
                </div>
                <div>
                  <strong>{s.title}</strong>
                  <div className="guided-meta">
                    <span>{sourceKindNames[s.kind]}</span>
                    <span>V{s.versions.at(-1)!.revision}</span>
                    <span className={s.status === 'error' ? 'guided-warning' : ''}>
                      {parseNames[s.status]}
                    </span>
                  </div>
                  {s.error && <p className="guided-warning">{sourceParseNotice(s)}</p>}
                  {s.status === 'error' && (
                    <p>可以查看后重试解析、替换文件，或粘贴正文作为补充；也可暂时移除。</p>
                  )}
                </div>
                <div className="guided-source-actions">
                  <button onClick={() => a.onSource(s.id)}>
                    <ExternalLink size={14} />
                    {s.status === 'error' ? '查看错误与重试' : '查看解析结果'}
                  </button>
                  {['image', 'document', 'video'].includes(s.kind) && (
                    <button onClick={() => a.onAnnotation(s.id)}>查看标注</button>
                  )}
                  {!a.readonly && (
                    <button aria-label={`移除研究资料${s.title}`} onClick={() => setRemoving(s.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}
        </div>
      </section>
      {removing && (
        <Modal title="移除这份资料？" onClose={() => setRemoving(null)}>
          <p>保留来源历史和旧快照，相关证据和结论将需要复核，不会静默删除其他来源。支持撤销。</p>
          <button
            className="lab-primary"
            onClick={() => {
              if (a.update((p) => excludeNode(p, `source:${removing}`))) setRemoving(null);
            }}
          >
            确认移除资料
          </button>
        </Modal>
      )}
    </div>
  );
}
