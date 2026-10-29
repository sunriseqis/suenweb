/**
 * M9 SSRF 私网黑名单：出网请求前校验 hostname。
 * 纯函数，iconCache（icon-refresh）与 routes/tools（check-links）共用。
 * 拒绝：localhost 变体、127.x、10.x、172.16-31.x、192.168.x、169.254.x、0.0.0.0、
 * [::1] 等 IPv6 环回/链路本地，以及 0x 十六进制 / 八进制形式的 IP。
 */
const IPV4_PRIVATE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

export function isPrivateHost(rawHost: string): boolean {
  let host = String(rawHost ?? '').trim().toLowerCase();
  if (!host) return true;
  // IPv6 字面量在 URL.hostname 中带方括号
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.includes(':')) {
    // IPv6：环回/未指定/链路本地 (fe80::/10) 与内网唯一本地 (fc00::/7) 一律拒绝
    return host === '::1' || /^(f[cd]|fe[89ab])/.test(host);
  }
  // 0x 十六进制 IP 形式（如 0x7f.0.0.1、0x7f000001）直接拒绝；
  // 八进制 IP（如 0177.0.0.1）：含前导 0 的多段形式拒绝（保守策略）
  if (/0x[0-9a-f]/.test(host)) return true;
  if (/(^|\.)0[0-7]{2,}(\.|$)/.test(host)) return true;
  if (!/^\d{1,3}(\.\d{1,3}){0,3}$/.test(host)) return false;
  return IPV4_PRIVATE.some((re) => re.test(host));
}
