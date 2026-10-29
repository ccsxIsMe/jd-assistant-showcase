'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { explorationSchema, type Exploration } from '@/lib/exploration/model';
import { explorationStore, PROJECT_LIFECYCLE_CHANNEL } from '@/lib/exploration/storage';
import { recordResearchChange } from '@/lib/exploration/journal';
/** 研究草稿的内存状态与串行保存队列；保存失败仍保留 current，允许重试或导出。 */
export function useExploration(id: string, debounceMs = 0) {
  const [project, setProject] = useState<Exploration | null>(null);
  const current = useRef<Exploration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'failed'>('saved');
  const queue = useRef(Promise.resolve());
  const pending = useRef<Exploration | null>(null);
  const saveSequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    explorationStore
      .get(id)
      .then((p) => {
        if (mounted.current) {
          current.current = p;
          setProject(p);
          if (!p) setError('找不到本机探索项目；请返回探索首页。');
        }
      })
      .catch(() => setError('探索项目读取失败，原记录未覆盖。'))
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [id]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(PROJECT_LIFECYCLE_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data?.id !== id) return;
      void explorationStore
        .get(id)
        .then((p) => {
          if (mounted.current && p) {
            current.current = p;
            setProject(p);
          }
        })
        .catch(() => setError('探索状态读取失败，请刷新；原数据未覆盖。'));
    };
    return () => channel.close();
  }, [id]);
  const writePending = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    const sequence = saveSequence.current;
    if (!p) return queue.current;
    pending.current = null;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          await explorationStore.save(p);
          // 旧写入完成不能把尚未落盘的新编辑误报为“已保存”。
          if (mounted.current && saveSequence.current === sequence) setSaveState('saved');
        } catch (e) {
          if (mounted.current) {
            setSaveState('failed');
            setError(e instanceof Error ? e.message : '保存失败');
          }
          throw e;
        }
      });
    void queue.current.catch(() => {});
    return queue.current;
  }, []);
  const persist = useCallback(
    (p: Exploration) => {
      pending.current = p;
      saveSequence.current++;
      setSaveState('saving');
      if (timer.current) clearTimeout(timer.current);
      if (!debounceMs) {
        void writePending().catch(() => {});
        return;
      }
      timer.current = setTimeout(() => {
        void writePending().catch(() => {});
      }, debounceMs);
    },
    [writePending, debounceMs],
  );
  useEffect(() => {
    const drain = () => {
      void writePending().catch(() => {});
    };
    window.addEventListener('pagehide', drain);
    return () => {
      window.removeEventListener('pagehide', drain);
      drain();
    };
  }, [writePending]);
  const update = useCallback(
    (fn: (p: Exploration) => Exploration) => {
      try {
        if (!current.current) return false;
        if (current.current.trashedAt) throw new Error('探索已在回收站中，请先恢复再编辑。');
        let result = fn(current.current);
        const label =
          result.activity[0]?.id !== current.current.activity[0]?.id
            ? (result.activity[0]?.text ?? '')
            : '';
        if (
          label &&
          !/^(分析完成|保存|用户明确导出|导出|撤销：|重做：)/.test(label) &&
          (result.operations?.length ?? 0) === (current.current.operations?.length ?? 0)
        )
          result = recordResearchChange(current.current, result, label);
        const next = explorationSchema.parse(result);
        current.current = next;
        setProject(next);
        persist(next);
        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message : '操作失败，原始数据保留');
        return false;
      }
    },
    [persist],
  );
  return {
    project,
    current,
    loading,
    error,
    setError,
    saveState,
    update,
    flush: writePending,
    retry: () => {
      if (current.current) persist(current.current);
    },
  };
}
/** 只读取本机 Blob；切换附件或卸载时释放对象 URL，迟到读取不更新旧预览。 */
export function useAssetURL(id: string | undefined | null) {
  const [state, setState] = useState<{ id: string; url: string; error: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let url = '';
    explorationStore
      .asset(id)
      .then((asset) => {
        if (cancelled) return;
        if (!asset) {
          setState({ id, url: '', error: '原始附件缺失，请重新导入完整项目或替换文件。' });
          return;
        }
        url = URL.createObjectURL(asset.blob);
        setState({ id, url, error: '' });
      })
      .catch(() => {
        if (!cancelled) setState({ id, url: '', error: '附件读取失败，请重试。' });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return state && state.id === id ? state : { url: '', error: '' };
}
