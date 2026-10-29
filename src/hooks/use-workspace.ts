'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceStore } from '@/lib/workbench/storage';
import { refreshSuggestions } from '@/lib/workbench/domain';
import { workspaceSchema, type Workspace } from '@/lib/workbench/model';
/** 岗位编辑先校验内存副本，再串行持久化；失败保留编辑，不显示虚假保存成功。 */
export function useWorkspace(id: string) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const current = useRef<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'failed'>('saved');
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const saveSequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    workspaceStore
      .get(id)
      .then((w) => {
        if (!mounted.current) return;
        current.current = w;
        setWorkspace(w);
        if (!w) setError('找不到这个岗位；请返回列表选择本机已保存岗位。');
      })
      .catch(() => setError('本地岗位读取失败或版本不兼容。记录未覆盖，请保留浏览器数据并重试。'))
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [id]);
  const persist = useCallback((w: Workspace) => {
    const sequence = ++saveSequence.current;
    setSaveState('saving');
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          await workspaceStore.save(w);
          // 仅最新保存序列可更新状态，避免前一版本的完成事件覆盖当前保存提示。
          if (mounted.current && sequence === saveSequence.current) {
            setSaveState('saved');
          }
        } catch (e) {
          if (mounted.current && sequence === saveSequence.current) {
            setSaveState('failed');
            setError(e instanceof Error ? e.message : '保存失败');
          }
          throw e;
        }
      });
    void queue.current.catch(() => {});
  }, []);
  const update = useCallback(
    (fn: (w: Workspace) => Workspace) => {
      try {
        if (!current.current) return false;
        const n = fn(current.current);
        if (n === current.current) return true;
        refreshSuggestions(n);
        const parsed = workspaceSchema.parse(n);
        current.current = parsed;
        setWorkspace(parsed);
        persist(parsed);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败，内容未修改');
        return false;
      }
    },
    [persist],
  );
  return {
    workspace,
    current,
    loading,
    error,
    setError,
    saveState,
    update,
    flush: () => queue.current,
    retry: () => {
      if (current.current) persist(current.current);
    },
  };
}
