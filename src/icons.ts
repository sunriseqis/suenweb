export const BUILTIN_ICONS = [
  "add-line", "archive-drawer-line", "archive-line", "arrow-left-line", "arrow-right-line",
  "article-line", "bank-card-2-line", "bank-card-line", "basketball-line", "bell-line",
  "book-2-line", "book-line", "bookmark-line", "braces-line", "brackets-line",
  "briefcase-2-line", "briefcase-3-line", "briefcase-4-line", "bug-line", "cake-2-line",
  "camera-line", "chat-1-line", "chat-3-line", "chat-4-line", "check-line",
  "clapperboard-line", "close-line", "cloudy-line", "code-box-line", "code-line",
  "code-s-line", "compass-3-line", "compass-line", "coupon-line", "cup-line",
  "delete-bin-line", "download-line", "earth-line", "edit-line", "file-code-line",
  "file-download-line", "file-excel-line", "file-line", "file-pdf-line", "file-ppt-line",
  "file-word-line", "film-line", "first-aid-kit-line", "font-size", "football-line",
  "gallery-line", "git-branch-line", "git-repository-line", "globe-line", "headphone-line",
  "image-2-line", "image-line", "key-2-line", "key-line", "lightbulb-flash-line",
  "lightbulb-line", "lock-password-line", "login-box-line", "logout-box-line", "map-pin-2-line",
  "map-pin-3-line", "map-pin-line", "message-2-line", "money-cny-circle-line", "money-dollar-circle-line",
  "moon-clear-line", "moon-line", "movie-line", "music-2-line", "music-line",
  "palette-line", "puzzle-line", "rainbow-line", "refresh-line", "restaurant-line",
  "robot-line", "rocket-2-line", "rocket-line", "search-line", "settings-3-line",
  "shield-check-line", "shield-line", "shield-star-line", "shield-user-line", "shopping-bag-line",
  "shopping-cart-2-line", "shopping-cart-line", "star-line", "star-s-line", "sun-cloudy-line",
  "sun-line", "terminal-box-line", "terminal-line", "terminal-window-line", "thumb-up-line",
  "thunderstorms-line", "time-line", "upload-line", "video-line"
];

export const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="#333"/>
    <text x="16" y="22" text-anchor="middle" fill="#888" font-size="18">🔗</text>
</svg>`;

export async function proxyFavicon(domain: string, directUrl?: string, db?: D1Database): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  // Check D1 cache if available
  if (db && domain) {
    try {
      const cached = await db
        .prepare("SELECT content, content_type FROM icon_cache WHERE domain = ? AND content_type != 'x-negative' AND updated_at > datetime('now','localtime','-7 days')")
        .bind(domain)
        .first<{ content: string; content_type: string }>();

      if (cached && cached.content) {
        const binary = Uint8Array.from(atob(cached.content), c => c.charCodeAt(0));
        return { data: binary.buffer, contentType: cached.content_type || 'image/x-icon' };
      }
    } catch {}
  }

  const sources: string[] = [];
  if (directUrl) sources.push(directUrl);
  if (domain) {
    sources.push(`https://${domain}/favicon.ico`);
    sources.push(`https://favicon.vemetric.com/${domain}`);
    sources.push(`https://a.favicon.im/${domain}?larger=true`);
  }

  const fetchOne = async (url: string): Promise<{ data: ArrayBuffer; contentType: string } | null> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const ct = res.headers.get('Content-Type') || 'image/x-icon';
        if (ct.includes('text/html') || ct.includes('text/plain')) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 60) {
          return { data: buf, contentType: ct };
        }
      }
    } catch {}
    return null;
  };

  // Try all sources concurrently
  try {
    const results = await Promise.all(sources.map(fetchOne));
    for (const r of results) {
      if (r) {
        // Save to cache asynchronously
        if (db && domain) {
          try {
            const base64 = btoa(String.fromCharCode(...new Uint8Array(r.data)));
            await db
              .prepare("INSERT OR REPLACE INTO icon_cache (domain, content, content_type, source_url, updated_at) VALUES (?, ?, ?, ?, datetime('now','localtime'))")
              .bind(domain, base64, r.contentType, sources[0])
              .run();
          } catch {}
        }
        return r;
      }
    }
  } catch {}

  return null;
}
