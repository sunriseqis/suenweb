import { Env, Wallpaper } from './types';
import { getSetting } from './db';

const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';

export async function fetchWallpaperUrl(db: D1Database, direction: string = 'next'): Promise<string> {
  const sourcesRes = await db
    .prepare('SELECT * FROM wallpapers WHERE enabled = 1 ORDER BY sort_order ASC, id ASC')
    .all<Wallpaper>();
  const sources = sourcesRes.results || [];
  if (sources.length === 0) return '';

  const stateRow = await db.prepare('SELECT * FROM wallpaper_state WHERE id = 1').first<any>();
  let currentIndex = stateRow?.current_index ?? 0;
  let currentImageIdx = stateRow?.current_image_idx ?? 0;
  const total = sources.length;

  if (direction === 'next') {
    currentIndex = (currentIndex + 1) % total;
  } else if (direction === 'prev') {
    currentIndex = (currentIndex - 1 + total) % total;
  } else if (direction === 'random') {
    currentIndex = Math.floor(Math.random() * total);
    currentImageIdx = 0;
  }

  for (let offset = 0; offset < total; offset++) {
    const idx = (currentIndex + offset) % total;
    const source = sources[idx];
    const stype = source.source_type || 'url';

    if (stype === 'steamgriddb') {
      const apiKey = await getSetting(db, 'steamgriddb_api_key', '');
      if (!apiKey) continue;
      const url = await resolveSteamGridDB(db, source.url, apiKey);
      if (url) {
        await db
          .prepare("UPDATE wallpaper_state SET current_url = ?, current_index = ?, current_image_idx = 0, last_refresh_at = datetime('now','localtime') WHERE id = 1")
          .bind(url, idx)
          .run();
        return url;
      }
    } else if (source.url.includes('bing.com')) {
      const { url, nextImageIdx } = await resolveBingWallpaper(source.url, currentImageIdx, direction);
      if (url) {
        await db
          .prepare("UPDATE wallpaper_state SET current_url = ?, current_index = ?, current_image_idx = ?, last_refresh_at = datetime('now','localtime') WHERE id = 1")
          .bind(url, idx, nextImageIdx)
          .run();
        return url;
      }
    } else {
      const url = await resolveGenericWallpaper(source.url);
      if (url) {
        await db
          .prepare("UPDATE wallpaper_state SET current_url = ?, current_index = ?, current_image_idx = 0, last_refresh_at = datetime('now','localtime') WHERE id = 1")
          .bind(url, idx)
          .run();
        return url;
      }
    }
  }

  return '';
}

async function resolveBingWallpaper(
  apiUrl: string,
  currentIdx: number,
  direction: string
): Promise<{ url: string; nextImageIdx: number }> {
  try {
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return { url: '', nextImageIdx: 0 };
    const data: any = await res.json();
    const images = data?.images || [];
    if (images.length === 0) return { url: '', nextImageIdx: 0 };

    let nextIdx = currentIdx;
    if (direction === 'next') {
      nextIdx = (currentIdx + 1) % images.length;
    } else if (direction === 'prev') {
      nextIdx = (currentIdx - 1 + images.length) % images.length;
    } else if (direction === 'random') {
      nextIdx = Math.floor(Math.random() * images.length);
    }

    const imgObj = images[nextIdx];
    const fullUrl = imgObj?.url ? 'https://cn.bing.com' + imgObj.url : '';
    return { url: fullUrl, nextImageIdx: nextIdx };
  } catch {
    return { url: '', nextImageIdx: 0 };
  }
}

async function resolveSteamGridDB(db: D1Database, steamAppId: string, apiKey: string): Promise<string> {
  if (!apiKey) return '';

  // Check cache first (within 24h)
  try {
    const cached = await db
      .prepare("SELECT image_url FROM steamgriddb_cache WHERE game_id = ? AND datetime(fetched_at) > datetime('now','-1 day')")
      .bind(steamAppId)
      .all<{ image_url: string }>();

    if (cached.results && cached.results.length > 0) {
      const randomItem = cached.results[Math.floor(Math.random() * cached.results.length)];
      return randomItem.image_url;
    }
  } catch {}

  try {
    const res = await fetch(`${SGDB_BASE}/heroes/steam/${steamAppId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    const heroes = data?.data || [];
    if (heroes.length === 0) return '';

    const preferredStyles = ['material', 'blurred', 'alternate'];
    const scored = heroes.map((h: any) => {
      const idx = preferredStyles.indexOf(h.style);
      return { score: idx >= 0 ? idx : 99, url: h.url, style: h.style };
    });
    scored.sort((a: any, b: any) => a.score - b.score);
    const top = scored.slice(0, 8);

    for (const item of top) {
      try {
        await db
          .prepare("INSERT OR IGNORE INTO steamgriddb_cache (game_id, image_url, style, fetched_at) VALUES (?, ?, ?, datetime('now','localtime'))")
          .bind(steamAppId, item.url, item.style || '')
          .run();
      } catch {}
    }

    const chosen = top[Math.floor(Math.random() * top.length)];
    return chosen?.url || '';
  } catch {
    return '';
  }
}

async function resolveGenericWallpaper(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow'
    });
    if (res.ok) {
      const ct = res.headers.get('Content-Type') || '';
      if (ct.includes('image')) {
        return url;
      }
    }
    return '';
  } catch {
    return '';
  }
}
