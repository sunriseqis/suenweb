// SSE 实时刷新：服务端书签或分组变化时自动重拉数据，断线指数退避重连

export type LiveHandle = { close: () => void };

const MAX_BACKOFF_MS = 30000;

export function connectLive(onChange: () => void, onState?: (connected: boolean) => void): LiveHandle {
  let source: EventSource | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let everConnected = false;

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
      // 从未成功连接（401/404 等永久性失败）且已重试 3 次：停止重连，避免无限请求
      if (!everConnected && retry >= 3) {
        console.warn('[live] 连续 3 次未能建立 SSE 连接，停止重连');
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
