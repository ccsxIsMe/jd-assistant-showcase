'use client';
import { Sparkles, Network, ArrowLeft, Check } from 'lucide-react';
export function ResearchModeChooser({
  onChoose,
  onExample,
  onBack,
  busy,
}: {
  onChoose: (mode: 'plan' | 'collaborate') => void;
  onExample: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <section className="research-mode-page">
      <button onClick={onBack}>
        <ArrowLeft size={16} />
        返回需求实验室
      </button>
      <header>
        <span className="guided-kicker">选择适合自己的参与方式</span>
        <h1>你希望如何探索产品需求？</h1>
        <p>
          你可以让AI帮你规划，也可以和AI一起研究。两种模式都可以随时查看证据、修改方案和保存快照。
        </p>
      </header>
      <div className="research-mode-cards">
        {[
          {
            id: 'plan' as const,
            icon: Sparkles,
            title: 'AI帮我规划',
            description:
              '告诉我们你想实现什么，并添加参考材料。AI会整理关键需求、提出候选方案，并用少量选择题帮助你确定方向。',
            items: [
              '不必懂技术，也不必先想好岗位名称',
              '一句模糊想法就能开始，资料可以选填',
              'AI按需完成主要分析，你比较方案与关键选择',
              '保留证据、未知和假设，生成可继续共创的资料包',
            ],
            button: '开始规划',
          },
          {
            id: 'collaborate' as const,
            icon: Network,
            title: '和AI一起研究',
            description: '逐步查看证据、功能、推断和候选岗位方案，自主决定分析顺序并深入研究。',
            items: [
              '分阶段核对资料和证据',
              '深入完整证据板，检查关系与标注',
              '编辑功能和约束，比较候选岗位方案',
              '局部修改、撤销、快照和版本始终保留',
            ],
            button: '开始研究',
          },
        ].map((m) => (
          <article key={m.id}>
            <m.icon size={30} />
            <h2>{m.title}</h2>
            <p>{m.description}</p>
            <ul>
              {m.items.map((item) => (
                <li key={item}>
                  <Check size={15} />
                  {item}
                </li>
              ))}
            </ul>
            <button className="lab-primary" disabled={busy} onClick={() => onChoose(m.id)}>
              {m.button}
            </button>
          </article>
        ))}
      </div>
      <button className="research-mode-example" disabled={busy} onClick={onExample}>
        先体验AI规划示例（演示数据，非真实AI）
      </button>
      <p className="muted">两种方式共享同一份研究，随时切换，不会重置资料或确认状态。</p>
    </section>
  );
}
