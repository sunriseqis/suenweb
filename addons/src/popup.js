// SuenWeb 弹窗：页面名 / 后端地址 / 分组（点即收藏）/ 心跳
const browser = globalThis.browser ?? globalThis.chrome;
const titleNode = document.getElementById('pageTitle');
const serverLine = document.getElementById('serverLine');
const groupsNode = document.getElementById('groups');
const loginBox = document.getElementById('loginBox');
const errorBox = document.getElementById('errorBox');
const beatNode = document.getElementById('beat');

let lastGroupId = null;

async function send(message) {
  const reply = await browser.runtime.sendMessage(message);
  if (!reply || reply.ok !== true) {
    const error = new Error(reply && reply.error ? reply.error : '操作失败');
    error.code = reply && reply.code ? reply.code : undefined;
    error.details = reply && reply.details ? reply.details : undefined;
    throw error;
  }
  return reply.data;
}

function setBeat(text, isError = false) {
  beatNode.textContent = text || '';
  beatNode.className = isError ? 'status error' : 'status';
}

function showOnly(which) {
  loginBox.hidden = which !== 'login';
  errorBox.hidden = which !== 'error';
  groupsNode.hidden = which !== 'groups';
}

async function capture(groupId) {
  try {
    const link = await send({ type: 'capture', groupId });
    await browser.storage.local.set({ lastGroupId: link.group_id });
    setBeat('已收藏到 ' + (link.group_name || '分组'));
    setTimeout(() => window.close(), 500);
  } catch (error) {
    if (error.code !== 'CROSS_GROUP_DUPLICATE' || !error.details) throw error;
    const where = error.details.existing ? error.details.existing.group_name : '其他分组';
    if (!window.confirm('该网址已存在于分组「' + where + '」。\n仍要再收藏一份吗？')) {
      setBeat('已跳过');
      return;
    }
    const link2 = await send({ type: 'capture', groupId, onDuplicate: 'allow' });
    await browser.storage.local.set({ lastGroupId: link2.group_id });
    setBeat('已收藏到 ' + (link2.group_name || '分组'));
    setTimeout(() => window.close(), 500);
  }
}

async function loadGroups() {
  const raw = await browser.storage.local.get({ baseUrl: '', token: '', lastGroupId: null });
  lastGroupId = raw.lastGroupId;
  if (raw.baseUrl) serverLine.textContent = raw.baseUrl;

  let cfg = { configured: Boolean(raw.baseUrl && raw.token), baseUrl: raw.baseUrl };
  try {
    const fromBg = await send({ type: 'config' });
    cfg = { configured: Boolean(fromBg.configured || cfg.configured), baseUrl: fromBg.baseUrl || cfg.baseUrl };
  } catch {
    // 用 storage 的判断即可
  }
  if (!cfg.configured) {
    serverLine.textContent = cfg.baseUrl || '未连接';
    showOnly('login');
    setBeat('');
    return;
  }
  serverLine.textContent = cfg.baseUrl;

  let data;
  try {
    data = await send({ type: 'groups' });
  } catch (error) {
    showOnly(error.code === 'UNAUTHENTICATED' ? 'login' : 'error');
    setBeat(error.message, true);
    return;
  }

  const groups = (data && data.groups) || [];
  groupsNode.textContent = '';
  if (groups.length === 0) {
    showOnly('error');
    setBeat('服务端还没有分组', true);
    return;
  }
  const ordered = [...groups].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'fixed' ? -1 : 1;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });
  for (const group of ordered) {
    const btn = document.createElement('button');
    btn.className = 'group-btn' + (group.id === lastGroupId ? ' last' : '');
    btn.type = 'button';
    const name = document.createElement('span');
    name.className = 'g-name';
    name.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'g-count';
    count.textContent = String(group.links.length);
    btn.append(name, count);
    btn.addEventListener('click', async () => {
      groupsNode.querySelectorAll('button').forEach((node) => (node.disabled = true));
      try {
        await capture(group.id);
      } catch (error) {
        setBeat(error.message, true);
      } finally {
        groupsNode.querySelectorAll('button').forEach((node) => (node.disabled = false));
      }
    });
    groupsNode.appendChild(btn);
  }
  showOnly('groups');
}

async function loadBeat() {
  try {
    const status = await send({ type: 'status' });
    const parts = [];
    if (status.lastHeartbeat) {
      const d = new Date(status.lastHeartbeat);
      const diff = Date.now() - d.getTime();
      const online = diff < 11 * 60 * 1000;
      parts.push((online ? '在线 · ' : '离线 · ') + d.toLocaleTimeString());
    } else {
      parts.push('未连接');
    }
    if (status.pending) parts.push('待同步 ' + status.pending);
    if (status.failed) parts.push('失败 ' + status.failed);
    setBeat(parts.join(' · '));
  } catch {
    setBeat('');
  }
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) titleNode.textContent = tab.title || '未命名页面';
  await loadGroups();
  await loadBeat();
}

document.getElementById('openOptions').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});
document.getElementById('goLogin').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});
document.getElementById('retryBtn').addEventListener('click', () => {
  showOnly('groups');
  setBeat('');
  void loadGroups().then(loadBeat);
});

init();
