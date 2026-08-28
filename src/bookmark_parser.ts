export interface ParsedLink {
  title: string;
  url: string;
  icon?: string;
  add_date?: string;
}

export interface ParsedFolder {
  name: string;
  icon?: string;
  bookmarks: ParsedLink[];
}

export function parseBookmarks(content: string): ParsedFolder[] {
  const stripped = content.trim();
  if (
    stripped.startsWith('<!DOCTYPE') ||
    stripped.toUpperCase().startsWith('<HTML') ||
    stripped.toUpperCase().startsWith('<META') ||
    /<DT>/i.test(stripped) ||
    /<DL>/i.test(stripped)
  ) {
    return parseBookmarkHtml(stripped);
  }

  if (stripped.startsWith('{')) {
    try {
      const data = JSON.parse(stripped);
      if (data.roots || data.checksum) {
        return parseChromeBookmarksJson(data);
      }
    } catch {
      // Fallback
    }
  }

  throw new Error('不支持的书签文件格式');
}

export function parseBookmarkHtml(html: string): ParsedFolder[] {
  const folders: ParsedFolder[] = [];
  let currentFolder: ParsedFolder = { name: '未分类', icon: '📁', bookmarks: [] };

  // Match H3 header (folder) or A link (bookmark)
  const dtRegex = /<DT>\s*(?:<H3[^>]*>(.*?)<\/H3>|<A\s+([^>]*?)>(.*?)<\/A>)/gis;
  let match: RegExpExecArray | null;

  while ((match = dtRegex.exec(html)) !== null) {
    if (match[1] !== undefined) {
      // It's a folder header
      const folderName = match[1].replace(/<[^>]+>/g, '').trim();
      if (folderName) {
        currentFolder = { name: folderName, icon: '📁', bookmarks: [] };
        folders.push(currentFolder);
      }
    } else if (match[2] !== undefined && match[3] !== undefined) {
      // It's an anchor tag
      const attrs = match[2];
      const rawTitle = match[3].replace(/<[^>]+>/g, '').trim();

      const hrefMatch = attrs.match(/HREF=["']([^"']+)["']/i);
      const iconMatch = attrs.match(/ICON=["']([^"']+)["']/i);
      const addDateMatch = attrs.match(/ADD_DATE=["']([^"']+)["']/i);

      if (hrefMatch && hrefMatch[1] && rawTitle) {
        const url = hrefMatch[1].trim();
        const icon = iconMatch ? iconMatch[1] : '';
        let dateStr = '';
        if (addDateMatch && /^\d+$/.test(addDateMatch[1])) {
          try {
            dateStr = new Date(parseInt(addDateMatch[1], 10) * 1000).toISOString().split('T')[0];
          } catch {}
        }

        const link: ParsedLink = {
          title: rawTitle,
          url: url,
          icon: icon,
          add_date: dateStr
        };

        if (!folders.includes(currentFolder)) {
          folders.push(currentFolder);
        }
        currentFolder.bookmarks.push(link);
      }
    }
  }

  // Filter out empty folders
  return folders.filter(f => f.bookmarks && f.bookmarks.length > 0);
}

export function parseChromeBookmarksJson(data: any): ParsedFolder[] {
  const folders: ParsedFolder[] = [];
  const roots = data.roots || {};

  for (const rootKey of ['bookmark_bar', 'other', 'synced']) {
    const root = roots[rootKey];
    if (root && Array.isArray(root.children)) {
      parseChromeChildren(root.children, folders);
    }
  }

  return folders;
}

function parseChromeChildren(children: any[], folders: ParsedFolder[]) {
  for (const child of children) {
    if (child.type === 'folder') {
      const folderName = child.name || '未命名';
      const folderLinks: ParsedLink[] = [];

      if (Array.isArray(child.children)) {
        for (const sub of child.children) {
          if (sub.type === 'url' && sub.name && sub.url) {
            folderLinks.push({
              title: sub.name,
              url: sub.url,
              icon: '',
              add_date: tsToDate(sub.date_added)
            });
          } else if (sub.type === 'folder' && Array.isArray(sub.children)) {
            parseChromeChildren([sub], folders);
          }
        }
      }

      if (folderLinks.length > 0) {
        folders.push({
          name: folderName,
          icon: '📁',
          bookmarks: folderLinks
        });
      }
    } else if (child.type === 'url' && child.name && child.url) {
      let uncat = folders.find(f => f.name === '未分类');
      if (!uncat) {
        uncat = { name: '未分类', icon: '📋', bookmarks: [] };
        folders.push(uncat);
      }
      uncat.bookmarks.push({
        title: child.name,
        url: child.url,
        icon: '',
        add_date: tsToDate(child.date_added)
      });
    }
  }
}

function tsToDate(tsStr: any): string {
  if (!tsStr) return '';
  try {
    const ts = parseInt(tsStr, 10);
    let unixTs = ts;
    if (ts > 10000000000000000) {
      unixTs = Math.floor(ts / 1000000) - 11644473600;
    }
    if (unixTs > 0) {
      return new Date(unixTs * 1000).toISOString().split('T')[0];
    }
  } catch {}
  return '';
}
