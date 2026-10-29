'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ensureDemo,
  demoDestination,
  copyDemoAsPersonal,
  type DemoStage,
} from '@/lib/demo/instances';
import { DEMO_NOTICE } from '@/lib/demo/identity';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
const modules: { stage: DemoStage; title: string; text: string }[] = [
  {
    stage: 'plan',
    title: 'AI帮我规划',
    text: '比较服务组合、轻量Web和分阶段交付；包括不新增招聘的选择。',
  },
  {
    stage: 'research',
    title: '共同研究',
    text: '核对同一首轮活动的候补冲突，修改功能、回答未知问题。',
  },
  { stage: 'board', title: '完整证据板', text: '查看真实来源、图片标注和关系，拖动、聚焦与撤销。' },
  { stage: 'workbench', title: '岗位共创与JD', text: '来源导入、逐项确认、草稿与局部修改审阅。' },
  {
    stage: 'resume',
    title: '简历证据核对',
    text: '五条岗位要求与四种材料状态，定位原文并人工修正。',
  },
  { stage: 'history', title: '研究历史与快照', text: '打开两个不可变版本，继续研究并导出资料。' },
];
export function DemoHub({ stage }: { stage?: DemoStage }) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reset, setReset] = useState<'inputs' | 'complete' | null>(null);
  async function open(seed: 'inputs' | 'complete', target: DemoStage, copy = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let record = await ensureDemo(seed);
      if (copy) record = await copyDemoAsPersonal(record);
      router.push(await demoDestination(record, target));
    } catch (e) {
      setError(e instanceof Error ? e.message : '示例准备失败，原数据保留。');
      setBusy(false);
    }
  }
  return (
    <div className="demo-hub">
      <header className="product-page-heading">
        <span className="guided-kicker">SOFTWARE ENGINEER / 展示案例 V1</span>
        <h1>给一个模糊想法，找到可交付的边界。</h1>
        <p>
          为星桥问题追踪系统招聘软件工程师：明确React与TypeScript界面、Node.js接口、SQL数据与测试交付。先核对权限冲突，再把具体能力带入JD与简历证据核对。
        </p>
        <strong className="demo-notice">{DEMO_NOTICE}</strong>
      </header>
      <p>
        所有文件由本项目生成，按钮操作使用真实业务组件和本地持久化。预置响应不会调用真实模型；不展示真实企业、真实候选人或未经授权的网页。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">正在准备本地文件与示例数据，未调用真实模型…</p>}
      <div className="demo-module-grid">
        {modules.map((m) => (
          <section key={m.stage} className={stage === m.stage ? 'selected' : ''}>
            <span className="guided-kicker">{m.stage.toUpperCase()}</span>
            <h2>{m.title}</h2>
            <p>{m.text}</p>
            <div>
              <Button disabled={busy} onClick={() => void open('complete', m.stage)}>
                查看完成版
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void open('inputs', m.stage)}
              >
                从头体验
              </Button>
            </div>
          </section>
        ))}
      </div>
      <section className="demo-management">
        <h2>可重复打开，安全地重置</h2>
        <p>
          完成版和从头版各保留一个当前示例实例。重复打开继续上次状态，不重复注入。重置会新建该版示例，并将旧示例标为归档；不删除个人岗位、旧快照或个人副本。复制后仍保留虚构来源标识。
        </p>
        <div>
          <Button variant="outline" disabled={busy} onClick={() => setReset('inputs')}>
            重置从头版…
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setReset('complete')}>
            重置完成版…
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void open('complete', stage ?? 'plan', true)}
          >
            复制完成版为个人项目
          </Button>
        </div>
      </section>
      <section className="demo-management">
        <h2>可打开的原始材料</h2>
        <p>
          <a href="/demo/software-engineer/reference.html" target="_blank" rel="noreferrer">
            本地模拟产品页 ↗
          </a>{' '}
          ·{' '}
          <a href="/demo/software-engineer/interface.png" target="_blank" rel="noreferrer">
            程序绘制界面图 ↗
          </a>{' '}
          ·{' '}
          <a href="/demo/software-engineer/software-brief.docx" download>
            项目资料DOCX
          </a>{' '}
          ·{' '}
          <a href="/demo/software-engineer/software-resume.docx" download>
            虚构简历DOCX
          </a>
        </p>
        <Link href="/lab">开始自己的研究 →</Link>
      </section>
      {reset && (
        <Modal title="重置指定版本的软件工程师示例" onClose={() => setReset(null)}>
          <p>
            仅重建{reset === 'inputs' ? '从头版' : '完成版'}
            示例。旧实例与快照保留为归档，个人项目和副本不受影响。
          </p>
          <Button variant="outline" onClick={() => setReset(null)}>
            取消
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              const seed = reset;
              setBusy(true);
              void ensureDemo(seed, true)
                .then(
                  () => {
                    setReset(null);
                    setNotice('已建立新的示例；旧示例与快照保留为归档。');
                  },
                  (e) => setError(e instanceof Error ? e.message : '重置失败，原数据保留。'),
                )
                .finally(() => setBusy(false));
            }}
          >
            确认重置此示例
          </Button>
        </Modal>
      )}
    </div>
  );
}
