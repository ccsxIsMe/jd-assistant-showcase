'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Compass,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Plus,
  Upload,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Modal } from '../workbench/modal';
import { newExploration, type Exploration } from '@/lib/exploration/model';
import { explorationStore, PROJECT_LIFECYCLE_CHANNEL } from '@/lib/exploration/storage';
import { ExplorationProjectList } from './project-list';
import { configuredClientMode } from '@/lib/ai/client-mode';
import { ideaSource } from '@/lib/exploration/sources';
import { textEvidence } from '@/lib/exploration/domain';
import { importPackage } from '@/lib/exploration/portable';
import { ensureDemo, demoDestination } from '@/lib/demo/instances';
import { synchronizeLab } from '@/lib/lab/graph';
import { ResearchModeChooser } from '../lab/mode-chooser';
export function ExplorationHome({ laboratory = false }: { laboratory?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Exploration[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [modeChoosing, setModeChoosing] = useState(false);
  const [entry, setEntry] = useState('mixed');
  const [title, setTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    const load = () =>
      explorationStore
        .list()
        .then((rows) => {
          if (active) setRows(rows.filter((p) => !p.demo?.retired));
        })
        .catch(() => {
          if (active) setError('本机探索读取失败；原有岗位与资料未覆盖。');
        })
        .finally(() => {
          if (active) setLoaded(true);
        });
    void load();
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(PROJECT_LIFECYCLE_CHANNEL)
        : null;
    if (channel) channel.onmessage = () => void load();
    return () => {
      active = false;
      channel?.close();
    };
  }, []);
  const recent = rows.find((p) => !p.trashedAt);
  async function create(example = false, researchMode: 'plan' | 'collaborate' = 'collaborate') {
    setBusy(true);
    setError('');
    try {
      if (example) {
        router.push(
          await demoDestination(
            await ensureDemo('complete'),
            researchMode === 'plan' ? 'plan' : 'research',
          ),
        );
        return;
      }
      let p = newExploration(title.trim() || idea.trim().slice(0, 28) || '我的产品研究');
      p.mode = await configuredClientMode();
      const text = idea;
      if (text.trim()) {
        p.initialObjective = text;
        const source = ideaSource('用户目标与边界', text);
        p.sources.push(source);
        p.evidence.push(...textEvidence(source, source.versions[0]));
        p.ui.sourceId = source.id;
      }
      p.ui.view = text.trim() ? 'evidence' : 'overview';
      if (laboratory) {
        p = synchronizeLab(p);
        p.lab!.ui.researchMode = researchMode;
      }
      await explorationStore.save(p);
      router.push(`/${laboratory ? 'lab' : 'explore'}/${p.id}?entry=${entry}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '创建失败');
      setBusy(false);
    }
  }
  function newResearch() {
    if (laboratory) setModeChoosing(true);
    else setCreating(true);
  }
  async function restore(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const p = await importPackage(file);
      router.push(`/${laboratory ? 'lab' : 'explore'}/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，原数据保留');
      setBusy(false);
    }
  }
  if (modeChoosing)
    return (
      <div className="explore-home">
        {error && <p role="alert">{error}</p>}
        <ResearchModeChooser
          busy={busy}
          onBack={() => setModeChoosing(false)}
          onChoose={(mode) => {
            if (mode === 'plan') void create(false, 'plan');
            else {
              setModeChoosing(false);
              setCreating(true);
            }
          }}
          onExample={() => void create(true, 'plan')}
        />
      </div>
    );
  return (
    <div className="explore-home">
      <section className="explore-hero">
        <div>
          <span className="explore-eyebrow">
            <Compass size={16} /> PRODUCT DISCOVERY
          </span>
          <h1>
            {laboratory ? '需求实验室' : '经典资料视图'}
            <span>先把产品，想清楚。</span>
          </h1>
          <p>
            {laboratory
              ? '从一个想法开始，分五步整理资料、核对证据、明确功能、比较岗位并继续共创。'
              : '从参考产品、零散资料和模糊想法，到有证据支撑的产品需求。'}
          </p>
          <div className="explore-hero-actions">
            <Button disabled={busy} onClick={newResearch}>
              <Plus size={17} />
              新建探索
            </Button>
            {recent && (
              <Link href={`/${laboratory ? 'lab' : 'explore'}/${recent.id}`}>
                继续最近探索 <ArrowRight size={16} />
              </Link>
            )}
            <Link href="/explore/history">研究历史</Link>
            <Link className="example-link" href="/examples?stage=plan">
              软件工程师案例 · 从头体验与完成版
            </Link>
            {laboratory && (
              <button disabled={busy} onClick={() => void create(true)}>
                加载完整演示案例
              </button>
            )}
          </div>
        </div>
        <div className="explore-map" aria-label="产品探索流程">
          <span>
            <Globe />
            多源资料
          </span>
          <i>↘</i>
          <span>
            <ImageIcon />
            可追溯证据
          </span>
          <i>↘</i>
          <span>
            <Layers />
            人工确认的需求
          </span>
          <i>↘</i>
          <span>
            <FileText />
            可导入快照
          </span>
        </div>
      </section>
      <section className="explore-entry-grid" aria-label="四种探索起点">
        {[
          {
            id: 'product',
            icon: Globe,
            title: '参考现有产品',
            text: '只借鉴你需要的功能，明确不做什么。',
          },
          {
            id: 'material',
            icon: Upload,
            title: '上传参考材料',
            text: '图片、文档与视频，保留独立来源。',
          },
          {
            id: 'idea',
            icon: Compass,
            title: '描述模糊想法',
            text: '不必填满表格，一段自然语言就能开始。',
          },
          {
            id: 'mixed',
            icon: Layers,
            title: '整合多种资料',
            text: '交叉检查证据，让冲突与未知项浮出来。',
          },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setEntry(item.id);
              newResearch();
            }}
          >
            <item.icon size={22} />
            <strong>{item.title}</strong>
            <p>{item.text}</p>
            <ArrowRight size={17} />
          </button>
        ))}
      </section>
      <div className="explore-list-heading">
        <div>
          <h2>我的探索</h2>
          <p>资料空间与岗位独立；先保存研究快照，再预览并主动导入待确认的岗位候选。</p>
        </div>
        <label className="explore-import">
          <Upload size={16} />
          导入探索 / 快照
          <input
            aria-label="导入探索项目或快照"
            type="file"
            accept=".json"
            disabled={busy}
            onChange={(e) => {
              void restore(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && (
        <p className="callout error" role="alert">
          {error}
        </p>
      )}
      <Input
        aria-label="搜索探索"
        placeholder="搜索探索名称"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ExplorationProjectList
        rows={rows.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))}
        loaded={loaded}
        laboratory={laboratory}
        onError={setError}
        onChange={(project) =>
          setRows((current) => current.map((p) => (p.id === project.id ? project : p)))
        }
      />
      {loaded && !rows.length && (
        <div className="explore-empty">
          <Compass size={32} />
          <h3>每个好产品，都从一个问题开始</h3>
          <p>先描述一个想法，或用虚构示例体验完整流程。</p>
          <Button variant="outline" disabled={busy} onClick={() => void create(true)}>
            体验产品探索示例
          </Button>
        </div>
      )}
      <p className="explore-local-note">
        文件和项目保存在本浏览器。当前无账号或云同步；真实分析前会再次告知发送范围。图片 /
        视频不自动观看；图片或单帧可在需求实验室主动识图并核对。
      </p>
      {creating && (
        <Modal title="新建产品探索" onClose={() => setCreating(false)}>
          <form
            className="form-stack exploration-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              探索名称
              <Input
                aria-label="探索名称"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="可选，例如：为小团队做一个实时原型工具"
              />
            </label>
            <label>
              探索起点
              <select
                aria-label="探索起点"
                className="field"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
              >
                <option value="product">参考现有产品</option>
                <option value="material">上传参考材料</option>
                <option value="idea">描述模糊想法</option>
                <option value="mixed">整合多种资料</option>
              </select>
            </label>
            <label>
              想法与限制（可选）
              <Textarea
                aria-label="初始想法"
                rows={8}
                value={idea}
                maxLength={30000}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="想解决的问题、用户、资源、限制，以及目前不确定的部分。"
              />
            </label>
            <p className="muted">
              进入后可继续添加多个网址、文件、图片和MP4。每份资料独立解析、预览与核对。
            </p>
            <div className="modal-actions">
              <Button type="submit" disabled={busy}>
                {busy ? '正在建立…' : '开始探索'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
