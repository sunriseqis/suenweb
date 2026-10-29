/**
 * 商店链接规则单点实现（EXT-04）：前端与插件都用它生成商店页链接。
 * Firefox 走 AMO（about:addons 搜索页兜底）；Chrome/Edge 走 Web Store。
 */
export type BrowserKind = 'firefox' | 'chrome' | 'edge' | 'other';

export type ExtensionInfo = { ext_id: string; name: string; version: string; url?: string | null };

export function storeUrl(info: ExtensionInfo, browser: BrowserKind = 'chrome'): string {
  const id = String(info.ext_id ?? '');
  const name = encodeURIComponent(String(info.name ?? ''));
  if (browser === 'firefox') {
    // AMO 内部 id（uuid 或 slug 形态）直接拼详情页；guid（{...}）走搜索
    if (/^[a-z0-9.@-]+$/i.test(id) && !id.startsWith('{')) return 'https://addons.mozilla.org/firefox/addon/' + id + '/';
    return 'https://addons.mozilla.org/firefox/search/?q=' + name;
  }
  if (browser === 'edge') {
    return 'https://microsoftedge.microsoft.com/addons/search/' + name;
  }
  return 'https://chromewebstore.google.com/detail/' + (id || name);
}

/** 上报时的浏览器类型（由插件声明，服务端存库校验） */
export function browserLabel(ua: string): BrowserKind {
  if (/firefox/i.test(ua)) return 'firefox';
  if (/edg\//i.test(ua)) return 'edge';
  if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
  return 'other';
}
