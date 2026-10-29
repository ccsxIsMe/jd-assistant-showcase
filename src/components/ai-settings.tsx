'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  PlugZap,
  XCircle,
} from 'lucide-react';
import { Button } from './ui/button';
const localPath = '.env.local';
type Connection = {
  configured: boolean;
  mode?: string;
  model?: string | null;
  baseURL?: string;
  message?: string;
};
export function AISettings() {
  const [config, setConfig] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    code?: string;
    requestId?: string;
    kind?: 'network' | 'model';
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/ai/connection', { signal: c.signal })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {
        if (!c.signal.aborted)
          setConfig({ configured: false, message: '无法读取服务端配置，请确认本地服务已启动。' });
      });
    return () => {
      c.abort();
      controller.current?.abort();
    };
  }, []);
  async function test(network = false) {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(network ? '/api/ai/network' : '/api/ai/connection', {
        method: network ? 'GET' : 'POST',
        ...(network
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ confirm: true }),
            }),
        signal: c.signal,
      });
      const data = await res.json();
      setResult({ ...data, kind: network ? 'network' : 'model' });
    } catch {
      setResult({
        ok: false,
        code: c.signal.aborted ? 'CANCELLED' : 'NETWORK',
        message: c.signal.aborted
          ? '已取消；没有发送岗位资料。'
          : '本地测试请求失败，请检查服务状态。',
      });
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  return (
    <section className="ai-settings">
      <Link className="text-button" href="/">
        <ArrowLeft size={14} />
        返回首页
      </Link>
      <div className="settings-heading">
        <span className="settings-icon">
          <KeyRound size={25} />
        </span>
        <div>
          <p className="eyebrow">SERVER-SIDE CONNECTION</p>
          <h1>把连接配好，把密钥留在本机。</h1>
          <p>四项AI任务共用一套服务端凭据。这里不接收、保存或显示API Key。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <h2>01 / 填写本地配置</h2>
          <p>在项目根目录复制 .env.example 为 .env.local，然后在编辑器打开：</p>
          <div className="config-path">
            <code>{localPath}</code>
            <button
              aria-label="复制配置文件路径"
              onClick={() => {
                void navigator.clipboard.writeText(localPath).then(() => setCopied(true));
              }}
            >
              <Copy size={16} />
            </button>
          </div>
          {copied && <p role="status">路径已复制</p>}
          <pre>
            {
              'AI_MODE=real\nDEEPSEEK_API_KEY=在本机填写你的密钥\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-flash'
            }
          </pre>
          <p>
            保存后，在启动服务的终端按 Ctrl+C，再运行 <code>pnpm dev</code>
            。生产运行需重新构建后启动。
          </p>
          <p className="callout subtle">
            不要把密钥发给聊天、写入前端输入框或使用 NEXT_PUBLIC_ 前缀。.env.local 已被Git忽略。
          </p>
        </section>
        <section className="settings-card">
          <h2>02 / 测试服务端连接</h2>
          <div className={`connection-status ${config?.configured ? 'ready' : ''}`}>
            {config?.configured ? <CheckCircle2 size={20} /> : <PlugZap size={20} />}
            <div>
              <strong>
                {config
                  ? config.configured
                    ? '服务端配置已就绪'
                    : '尚未启用真实模型'
                  : '正在读取配置'}
              </strong>
              <p>{config?.message ?? '只有本机服务端读取凭据；不会返回密钥。'}</p>
            </div>
          </div>
          {config?.model && (
            <dl>
              <dt>模型</dt>
              <dd>{config.model}</dd>
              <dt>接口</dt>
              <dd>{config.baseURL}</dd>
            </dl>
          )}
          <p>
            先检查网络：不携带密钥，不发送资料，不调用模型。网络通畅后可测试DeepSeek连接，仅发送固定JSON，但会执行一次真实模型请求。
          </p>
          <div className="inline-actions">
            <Button variant="outline" disabled={busy} onClick={() => void test(true)}>
              检查网络（不调用模型）
            </Button>
            <Button disabled={busy} onClick={() => void test()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <PlugZap size={16} />}
              测试DeepSeek连接
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => controller.current?.abort()}>
                取消
              </Button>
            )}
          </div>
          {result && (
            <div role="status" className={`connection-result ${result.ok ? 'success' : 'failure'}`}>
              {result.ok ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
              <div>
                <strong>
                  {result.ok
                    ? result.kind === 'network'
                      ? 'HTTPS网络可达 · 尚未验证模型'
                      : '连接与JSON输出校验通过'
                    : (result.code ?? '测试失败')}
                </strong>
                <p>{result.message}</p>
                {result.requestId && <small>请求编号：{result.requestId}</small>}
              </div>
            </div>
          )}
        </section>
      </div>
      <section className="settings-card task-overview">
        <h2>03 / 四个任务，逐步协作</h2>
        <div>
          {[
            ['extractRequirements', '整理需求', '资料 → 有依据的候选任务与要求'],
            ['inspectIssues', '发现问题', '对照材料与人工决定，指出待确认项'],
            ['generateJdDraft', '形成草稿', '只使用已确认内容，区分条件类别'],
            ['proposeLocalChanges', '局部调整', '选中范围 → 差异审阅 → 人选择采纳'],
          ].map(([name, title, text], index) => (
            <article key={name}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <code>{name}</code>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <p className="tiny muted">
          每一步收到结果后结束请求，等待人的下一步操作。排序、锁定、确认和保存均在应用代码中完成，不调用模型。
        </p>
      </section>
    </section>
  );
}
