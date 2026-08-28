import { FontItem } from './types';

export function normalizeFontCss(rawCss: string, familyId: string): string {
  const baseLocal = `/api/font-woff?family=${familyId}&file=`;
  let css = rawCss;
  css = css.replace(
    /url\(\s*(["']?)(?!https?:|data:|\/api\/)([^"')\s]+)\1\s*\)/g,
    (_, quote, file) => `url(${baseLocal}${file.replace(/^\.\//, '')})`
  );
  css = css.replace(/\s*local\([^)]+\),?\s*/g, '');
  css = css.replace(/\s+format\([^)]+\)/g, '');
  return css;
}

export async function fetchFontCss(cdnUrl: string, fontId: string): Promise<string> {
  const res = await fetch(cdnUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch CDN CSS: HTTP ${res.status}`);
  }
  const raw = await res.text();
  return normalizeFontCss(raw, fontId);
}

export async function fetchFontWoff2(cdnUrl: string, fileName: string): Promise<ArrayBuffer> {
  const lastSlash = cdnUrl.lastIndexOf('/');
  const base = cdnUrl.substring(0, lastSlash + 1);
  const target = base + fileName;

  const res = await fetch(target, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch font file: HTTP ${res.status}`);
  }
  return await res.arrayBuffer();
}
