'use client';
import { currentDecisions } from '@/lib/decisions/records';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Search,
  Layers,
  FolderOpen,
  Clock3,
  Play,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { workspaceStore } from '@/lib/workbench/storage';
import { configuredClientMode } from '@/lib/ai/client-mode';
import { newWorkspace, uid, workspaceSchema, type Workspace } from '@/lib/workbench/model';
import { ensureDemo, demoDestination } from '@/lib/demo/instances';
import { confirmationIssues } from '@/lib/workbench/domain';
import { Modal } from './modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field } from '../common';
import { SnapshotImport } from '../exploration/snapshot-import';
function stage(w: Workspace) {
  return w.versions.some((v) => v.kind === 'confirmed') && !confirmationIssues(w).length
    ? '已确认版本'
    : w.items.some((i) => i.kind === 'block')
      ? 'JD草稿'
      : w.items.length
        ? '岗位确认'
        : '资料整理';
}
export function WorkspaceHome({ embedded = false }: { embedded?: boolean }) {
  const Heading = embedded ? 'h2' : 'h1';
  const router = useRouter();
  const [rows, setRows] = useState<Workspace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部岗位');
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [newMode, setNewMode] = useState<'auto' | 'example' | 'real'>('auto');
  const [busy, setBusy] = useState(false);
  const [snapshotImport, setSnapshotImport] = useState(false);
  useEffect(() => {
    workspaceStore
      .list()
      .then((rows) => setRows(rows.filter((w) => !w.demo?.retired)))
      .catch(() => setError('无法读取浏览器本地岗位，请检查存储权限；原始数据未覆盖。'))
      .finally(() => setLoaded(true));
  }, []);
  async function open(w: Workspace) {
    setBusy(true);
    setError('');
    try {
      await workspaceStore.save(w);
      router.push(`/workspaces/${w.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建岗位失败');
      setBusy(false);
    }
  }
  async function createWorkspace() {
    if (busy) return;
    setBusy(true);
    setError('');
    const w = newWorkspace(name.trim() || '待明确岗位');
    try {
      w.mode = newMode === 'auto' ? await configuredClientMode() : newMode;
      await open(w);
    } catch {
      setError('本机模式读取失败，岗位尚未创建，请重试或选择手动模式。');
      setBusy(false);
    }
  }
  async function example(seed: 'inputs' | 'complete') {
    setBusy(true);
    setError('');
    try {
      router.push(await demoDestination(await ensureDemo(seed), 'workbench'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '示例准备失败，已有岗位保留。');
      setBusy(false);
    }
  }
  async function importBackup(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 20000000) throw new Error('备份超过20MB限制');
      const w = workspaceSchema.parse(JSON.parse(await file.text()));
      const oldId = w.id;
      w.id = uid();
      w.title = (w.title + ' · 导入副本').slice(0, 200);
      w.suggestions = w.suggestions.map((s) => ({ ...s, workspaceId: w.id }));
      w.activity.unshift({
        id: uid(),
        text: `导入本地备份副本，保留原岗位 ${oldId}`,
        at: new Date().toISOString(),
      });
      await open(w);
    } catch {
      setError('备份内容不合法、版本不兼容或保存失败；已有岗位未覆盖。');
    }
  }
  const visible = rows.filter(
    (w) =>
      w.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === '全部岗位' || stage(w) === filter),
  );
  return (
    <div className="home-workbench">
      <div className="explore-handoff">
        <Link href="/lab">想法还不明确？先去需求实验室 →</Link>
        <button onClick={() => setSnapshotImport(true)}>导入产品需求快照</button>
      </div>
      {snapshotImport && <SnapshotImport onClose={() => setSnapshotImport(false)} />}
      <div className="home-heading">
        <div>
          <div className="eyebrow">岗位共创工作台</div>
          <Heading>
            把用人需求，<span>一起说清楚。</span>
          </Heading>
          <p>从零散资料到明确岗位，让每个条件有依据，让每次修改看得见。</p>
        </div>
        <Button
          onClick={() => {
            setName('');
            setCreate(true);
          }}
          disabled={busy}
        >
          <Plus size={17} />
          创建岗位
        </Button>
      </div>
      <div className="home-start-grid">
        <section className="recent-feature">
          <div className="section-kicker">
            <Clock3 size={15} />
            继续最近的工作
          </div>
          {rows.find((w) => !w.example && !w.demo) ? (
            <>
              <h2>{rows.find((w) => !w.example && !w.demo)!.title}</h2>
              <p>
                {stage(rows.find((w) => !w.example && !w.demo)!)} ·{' '}
                {new Date(rows.find((w) => !w.example && !w.demo)!.updatedAt).toLocaleString(
                  'zh-CN',
                  {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  },
                )}{' '}
                更新
              </p>
              <Link
                className="link-action"
                href={`/workspaces/${rows.find((w) => !w.example && !w.demo)!.id}`}
              >
                回到工作区 <ArrowRight size={16} />
              </Link>
            </>
          ) : (
            <>
              <h2>第一份好JD，从真实工作开始</h2>
              <p>先放入负责人说明、项目材料和旧模板，再一起确认岗位边界。</p>
              <button className="link-action" onClick={() => setCreate(true)}>
                开始创建 <ArrowRight size={16} />
              </button>
            </>
          )}
          <div className="feature-decoration">
            <Layers size={66} strokeWidth={1} />
          </div>
        </section>
        <section className="example-feature">
          <div className="section-kicker">
            <Play size={15} />
            完整流程示例 · 虚构资料
          </div>
          <h2>软件工程师，需要交付哪些具体能力？</h2>
          <p>
            虚构问题追踪系统：React/TypeScript、Node.js、SQL与工程质量，从权限依据到JD与简历核对。
          </p>
          <div className="inline-actions">
            <button className="link-action" disabled={busy} onClick={() => void example('inputs')}>
              从头体验 <ArrowUpRight size={15} />
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void example('complete')}
            >
              查看已完成示例
            </button>
          </div>
          <Link className="example-link" href="/examples?stage=workbench">
            示例材料、各阶段与安全重置 ↗
          </Link>
        </section>
      </div>
      {error && (
        <div role="alert" className="callout error">
          {error}
          <button className="text-button" onClick={() => window.location.reload()}>
            重新读取
          </button>
        </div>
      )}
      <div className="list-heading">
        <div>
          <h2>
            我的岗位 <span>{rows.filter((w) => !w.example && !w.demo).length} 个真实岗位</span>
          </h2>
          <p>资料、决定与JD，放在同一个工作区里。</p>
        </div>
        <div className="list-controls">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索岗位"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索岗位名称"
            />
          </label>
          <select
            aria-label="按阶段筛选"
            className="compact-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {['全部岗位', '资料整理', '岗位确认', 'JD草稿', '已确认版本'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      {!loaded ? (
        <div className="home-empty" role="status">
          正在读取本机岗位…
        </div>
      ) : visible.length ? (
        <div className="workspace-cards">
          {visible.map((w) => {
            const pending =
              w.items.filter((i) => i.status === 'pending' || i.status === 'review').length +
              currentDecisions(w.questions).filter(
                (q) => q.status === 'open' || q.status === 'deferred',
              ).length;
            return (
              <Link className="workspace-card" key={w.id} href={`/workspaces/${w.id}`}>
                <div className="workspace-card-top">
                  <span className="workspace-glyph">
                    <FolderOpen size={21} />
                  </span>
                  <span className={`stage-tag ${stage(w) === '已确认版本' ? 'confirmed' : ''}`}>
                    {stage(w)}
                  </span>
                </div>
                <h3>{w.title}</h3>
                <p className="workspace-description">
                  {w.sources.filter((s) => !s.removed).length} 份资料 ·{' '}
                  {w.items.filter((i) => i.kind === 'task' && i.status !== 'excluded').length}{' '}
                  项任务 ·{' '}
                  {
                    w.items.filter((i) => i.kind === 'requirement' && i.status !== 'excluded')
                      .length
                  }{' '}
                  项要求
                </p>
                <div className="workspace-meta">
                  <span>{pending ? `${pending} 项待确认` : '暂无待确认事项'}</span>
                  {w.example && <span>虚构示例</span>}
                </div>
                <div className="workspace-card-footer">
                  <span>
                    {new Date(w.updatedAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <ArrowUpRight size={17} />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="home-empty">
          <FolderOpen size={32} />
          <h3>{rows.length ? '没有找到匹配岗位' : '这里将保存你们共同说清楚的岗位'}</h3>
          <p>
            {rows.length ? '调整搜索词或筛选条件。' : '创建岗位录入真实资料，或从完整示例开始。'}
          </p>
          <Button variant="outline" onClick={() => setCreate(true)}>
            <Plus size={16} />
            创建岗位
          </Button>
        </div>
      )}
      <div className="home-bottom">
        <span>
          <ShieldCheck size={15} />
          本机浏览器保存 · 无云端同步 · 关键决定由人确认
        </span>
        <label className="backup-import">
          导入岗位备份
          <input
            aria-label="导入岗位备份"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              void importBackup(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <Link href="/match">
          <FileText size={15} />
          已有JD，直接核对简历证据 <ArrowUpRight size={14} />
        </Link>
      </div>
      {create && (
        <Modal title="创建岗位工作区" onClose={() => setCreate(false)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) {
                setBusy(true);
                void createWorkspace();
              }
            }}
          >
            <Field label="岗位名称" id="workspace-name">
              <Input
                id="workspace-name"
                autoFocus
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="可选；也可先从需求资料开始"
              />
            </Field>
            <p className="callout subtle">
              创建后可粘贴说明、导入项目资料或旧JD。先人工整理也可以；本地编辑与保存不依赖AI。
            </p>
            <p className="tiny muted">
              新岗位按本机服务配置选择模式，不会套用内置示例。创建和手动编辑不调用模型。
            </p>
            <label>
              AI协作方式
              <select
                aria-label="新岗位AI协作方式"
                className="field"
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as typeof newMode)}
              >
                <option value="auto">按本机配置（创建时不调用AI）</option>
                <option value="real">真实DeepSeek（主动操作时发送，按服务商计费）</option>
                <option value="example">手动整理 / 本地示例</option>
              </select>
            </label>
            <div className="modal-footer">
              <Button variant="outline" type="button" onClick={() => setCreate(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? '正在创建…' : '创建并进入'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
