'use client';
import Link from 'next/link';
import { useState } from 'react';
import { explorationStore } from '@/lib/exploration/storage';
import type { Exploration } from '@/lib/exploration/model';
import { Button } from '../ui/button';
export function TrashedProjectNotice({ project }: { project: Exploration }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="explore-empty" aria-label="已删除的探索">
      <h1>这个探索已在回收站中</h1>
      <p>资料、附件和旧快照完整保留；先恢复再继续研究，迟到分析不会覆盖删除状态。</p>
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await explorationStore.setTrashed(project.id, project.revision, false);
            window.location.reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : '恢复失败');
            setBusy(false);
          }
        }}
      >
        恢复探索并继续
      </Button>
      <Link href="/lab">返回我的探索</Link>
    </section>
  );
}
