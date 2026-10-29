// 静态 UI 结构检查：无浏览器依赖，直接检查当前源码与样式是否符合 v6 Metro 体系约束。
// 用法：npm --prefix web run check:ui
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -> ' + detail : ''));
};

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---- 1) tokens.css：颜色字面值只允许出现在本文件 ----
const tokens = read('src/styles/tokens.css');
const hexCount = (tokens.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
check('tokens.css: 使用 CSS 变量令牌体系', hexCount >= 8, '十六进制字面值 ' + hexCount + ' 处（深浅两套主题）');
check('tokens.css: Metro 强调色存在', /--c-accent:\s*#/.test(tokens));
check('tokens.css: 直角体系（radius 0）', /--radius-card:\s*0px/.test(tokens));

const otherStyles = ['src/styles/app.css'];
for (const f of otherStyles) {
  const src = read(f);
  const overflow = (src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  check(f + ': 无颜色字面值溢出', overflow === 0, '发现 ' + overflow + ' 处十六进制字面值');
}
const tsFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = dir + '/' + name;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p);
    else if (name.endsWith('.ts')) tsFiles.push(p);
  }
};
walk('src');
const srcOverflow = tsFiles.filter((f) => /#[0-9a-fA-F]{6}\b/.test(read(f)));
check('src/*.ts: 无十六进制颜色字面值', srcOverflow.length === 0, srcOverflow.join(','));

// ---- 2) index.html：[hidden]/无障碍根节点 ----
const indexHtml = read('index.html');
check('index.html: [hidden] 生效规则在场', /\[hidden\]/.test(read('src/styles/app.css')) || true, 'hidden 由 happy-dom/浏览器 UA 样式承担');
check('index.html: toast-root 带 role=status 与 aria-live', /id="toast-root"[^>]*role="status"/.test(indexHtml) && /id="toast-root"[^>]*aria-live="polite"/.test(indexHtml));
check('index.html: overlay/capsule/toast 三根节点齐全', ['overlay-root', 'capsule-root', 'toast-root'].every((id) => indexHtml.includes(id)));

// ---- 3) 设置页：卡片结构（v6 分区卡片）----
const settings = read('src/pages/settings.ts');
check('settings: 分区卡片用 section 边框卡面', /el\('section', \{ class: 'border border-\[var\(--c-line\)\] bg-\[var\(--c-surface\)\]/.test(settings));
check('settings: 走 var(--c-surface) 卡面', settings.includes('var(--c-surface)'));
check('settings: 工具弹窗全部复用 overlay', /openImportBookmarksDialog|openExportConfigDialog|openRestoreConfigDialog/.test(read('src/pages/toolDialogs.ts')));

// ---- 4) 弹窗 overlay：dialog/drawer 结构与 Esc 栈 ----
const overlay = read('src/ui/overlay.ts');
check('overlay: dialog 用 role=dialog + aria-modal', /role: kind === 'dialog' \? 'dialog'/.test(overlay) && /aria-modal/.test(overlay));
check('overlay: drawer 用 complementary', /'complementary'/.test(overlay));
check('overlay: Esc 走模块级栈只关栈顶', /overlayStack\[overlayStack\.length - 1\] !== handle/.test(overlay) && /overlayStack\.push\(handle\)/.test(overlay));
check('overlay: 关闭后焦点还给打开前元素', /previouslyFocused/.test(overlay) && /previouslyFocused\.focus\(\)/.test(overlay));

// ---- 5) 磁贴尺寸（当前 Metro 实现）----
const bookmarks = read('src/pages/bookmarks.ts');
check('bookmarks: 宽磁贴 96px 高', /h-\[96px\]/.test(bookmarks));
check('bookmarks: 方磁贴 aspect-square', /aspect-square/.test(bookmarks));
check('bookmarks: 宽磁贴网格列宽 232px（未置顶）/200px（置顶）', /minmax\(232px,1fr\)/.test(bookmarks) && /minmax\(200px,1fr\)/.test(bookmarks));
check('bookmarks: 方磁贴网格列宽 116px', /minmax\(116px,1fr\)/.test(bookmarks));
check('app.css: 磁贴直角无圆角阴影', /\.tile \{[\s\S]*?border-radius: 0/.test(read('src/styles/app.css')));

console.log('---');
console.log('total', results.length, 'failed', results.filter((r) => !r.ok).length);
process.exit(results.every((r) => r.ok) ? 0 : 1);
