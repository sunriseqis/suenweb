// SuenWeb 设置页：未登录只显示地址/密码/登录·测试；已登录换成地址 + 登出/插件备份/插件还原/首页开关
import { ensureHostPermission, normalizeBaseUrl } from './api.js';

const browser = globalThis.browser ?? globalThis.chrome;

const loginForm = document.getElementById('loginForm');
const accountBox = document.getElementById('accountBox');
const baseUrlInput = document.getElementById('baseUrl');
const passwordInput = document.getElementById('password');
const serverLine = document.getElementById('serverLine');
const newtabToggle = document.getElementById('newtab');
const statusNode = document.getElementById('status');
const loginBtn = document.getElementById('login');
const testBtn = document.getElementById('test');
const logoutBtn = document.getElementById('logout');
const extBackupBtn = document.getElementById('extBackup');
const extRestoreBtn = document.getElementById('extRestore');

function setStatus(text, isError = false) {
  statusNode.textContent = text || '';
  statusNode.className = isError ? 'status error' : 'status';
}

async function send(message) {
  const reply = await browser.runtime.sendMessage(message);
  if (!reply || reply.ok !== true) throw new Error(reply && reply.error ? reply.error : '操作失败');
  return reply.data;
}

/** 按登录态切换两块 UI */
async function refresh() {
  const stored = await browser.storage.local.get({ baseUrl: '', token: '', newtabEnabled: false });
  const loggedIn = Boolean(stored.baseUrl && stored.token);
  loginForm.hidden = loggedIn;
  accountBox.hidden = !loggedIn;
  if (loggedIn) serverLine.textContent = stored.baseUrl;
  else baseUrlInput.value = stored.baseUrl || '';
  newtabToggle.checked = Boolean(stored.newtabEnabled);
}

/** 测试连通性：只打 /api/health，不写入任何状态 */
async function runTest() {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value || (await browser.storage.local.get({ baseUrl: '' })).baseUrl);
  if (!baseUrl) {
    setStatus('地址不合法，应为 http://IP:端口', true);
    return;
  }
  testBtn.disabled = true;
  setStatus('测试中…');
  try {
    const granted = await ensureHostPermission(baseUrl);
    if (!granted) {
      setStatus('未授予该站点访问权限', true);
      return;
    }
    const response = await fetch(baseUrl + '/api/health', { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus('服务端返回 HTTP ' + response.status, true);
      return;
    }
    setStatus('连通 · ' + (body && body.data && body.data.version ? body.data.version : 'HTTP ' + response.status));
  } catch (error) {
    setStatus('不通 · ' + (error && error.message ? error.message : 'NetworkError'), true);
  } finally {
    testBtn.disabled = false;
  }
}

loginBtn.addEventListener('click', async () => {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  const password = passwordInput.value;
  if (!baseUrl) {
    setStatus('地址不合法，应为 http://IP:端口', true);
    return;
  }
  if (password.length < 6) {
    setStatus('密码至少 6 位', true);
    return;
  }
  loginBtn.disabled = true;
  setStatus('登录中…');
  try {
    const granted = await ensureHostPermission(baseUrl);
    if (!granted) {
      setStatus('未授予该站点访问权限，浏览器会拦截请求', true);
      return;
    }
    let response;
    try {
      response = await fetch(baseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, device: 'firefox-extension' }),
      });
    } catch (error) {
      setStatus('连不上 ' + baseUrl + '（' + (error && error.message ? error.message : 'NetworkError') + '）', true);
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!payload || payload.ok !== true) {
      setStatus(payload && payload.error ? payload.error.message : '登录失败（HTTP ' + response.status + '）', true);
      return;
    }
    await browser.storage.local.set({ baseUrl, token: payload.data.token });
    passwordInput.value = '';
    await refresh();
    setStatus('已登录');
    try {
      await send({ type: 'config-saved' });
    } catch {
      // background 休眠时忽略，下次点图标会自然生效
    }
  } finally {
    loginBtn.disabled = false;
  }
});

testBtn.addEventListener('click', () => void runTest());

logoutBtn.addEventListener('click', async () => {
  await browser.storage.local.remove('token');
  await refresh();
  setStatus('已登出');
  try {
    await send({ type: 'config-saved' });
  } catch {
    // 忽略
  }
});

extBackupBtn.addEventListener('click', async () => {
  extBackupBtn.disabled = true;
  setStatus('正在读取已装插件…');
  try {
    const result = await send({ type: 'report-extensions' });
    setStatus('已备份 ' + result.count + ' 个插件');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    extBackupBtn.disabled = false;
  }
});

extRestoreBtn.addEventListener('click', async () => {
  extRestoreBtn.disabled = true;
  setStatus('检查安装状态…');
  try {
    const result = await send({ type: 'restore-extensions' });
    if (!result.total) setStatus('云端暂无清单');
    else if (result.opened === 0 && result.skipped === 0) setStatus('全部已安装');
    else setStatus('已装 ' + result.installed + ' · 打开 ' + result.opened + (result.skipped ? ' · 未打开 ' + result.skipped : ''));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    extRestoreBtn.disabled = false;
  }
});

newtabToggle.addEventListener('change', async () => {
  await browser.storage.local.set({ newtabEnabled: newtabToggle.checked });
  setStatus(newtabToggle.checked ? '已开启' : '已关闭');
});

void refresh();
