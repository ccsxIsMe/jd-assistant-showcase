import type { Metadata } from 'next';
import { SiteFrame } from '@/components/site-frame';
import './globals.css';
import './workbench.css';
import './workbench-refinements.css';
import './ai-settings.css';
import './landing.css';
import './workbench-usability.css';
import './exploration.css';
import './research-completion.css';
import '@xyflow/react/dist/style.css';
import './lab.css';
import './guided-research.css';
import './dual-mode.css';
import './product-polish.css';
import './resume-review.css';
import './interaction-fixes.css';
import './decision-quality.css';
export const metadata: Metadata = {
  title: 'JD 助手 · 岗位共创工作台',
  description: '把用人需求，一起说清楚。来源可追溯的任务整理、岗位条件确认与JD局部联动。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-3"
        >
          跳到主要内容
        </a>
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
