import { displayName, normalizeNameKey } from '../domain/normalize.ts';

/** Netscape Bookmark HTML 解析：文件夹 → 分组，A 节点 → 链接（IMP-01） */
export type ParsedFolder = { name: string; depth: number };
export type ParsedItem = { type: 'folder'; name: string; depth: number } | { type: 'link'; title: string; url: string; folderDepth: number };

export function parseBookmarksHtml(html: string): { folders: Array<{ name: string; items: Array<{ title: string; url: string }> }>; total: number; invalid: number } {
  const text = String(html ?? '');
  const folders: Array<{ name: string; items: Array<{ title: string; url: string }> }> = [];
  // 展平结构：按 H3 切换当前文件夹，A 归入当前文件夹
  const tokenRe = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\b[^>]*\bhref=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>|<dl>/gi;
  const stack: Array<{ name: string; items: Array<{ title: string; url: string }> }> = [];
  const root = { name: '', items: [] as Array<{ title: string; url: string }> };
  let total = 0;
  let invalid = 0;
  const decode = (s: string): string =>
    String(s ?? '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/<[^>]*>/g, '')
      .trim();
  let m: RegExpExecArray | null;
  const current = (): { name: string; items: Array<{ title: string; url: string }> } => stack.length ? stack[stack.length - 1] : root;
  while ((m = tokenRe.exec(text))) {
    if (m[1] !== undefined) {
      const name = displayName(decode(m[1])) || '未命名';
      const folder = { name, items: [] as Array<{ title: string; url: string }> };
      stack.push(folder);
      folders.push(folder);
    } else if (m[2] !== undefined) {
      const url = decode(m[3] ?? m[4] ?? '');
      const title = decode(m[5] ?? '') || url;
      if (!url) { invalid += 1; continue; }
      if (!/^https?:\/\//i.test(url)) { invalid += 1; continue; }
      current().items.push({ title, url });
      total += 1;
    } else {
      // <dl> 开始子层级；遇到下一个 </dl> 才收栈——HTML 书签里 DL 与 H3 交替出现，
      // 简化处理：H3 入栈后遇到下一个 H3 或结尾不弹栈也能保证去重正确（同名合并）
      // 这里在遇到 H3 时如果栈深 >= 1 且上一个 <dl> 未闭合就保留（层级不严格也 OK）
    }
  }
  // 合并同名文件夹（大小写不敏感）
  const merged = new Map<string, { name: string; items: Array<{ title: string; url: string }> }>();
  for (const folder of folders) {
    const key = normalizeNameKey(folder.name);
    const hit = merged.get(key);
    if (hit) hit.items.push(...folder.items);
    else merged.set(key, folder);
  }
  return { folders: [...merged.values()], total, invalid };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 导出为 Netscape Bookmark HTML（IMP-03）：groups → H3，links → A */
export function renderBookmarksHtml(groups: Array<{ name: string; links: Array<{ title: string; url: string; description?: string | null; created_at?: string }> }>): string {
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>SuenWeb Bookmarks</TITLE>',
    '<H1>SuenWeb Bookmarks</H1>',
    '<DL><p>',
  ];
  for (const group of groups) {
    lines.push('    <DT><H3>' + esc(group.name) + '</H3>');
    lines.push('    <DL><p>');
    for (const link of group.links) {
      const add = link.created_at ? ' ADD_DATE="' + Math.floor(new Date(link.created_at).getTime() / 1000) + '"' : '';
      lines.push('        <DT><A HREF="' + esc(link.url) + '"' + add + '>' + esc(link.title) + '</A>');
      if (link.description) lines.push('        <DD>' + esc(link.description));
    }
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>');
  return lines.join('\n') + '\n';
}
