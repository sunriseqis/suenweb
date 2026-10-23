const titleNode = document.getElementById('pageTitle');
const urlNode = document.getElementById('pageUrl');
const groupNode = document.getElementById('group');
const statusNode = document.getElementById('status');
const saveButton = document.getElementById('save');
const syncButton = document.getElementById('sync');

function setStatus(text, isError = false) {
  statusNode.textContent = text;
  statusNode.className = isError ? 'status error' : 'status';
}

async function send(message) {
  const reply = await browser.runtime.sendMessage(message);
  if (!reply || reply.ok !== true) throw new Error(reply && reply.error ? reply.error : '操作失败');
  return reply.data;
}

async function loadGroups() {
  try {
    const data = await send({ type: 'groups' });
    const groups = data.groups || [];
    groupNode.innerHTML = '';
    if (groups.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '还没有分组';
      groupNode.appendChild(option);
      return;
    }
    const ordered = [...groups].sort((a, b) => (a.type === 'fixed' ? -1 : 0) - (b.type === 'fixed' ? -1 : 0));
    for (const group of ordered) {
      const option = document.createElement('option');
      option.value = String(group.id);
      option.textContent = group.name + '（' + group.links.length + '）';
      groupNode.appendChild(option);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadStatus() {
  try {
    const status = await send({ type: 'status' });
    const parts = [];
    if (status.pending) parts.push('待同步 ' + status.pending);
    if (status.failed) parts.push('失败 ' + status.failed);
    if (status.lastHeartbeat) parts.push('上次心跳 ' + new Date(status.lastHeartbeat).toLocaleTimeString());
    setStatus(parts.length ? parts.join(' · ') : '已与服务端同步');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    titleNode.textContent = tab.title || '未命名页面';
    urlNode.textContent = tab.url || '';
  }
  await loadGroups();
  await loadStatus();
}

saveButton.addEventListener('click', async () => {
  saveButton.disabled = true;
  setStatus('收藏中…');
  try {
    const groupId = groupNode.value ? Number(groupNode.value) : null;
    const link = await send({ type: 'capture', groupId });
    setStatus('已收藏：' + link.title);
    setTimeout(() => window.close(), 700);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

syncButton.addEventListener('click', async () => {
  syncButton.disabled = true;
  setStatus('同步中…');
  try {
    const result = await send({ type: 'sync' });
    setStatus('同步完成：成功 ' + (result.synced || 0) + '，失败 ' + (result.failed || 0));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    syncButton.disabled = false;
  }
});

document.getElementById('openOptions').addEventListener('click', () => browser.runtime.openOptionsPage());

init();
