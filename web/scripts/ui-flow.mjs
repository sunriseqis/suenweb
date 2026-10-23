// 用法：先启动后端（仓库根 npm run dev）与前端（npm --prefix web run dev），再执行本脚本。
// 依赖：npm i -D puppeteer && npx puppeteer browsers install chrome（或用系统 chromium 并设 PUPPETEER_EXECUTABLE_PATH）。
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://localhost:5173';
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(BASE + '/#/', { waitUntil: 'networkidle2' });
await page.evaluate(async () => {
  await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'demo-pass' }) });
});
await page.reload({ waitUntil: 'networkidle2' });
await sleep(800);
const authed = await page.evaluate(() => !Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === '登录'));
console.log('authed', authed);

// 1) 新建分组
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('新建分组'));
  btn.click();
});
await sleep(400);
const dialogOpen = await page.evaluate(() => Boolean(document.querySelector('[role=dialog]')));
console.log('group dialog open', dialogOpen);
await page.type('[role=dialog] input', '测试分组');
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[role=dialog] button')).find((b) => (b.textContent ?? '').includes('建组'));
  btn.click();
});
await sleep(1200);
const groupCreated = await page.evaluate(() => Array.from(document.querySelectorAll('section')).some((s) => (s.getAttribute('aria-label') ?? '') === '测试分组'));
console.log('group created', groupCreated);

// 2) 收一条新书签
await page.evaluate(() => {
  const section = Array.from(document.querySelectorAll('section')).find((s) => (s.getAttribute('aria-label') ?? '') === '测试分组');
  const btn = Array.from(section.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('加一条'));
  btn.click();
});
await sleep(500);
const drawerOpen = await page.evaluate(() => Boolean(document.querySelector('[role=complementary]')));
console.log('drawer open', drawerOpen);
await page.type('[role=complementary] input[type=url]', 'https://example.com/flow-test', { delay: 10 });
await page.type('[role=complementary] input:not([type=url])', '流程测试书签', { delay: 10 });
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[role=complementary] button')).find((b) => (b.textContent ?? '').includes('收藏'));
  btn.click();
});
await sleep(1500);
const linkCreated = await page.evaluate(() => document.body.textContent.includes('流程测试书签'));
console.log('link created', linkCreated);

// 3) 跨组重复 -> 弹窗 -> 忽略并不再提示
await page.evaluate(() => {
  const section = Array.from(document.querySelectorAll('section')).find((s) => (s.getAttribute('aria-label') ?? '') === '工具箱');
  const btn = Array.from(section.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('加一条'));
  btn.click();
});
await sleep(500);
await page.type('[role=complementary] input[type=url]', 'https://example.com/flow-test', { delay: 10 });
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[role=complementary] button')).find((b) => (b.textContent ?? '').includes('收藏'));
  btn.click();
});
await sleep(1500);
const dupDialog = await page.evaluate(() => ({
  open: Array.from(document.querySelectorAll('[role=dialog] h2')).some((h) => (h.textContent ?? '').includes('已经在别的分组里')),
  choices: Array.from(document.querySelectorAll('[role=dialog] button')).map((b) => (b.textContent ?? '').trim()),
}));
console.log('duplicate dialog', JSON.stringify(dupDialog));
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[role=dialog] button')).find((b) => (b.textContent ?? '').includes('忽略并不再提示'));
  btn.click();
});
await sleep(1600);
const afterIgnore = await page.evaluate(async () => {
  const res = await fetch('/api/dedupe/ignores');
  const json = await res.json();
  return { count: json.data ? json.data.ignores.length : -1 };
});
console.log('ignores count', afterIgnore.count);

// 4) 主题切换持久化
const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('header button')).find((b) => (b.getAttribute('title') ?? '').startsWith('主题'));
  btn.click();
});
await sleep(700);
const after = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, saved: localStorage.getItem('sw.theme') }));
console.log('theme switch', before, '->', after.bg, 'saved', after.saved);
await page.reload({ waitUntil: 'networkidle2' });
await sleep(600);
const persisted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
console.log('theme persisted', persisted);

// 5) ESC 关闭抽屉
await page.evaluate(() => {
  const section = document.querySelector('section');
  const btn = Array.from(section.querySelectorAll('button')).find((b) => (b.getAttribute('title') ?? '') === '编辑');
  btn.click();
});
await sleep(500);
await page.keyboard.press('Escape');
await sleep(400);
const drawerClosed = await page.evaluate(() => !document.querySelector('[role=complementary]'));
console.log('esc closes drawer', drawerClosed);

console.log('errors', errors.length, errors.slice(0, 3));
await browser.close();
