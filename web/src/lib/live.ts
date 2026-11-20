// SSE 实时刷新：服务端书签或分组变化时自动重拉数据，断线指数退避重连

export type LiveHandle = { close: () => void };

const MAX_BACKOFF_MS = 30000;

/** EventSource 不暴露状态码，用 fetch 预检区分 401（需重新登录）与临时网络故障 */
async function probeAuth(): Promise<number | null> {
  try {
    const res = await fetch('/api/events/stream', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      cache: 'no-store',
    });
    // 立刻关闭 SSE 响应体，避免占连接
    void res.body?.cancel().catch(() => undefined);
    return res.status;
  } catch {
    return null;
  }
}

export function connectLive(onChange: () => void, onState?: (connected: boolean) => void): LiveHandle {
  let source: EventSource | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let everConnected = false;
  let authFailed = false;

  /** 401：会话已失效，停止重连并跳转登录页 */
  const handleUnauthorized = (): void => {
    if (authFailed) return;
    authFailed = true;
    closed = true;
    if (timer) clearTimeout(timer);
    source?.close();
    source = null;
    console.warn('[live] SSE 认证失败（401），跳转登录页');
    onState?.(false);
    if (window.location.hash !== '#/login') window.location.hash = '#/login';
  };

  const open = (): void => {
    if (closed) return;
    source = new EventSource('/api/events/stream');
    source.onopen = () => {
      everConnected = true;
      retry = 0;
      onState?.(true);
    };
    source.addEventListener('links-changed', () => onChange());
    source.addEventListener('groups-changed', () => onChange());
    source.addEventListener('ping', () => onState?.(true));
    source.onerror = () => {
      source?.close();
      source = null;
      onState?.(false);
      if (closed) return;
      // 从未成功连接（401/404 等永久性失败）且已重试 3 次：预检是否 401，否则停止重连
      if (!everConnected && retry >= 3) {
        void probeAuth().then((status) => {
          if (status === 401) {
            handleUnauthorized();
          } else {
            console.warn('[live] 连续 3 次未能建立 SSE 连接，停止重连');
          }
        });
        return;
      }
      const delay = Math.min(1000 * 2 ** retry, MAX_BACKOFF_MS);
      retry += 1;
      timer = setTimeout(open, delay);
    };
  };

  open();
  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      source = null;
    },
  };
}
