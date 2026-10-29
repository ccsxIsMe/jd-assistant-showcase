'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  FileText,
  GitCompareArrows,
  Layers,
  Link2,
  MousePointer2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { WorkspaceHome } from './workbench/home';
const scenes = [
  {
    label: '01 · 从想法开始',
    title: '三份材料，不止一种说法。',
    text: '招聘问题追踪系统的软件工程师；旧模板却要求精通所有框架。先明确界面、接口、数据与验收。',
  },
  {
    label: '02 · 看见真实工作',
    title: '先确定工作，再讨论能力。',
    text: '问题表单、状态变更、查询与导出，回到原文查看，再提出React、Node.js、SQL等具体能力候选。',
  },
  {
    label: '03 · 人决定边界',
    title: '这一条，到底是不是必须？',
    text: '谁能修改状态？使用现有服务，还是招聘软件工程师？AI提出候选，最终决定留给你。',
  },
  {
    label: '04 · 让修改同步',
    title: '改一处，看见相关变化。',
    text: '职责、条件与JD段落相互关联。逐条审阅差异，确认后才应用。',
  },
];
export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState(0);
  useEffect(() => {
    const nodes = root.current?.querySelectorAll('.reveal');
    if (!nodes) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('revealed');
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="landing-root">
      <section
        className="landing-hero"
        onPointerMove={(e) => {
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--px', `${(e.clientX - r.left) / r.width - 0.5}`);
          e.currentTarget.style.setProperty('--py', `${(e.clientY - r.top) / r.height - 0.5}`);
        }}
      >
        <div className="landing-grain" />
        <div className="hero-topline">
          <span>
            <i />
            JD 助手 / 岗位共创工作台
          </span>
          <span>CLARITY BEFORE HIRING.</span>
        </div>
        <div className="landing-hero-grid">
          <div className="hero-copy">
            <div className="landing-eyebrow entrance">从产品想法，到有据可循的岗位。</div>
            <h1 className="entrance entrance-1">
              先说清楚工作，
              <br />
              再找到<span>对的人。</span>
            </h1>
            <p className="hero-description entrance entrance-2">
              从模糊想法出发，整理资料、比较方案。
              <br />
              AI整理证据，你确认岗位边界。
              <br />
              再用同一标准，核对简历中的真实描述。
            </p>
            <div className="hero-ctas entrance entrance-3">
              <Link className="landing-primary" href="/lab">
                开始规划 <ArrowRight size={17} />
              </Link>
              <a className="landing-secondary" href="#workspaces">
                已有岗位，完善JD <ArrowDown size={15} />
              </a>
            </div>
            <p className="hero-light-links">
              <a href="/examples">体验完整示例 ↗</a>
              <a href="/match">已有JD，直接核对简历 ↗</a>
            </p>
            <div className="hero-footnote entrance entrance-3">
              <span>
                <ShieldCheck size={13} />
                关键决定，由人确认
              </span>
              <span>
                <Layers size={13} />
                本机保存，随时继续
              </span>
            </div>
          </div>
          <div
            className={`hero-product scene-${scene} entrance entrance-2`}
            aria-label="虚构岗位的交互演示"
          >
            <svg className="product-paths" viewBox="0 0 680 540" fill="none" aria-hidden="true">
              <path
                d="M110 160C210 160 200 280 320 280M150 410C220 410 190 300 330 300M500 130C560 130 550 280 490 280"
                stroke="currentColor"
                strokeDasharray="4 7"
              />
              <circle cx="320" cy="280" r="7" fill="currentColor" />
            </svg>
            <div className="floating-source source-note">
              <div>
                <span className="source-dot cyan" />
                负责人说明 <small>01</small>
              </div>
              <p>
                “需要问题表单、状态变更，
                <br />
                可以查询并导出问题列表。”
              </p>
              <span>
                <Link2 size={11} />
                原始资料
              </span>
            </div>
            <div className="floating-source template-note">
              <div>
                <span className="source-dot amber" />
                旧JD模板 <small>02</small>
              </div>
              <p>
                “还要支付、聊天、原生端，
                <br />
                这些真的是首轮必须吗？”
              </p>
              <span className="amber-text">与实际任务可能不一致</span>
            </div>
            <div className="product-document">
              <div className="document-chrome">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                <small>ROLE / 001</small>
                <span className="fiction-tag">虚构演示</span>
              </div>
              <div className="document-content">
                <p className="document-overline">一个岗位，逐渐清晰。</p>
                <h2>
                  星桥问题追踪系统
                  <br />
                  软件工程师（候选）
                </h2>
                <div className="demo-document-rule" />
                <div className={`document-line ${scene >= 1 ? 'active' : ''}`}>
                  <Check size={14} />
                  <span>React与TypeScript界面交付</span>
                  <span className="mini-ref">来源 A</span>
                </div>
                <div className={`document-line ${scene >= 1 ? 'active' : ''}`}>
                  <Check size={14} />
                  <span>Node.js接口与SQL查询</span>
                  <span className="mini-ref">来源 B</span>
                </div>
                <div className={`document-line ${scene >= 2 ? 'reviewed' : ''}`}>
                  <span className="document-check">?</span>
                  <span>{scene >= 2 ? '仅管理员改状态 · 示例决定' : '状态修改权限 · 待确认'}</span>
                </div>
                <div className={`document-line excluded-line ${scene >= 2 ? 'removed-line' : ''}`}>
                  <span className="document-check">−</span>
                  <span>支付、积分与聊天 · 暂不纳入</span>
                </div>
                <div className="document-bottom">
                  <span className="document-status">
                    {scene < 2 ? '等待人的决定' : '边界已说清 · 待审阅'}
                  </span>
                  <span>JD ASSISTANT</span>
                </div>
              </div>
            </div>
            <div className="floating-decision">
              <span className="decision-icon">
                <GitCompareArrows size={20} />
              </span>
              <div>
                <strong>{scene === 3 ? '只修改你接受的部分' : '从“都要”到“确实需要”'}</strong>
                <p>
                  {scene === 3 ? '差异可见 · 可以拒绝 · 支持撤销' : 'AI提出建议，人作最后决定。'}
                </p>
              </div>
            </div>
            <div className="product-cursor">
              <MousePointer2 size={18} />
              <span>用人负责人</span>
            </div>
            <span className="product-coordinate">SOURCE → TASK → HUMAN → JD</span>
          </div>
        </div>
        <div className="landing-bottomline">
          <span>
            不是再写一份模板。
            <br />
            是一起定义，这一次真正需要的岗位。
          </span>
          <a href="#how-it-works">
            <span>向下探索</span>
            <ArrowDown size={16} />
          </a>
          <span>
            DESIGNED FOR
            <br />
            REAL DECISIONS.
          </span>
        </div>
      </section>
      <section className="landing-story" id="how-it-works">
        <div className="story-heading reveal">
          <p className="landing-eyebrow">从零散想法，到共同确认。</p>
          <h2>
            每一步都有依据，
            <br />
            <span>每个决定都看得见。</span>
          </h2>
          <p>
            点选任一步，看看资料如何成为岗位内容。
            <br />
            以下展示使用固定虚构示例，不会调用模型。
          </p>
        </div>
        <div className="story-interaction reveal">
          <div className="story-tabs" role="tablist" aria-label="共创流程演示">
            {scenes.map((s, index) => (
              <button
                key={s.label}
                role="tab"
                aria-selected={scene === index}
                onClick={() => setScene(index)}
              >
                {s.label}
                <span>{['资料', '任务', '人工确认', '局部联动'][index]}</span>
              </button>
            ))}
          </div>
          <article className="story-stage" key={scene}>
            <div>
              <span className="story-stage-index">0{scene + 1}</span>
              <Sparkles size={22} />
            </div>
            <h3>{scenes[scene].title}</h3>
            <p>{scenes[scene].text}</p>
            <div className="story-trace">
              <span>
                <FileText size={13} />
                资料片段
              </span>
              <ArrowRight size={13} />
              <span>
                <Layers size={13} />
                可讨论内容
              </span>
              <ArrowRight size={13} />
              <span>
                <Check size={13} />
                人确认
              </span>
            </div>
            <a href="#workspaces">
              亲手走一遍 <ArrowRight size={14} />
            </a>
          </article>
        </div>
      </section>
      <section className="landing-principles">
        <div className="reveal">
          <span>01 / 有据可循</span>
          <h3>
            点开一个条件，
            <br />
            回到它的来处。
          </h3>
          <p>原文片段、资料版本与岗位任务保持关联。资料变化时，告诉你哪些内容需要复核。</p>
          <Link2 size={24} />
        </div>
        <div className="reveal">
          <span>02 / 保留决定权</span>
          <h3>
            AI提出修改，
            <br />
            你决定是否发生。
          </h3>
          <p>先看修改前后，再单条采纳、编辑或拒绝。锁定的内容不会被AI改动。</p>
          <GitCompareArrows size={24} />
        </div>
        <div className="reveal">
          <span>03 / 可以回头</span>
          <h3>
            把每一次确认，
            <br />
            留下一个版本。
          </h3>
          <p>局部撤销不带走无关编辑。确认版本、比较差异，再带着清晰的JD出发。</p>
          <Layers size={24} />
        </div>
      </section>
      <section className="landing-workspaces" id="workspaces">
        <div className="workspace-section-intro reveal">
          <span>YOUR NEXT CLEAR ROLE.</span>
          <p>现在，把你的第一个岗位说清楚。</p>
        </div>
        <WorkspaceHome embedded />
      </section>
      <footer className="landing-footer">
        <div>
          <Sparkles size={20} />
          <strong>JD 助手</strong>
          <span>岗位共创工作台</span>
        </div>
        <span>把用人需求，一起说清楚。</span>
        <a href="/settings/ai">
          配置AI连接 <ArrowRight size={13} />
        </a>
      </footer>
    </div>
  );
}
