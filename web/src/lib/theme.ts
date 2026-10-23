export type ThemeMode = 'system' | 'light' | 'dark';
export type MotionTier = 'full' | 'half';

const THEME_KEY = 'sw.theme';
const TIER_KEY = 'sw.tier';
const CALM_KEY = 'sw.calm';

export function getThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(): void {
  const mode = getThemeMode();
  const dark = mode === 'dark' || (mode === 'system' && prefersDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme();
}

export function setTier(tier: MotionTier): void {
  localStorage.setItem(TIER_KEY, tier);
  document.documentElement.dataset.tier = tier;
}

export function isCalm(): boolean {
  return localStorage.getItem(CALM_KEY) === 'true';
}

export function setCalm(value: boolean): void {
  localStorage.setItem(CALM_KEY, String(value));
  document.documentElement.dataset.calm = String(value);
}

export function watchSystemTheme(onChange: () => void): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (getThemeMode() === 'system') onChange();
  });
}
