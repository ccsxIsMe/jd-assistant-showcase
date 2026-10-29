'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resumeStore } from '@/lib/resume/storage';
import { workspaceStore } from '@/lib/workbench/storage';
import { newReviewSession, standardFromWorkspace } from '@/lib/resume/domain';
import { reviewSessionSchema, type ReviewSession } from '@/lib/resume/model';
import { now, type Workspace } from '@/lib/workbench/model';
export function useResumeSession(reviewId?: string, workspaceId?: string, versionId?: string) {
  const [session, setSession] = useState<ReviewSession | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const current = useRef<ReviewSession | null>(null),
    queue = useRef(Promise.resolve()),
    sequence = useRef(0),
    mounted = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((s: ReviewSession) => {
    const own = ++sequence.current;
    if (timer.current) clearTimeout(timer.current);
    setSaveState('saving');
    timer.current = setTimeout(() => {
      timer.current = null;
      queue.current = queue.current
        .catch(() => {})
        .then(() => resumeStore.save(s))
        .then(() => {
          if (mounted.current && own === sequence.current) {
            setSaveState('saved');
            setError('');
            if (!s.workspaceId)
              history.replaceState(null, '', `/match?review=${encodeURIComponent(s.id)}`);
          }
        })
        .catch(() => {
          if (mounted.current && own === sequence.current) {
            setSaveState('failed');
            setError('本地保存失败；当前材料和人工修正仍在页面，可以重试保存或导出已有报告。');
          }
        });
    }, 350);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void (async () => {
      try {
        let loaded = reviewId ? await resumeStore.get(reviewId) : null;
        const w = workspaceId
          ? await workspaceStore.get(workspaceId)
          : loaded?.workspaceId
            ? await workspaceStore.get(loaded.workspaceId)
            : null;
        if (workspaceId && !w)
          throw new Error('找不到本浏览器中的岗位；请返回工作台或使用已有JD入口。');
        if (reviewId && !loaded)
          throw new Error('核对记录不存在，请保留浏览器数据并返回记录列表。');
        if (w && !loaded) {
          const stableId = `resume-workspace:${w.id}`;
          loaded = await resumeStore.get(stableId);
          if (!loaded) {
            const standard = standardFromWorkspace(w, versionId);
            loaded = {
              ...newReviewSession(standard),
              id: stableId,
              mode: w.mode,
              ...(w.demo ? { demo: w.demo } : {}),
            };
            await resumeStore.save(loaded);
          }
        }
        if (active) {
          current.current = loaded;
          setSession(loaded);
          setWorkspace(w);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '记录读取失败，原数据保留。');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        if (current.current) {
          const latest = current.current;
          queue.current = queue.current.catch(() => {}).then(() => resumeStore.save(latest));
          void queue.current.catch(() => {});
        }
      }
    };
  }, [reviewId, workspaceId, versionId]);
  const update = useCallback(
    (fn: (s: ReviewSession) => ReviewSession) => {
      try {
        if (!current.current) return false;
        const next = reviewSessionSchema.parse(fn(current.current));
        current.current = next;
        setSession(next);
        persist(next);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '修改未保存，原数据保留。');
        return false;
      }
    },
    [persist],
  );
  const adopt = useCallback(
    (s: ReviewSession) => {
      const parsed = reviewSessionSchema.parse(s);
      current.current = parsed;
      setSession(parsed);
      persist(parsed);
    },
    [persist],
  );
  const refreshWorkspace = useCallback(async () => {
    const id = current.current?.workspaceId ?? workspaceId;
    if (!id) return null;
    const w = await workspaceStore.get(id);
    setWorkspace(w);
    return w;
  }, [workspaceId]);
  useEffect(() => {
    const refresh = () => {
      void refreshWorkspace().catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refreshWorkspace]);
  const remove = async () => {
    const old = current.current;
    if (!old) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await queue.current;
    await resumeStore.remove(old.id);
    current.current = null;
    setSession(null);
  };
  return {
    session,
    workspace,
    loading,
    error,
    setError,
    current,
    update,
    adopt,
    refreshWorkspace,
    saveState,
    remove,
    retry: () => {
      if (current.current) persist({ ...current.current, updatedAt: now() });
    },
  };
}
