'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
export function SiteFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const researchHistory =
    path.startsWith('/explore/history') || path.startsWith('/explore/snapshots');
  if (
    path.startsWith('/workspaces/') ||
    path.startsWith('/lab/') ||
    (path.startsWith('/explore/') &&
      !path.startsWith('/explore/snapshots') &&
      !path.startsWith('/explore/history'))
  )
    return children;
  return (
    <>
      <header className={`app-topbar ${path === '/' ? 'landing-header' : ''}`}>
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Sparkles size={21} />
          </span>
          <strong>JD 助手</strong>
          <span className="brand-divider" />
          <span>岗位共创工作台</span>
        </Link>
        <nav aria-label="主导航">
          <Link href="/" aria-current={path === '/' ? 'page' : undefined}>
            首页
          </Link>
          <Link href={path === '/' ? '#workspaces' : '/#workspaces'} aria-current={undefined}>
            我的岗位
          </Link>
          <Link
            href="/lab"
            aria-current={
              path.startsWith('/lab') || (path.startsWith('/explore') && !researchHistory)
                ? 'page'
                : undefined
            }
          >
            需求实验室
          </Link>
          <Link href="/explore/history" aria-current={researchHistory ? 'page' : undefined}>
            研究历史
          </Link>
          <Link href="/examples" aria-current={path === '/examples' ? 'page' : undefined}>
            体验示例
          </Link>
          <Link href="/settings/ai" aria-current={path === '/settings/ai' ? 'page' : undefined}>
            AI连接
          </Link>
        </nav>
        <span className="local-indicator">本地工作空间</span>
      </header>
      <main id="main" className={path === '/match' ? 'aux-main' : 'home-main'}>
        {children}
      </main>
    </>
  );
}
