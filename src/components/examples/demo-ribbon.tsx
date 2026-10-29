import Link from 'next/link';
import { DEMO_NOTICE, type DemoIdentity } from '@/lib/demo/identity';
export function DemoRibbon({ demo, mode }: { demo?: DemoIdentity; mode?: string }) {
  if (!demo) return null;
  return (
    <aside className="demo-ribbon" aria-label="示例来源说明">
      <strong>{mode === 'real' ? '示例项目｜虚构材料｜真实AI重分析' : DEMO_NOTICE}</strong>
      {demo.retired && <small>已归档实例</small>}
      {demo.kind === 'personal-copy' && <small>个人副本，仍含虚构来源</small>}
      <Link href="/examples">说明、重置与个人副本 ↗</Link>
    </aside>
  );
}
