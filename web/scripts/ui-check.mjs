// 用法：先启动后端（仓库根 npm run dev）与前端（npm --prefix web run dev），再执行本脚本。
// 依赖：npm i -D puppeteer && npx puppeteer browsers install chrome（或用系统 chromium 并设 PUPPETEER_EXECUTABLE_PATH）。
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'http://localhost:5173';

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

async function open(url, theme) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('sw.theme', t), theme);
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 900));
  return { page, errors };
}

// 1) 访客态首页（深色）
const guestDark = await open(BASE + '/#/', 'dark');
const g = guestDark.page;
check('guest: 无控制台错误', guestDark.errors.length === 0, guestDark.errors.join(' | ').slice(0, 200));
const guestInfo = await g.evaluate(() => ({
  bg: getComputedStyle(document.body).backgroundColor,
  sections: document.querySelectorAll('section').length,
  cards: document.querySelectorAll('section .panel').length,
  banner: Array.from(document.querySelectorAll('div')).some((n) => (n.textContent ?? '').includes('游客模式')),
  heroFont: getComputedStyle(document.querySelector('h1')).fontFamily,
  heroBorder: getComputedStyle(document.querySelector('header')).borderTopWidth,
  cardShadow: (() => { const c = document.querySelector('section .panel'); return c ? getComputedStyle(c).boxShadow : 'none'; })(),
  gradientAnim: (() => { const n = document.querySelector('.anim-gradient'); return n ? getComputedStyle(n).animationName : 'none'; })(),
  contentAnim: (() => { const c = document.querySelector('section .panel'); return c ? getComputedStyle(c).animationName : 'none'; })(),
  unlabeledButtons: Array.from(document.querySelectorAll('button')).filter((b) => !((b.textContent ?? '').trim() || b.getAttribute('aria-label') || b.getAttribute('title'))).length,
}));
check('guest: 有分组区块', guestInfo.sections >= 4, String(guestInfo.sections));
check('guest: 有书签卡片', guestInfo.cards >= 9, String(guestInfo.cards));
check('guest: 顶部只读提示条', guestInfo.banner === true, String(guestInfo.banner));
check('guest: 标题字体含 Outfit', guestInfo.heroFont.includes('Outfit'), guestInfo.heroFont.slice(0, 80));
check('guest: Hero 边框 4px', guestInfo.heroBorder === '4px', guestInfo.heroBorder);
check('guest: 卡片多层阴影', guestInfo.cardShadow.split('rgb').length >= 2, guestInfo.cardShadow.slice(0, 90));
check('guest: 半功率档下渐变标题仍在动', guestInfo.gradientAnim === 'gradient-shift', guestInfo.gradientAnim);
check('guest: 半功率档下内容卡无持续动画', guestInfo.contentAnim === 'none', guestInfo.contentAnim);
check('guest: 所有按钮都有可访问名称', guestInfo.unlabeledButtons === 0, String(guestInfo.unlabeledButtons));
check('dark: 背景 #0D0D1A', guestInfo.bg === 'rgb(13, 13, 26)', guestInfo.bg);
await g.close();

// 2) 浅色主题
const light = await open(BASE + '/#/', 'light');
const lightInfo = await light.page.evaluate(() => ({
  bg: getComputedStyle(document.body).backgroundColor,
  fg: getComputedStyle(document.body).color,
  cardBorder: (() => { const c = document.querySelector('section .panel'); return c ? getComputedStyle(c).borderTopColor : ''; })(),
  cardShadow: (() => { const c = document.querySelector('section .panel'); return c ? getComputedStyle(c).boxShadow : 'none'; })(),
}));
check('light: 奶油白背景 #FFF7EE', lightInfo.bg === 'rgb(255, 247, 238)', lightInfo.bg);
check('light: 正文近黑深紫', lightInfo.fg === 'rgb(23, 15, 43)', lightInfo.fg);
check('light: 卡片仍是撞色边框', lightInfo.cardBorder !== 'rgb(255, 247, 238)', lightInfo.cardBorder);
check('light: 多层阴影保留', lightInfo.cardShadow.split('rgb').length >= 2, lightInfo.cardShadow.slice(0, 90));
await light.page.close();

// 3) 登录页（满功率）
const login = await open(BASE + '/#/login', 'dark');
const loginInfo = await login.page.evaluate(() => ({
  hasPassword: Boolean(document.querySelector('input[type=password]')),
  floaters: document.querySelectorAll('[data-decor]').length,
  bigWord: Array.from(document.querySelectorAll('span')).some((n) => ['HELLO', 'AGAIN'].includes((n.textContent ?? '').trim())),
  decorAnim: (() => { const n = document.querySelector('[data-decor]'); return n ? getComputedStyle(n).animationName : 'none'; })(),
}));
check('login: 有密码输入框', loginInfo.hasPassword, String(loginInfo.hasPassword));
check('login: 至少 6 个漂浮装饰', loginInfo.floaters >= 6, String(loginInfo.floaters));
check('login: 巨型背景字', loginInfo.bigWord === true, String(loginInfo.bigWord));
check('login: 满功率档装饰在动', loginInfo.decorAnim !== 'none', loginInfo.decorAnim);
check('login: 无控制台错误', login.errors.length === 0, login.errors.join(' | ').slice(0, 200));
await login.page.close();

// 4) 设置页
const settings = await open(BASE + '/#/settings', 'dark');
const settingsInfo = await settings.page.evaluate(() => ({
  themeButtons: Array.from(document.querySelectorAll('button')).filter((b) => ['跟随系统', '浅色', '深色'].some((t) => (b.textContent ?? '').includes(t))).length,
  calmToggle: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('降噪')),
  sections: document.querySelectorAll('section, .panel').length,
}));
check('settings: 三个主题按钮', settingsInfo.themeButtons >= 3, String(settingsInfo.themeButtons));
check('settings: 有降噪开关', settingsInfo.calmToggle === true, String(settingsInfo.calmToggle));
check('settings: 无控制台错误', settings.errors.length === 0, settings.errors.join(' | ').slice(0, 200));
await settings.page.close();

// 5) 移动端（390 宽，浅色）
const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await mobile.evaluateOnNewDocument(() => localStorage.setItem('sw.theme', 'light'));
await mobile.goto(BASE + '/#/', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));
const mobileInfo = await mobile.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bannerVisible: Array.from(document.querySelectorAll('div')).some((n) => (n.textContent ?? '').includes('游客模式')),
  minTap: Math.min(...Array.from(document.querySelectorAll('button')).map((b) => b.getBoundingClientRect().height || 999)),
}));
check('mobile: 无横向滚动', mobileInfo.overflowX <= 0, String(mobileInfo.overflowX));
check('mobile: 只读条仍在', mobileInfo.bannerVisible === true, String(mobileInfo.bannerVisible));
check('mobile: 按钮高度 >= 40px', mobileInfo.minTap >= 40, String(Math.round(mobileInfo.minTap)));
await mobile.close();

await browser.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  -> ' + r.detail);
console.log('---');
console.log('total', results.length, 'failed', failed.length);
process.exit(failed.length === 0 ? 0 : 1);
