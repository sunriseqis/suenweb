const baseUrlInput = document.getElementById('baseUrl');
const passwordInput = document.getElementById('password');
const statusNode = document.getElementById('status');
const loginButton = document.getElementById('login');
const syncButton = document.getElementById('sync');

function setStatus(text, isError = false) {
  statusNode.textContent = text;
  statusNode.className = isError ? 'status error' : 'status';
}

async function load() {
  const stored = await browser.storage.local.get({ baseUrl: '', token: '' });
  baseUrlInput.value = stored.baseUrl || '';
  if (stored.token) setStatus('已保存登录状态');
}

loginButton.addEventListener('click', async () => {
  const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, '');
  const password = passwordInput.value;
  if (!baseUrl) return setStatus('先填服务端地址', true);
  if (password.length < 6) return setStatus('密码至少 6 位', true);
  loginButton.disabled = true;
  setStatus('登录中…');
  try {
    await browser.storage.local.set({ baseUrl });
    const response = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, device: 'firefox-extension' }),
    });
    const payload = await response.json().catch(() => null);
    if (!payload || payload.ok !== true) {
      throw new Error(payload && payload.error ? payload.error.message : '登录失败');
    }
    await browser.storage.local.set({ token: payload.data.token, baseUrl });
    passwordInput.value = '';
    setStatus('已登录，token 已保存');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    loginButton.disabled = false;
  }
});

syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  setStatus('同步中…');
  try {
    const reply = await browser.runtime.sendMessage({ type: 'sync' });
    if (!reply || reply.ok !== true) throw new Error(reply && reply.error ? reply.error : '同步失败');
    setStatus('同步完成：成功 ' + (reply.data.synced || 0) + '，失败 ' + (reply.data.failed || 0));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    syncButton.disabled = false;
  }
});

load();
