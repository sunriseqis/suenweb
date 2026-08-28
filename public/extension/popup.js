/**
 * SuenWeb — Popup
 */
const browser = globalThis.browser || (() => {
  const c = globalThis.chrome;
  if (!c) throw new Error('WebExtension API unavailable');
  const p = (fn, ctx) => (...args) => new Promise((resolve, reject) => {
    try {
      const ret = fn.call(ctx, ...args, (res) => {
        const err = c.runtime && c.runtime.lastError;
        err ? reject(new Error(err.message)) : resolve(res);
      });
      if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    } catch (e) { reject(e); }
  });
  return {
    storage: { local: { get: p(c.storage.local.get, c.storage.local), set: p(c.storage.local.set, c.storage.local) } },
    runtime: {
      sendMessage: p(c.runtime.sendMessage, c.runtime),
      onMessage: {
        addListener(fn) {
          c.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            Promise.resolve(fn(msg, sender)).then(sendResponse).catch(() => sendResponse());
            return true;
          });
        }
      },
    },
  };
})();

const els = {
  connDot:       document.getElementById('connDot'),
  serverStatus:  document.getElementById('serverStatus'),
  realtimeStatus:document.getElementById('realtimeStatus'),
  webdavStatus:  document.getElementById('webdavStatus'),
  lastBackup:    document.getElementById('lastBackup'),
  backupBtn:     document.getElementById('backupBtn'),
  restoreBtn:    document.getElementById('restoreBtn'),
  serverUrl:     document.getElementById('serverUrl'),
  authToken:     document.getElementById('authToken'),
  webdavUrl:     document.getElementById('webdavUrl'),
  webdavUser:    document.getElementById('webdavUser'),
  webdavPass:    document.getElementById('webdavPass'),
  saveWebdavBtn: document.getElementById('saveWebdavBtn'),
  testWebdavBtn: document.getElementById('testWebdavBtn'),
  result:        document.getElementById('resultBox'),
  restorePicker: document.getElementById('restorePicker'),
  restoreList:   document.getElementById('restoreList'),
  newtabToggle:  document.getElementById('newtabToggle'),
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso), diff = Date.now() - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff/60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff/3600000) + '小时前';
  return d.toLocaleDateString('zh-CN');
}

function showResult(msg, type) {
  els.result.className = 'msg show ' + type;
  els.result.textContent = msg;
  setTimeout(() => { els.result.className = 'msg'; }, 3000);
}

/* ── Toggles ── */
function toggleSection(id) {
  const ft = document.getElementById(id);
  const btn = document.getElementById(id.replace('Cfg','Toggle'));
  const open = !ft.classList.contains('open');
  ft.classList.toggle('open', open);
  btn.classList.toggle('open', open);
}

document.getElementById('serverToggle').onclick = () => toggleSection('serverCfg');
document.getElementById('webdavToggle').onclick = () => toggleSection('webdavCfg');

/* ── New Tab Toggle ── */
els.newtabToggle.onchange = async () => {
  const enabled = els.newtabToggle.checked;
  await browser.storage.local.set({ newtabEnabled: enabled });
  await browser.runtime.sendMessage({ action: 'updateNewtab', enabled });
  showResult(enabled ? '已设为新标签页' : '已恢复默认新标签', enabled ? 'g' : 'i');
};

/* ── Refresh ── */
async function refresh() {
  const d = await browser.storage.local.get([
    'serverUrl','authToken','lastSync','webdavUrl','webdavUser','webdavPass','lastBackupAt','newtabEnabled'
  ]);
  const editing = document.activeElement && (
    document.activeElement === els.serverUrl || document.activeElement === els.authToken ||
    document.activeElement === els.webdavUrl || document.activeElement === els.webdavUser ||
    document.activeElement === els.webdavPass
  );
  if (!editing) {
    els.serverUrl.value = d.serverUrl || '';
    els.authToken.value = '';
    els.authToken.placeholder = d.authToken ? '已保存；修改时输入访问密码' : '导航页密码';
    els.webdavUrl.value = d.webdavUrl || '';
    els.webdavUser.value = d.webdavUser || '';
    els.webdavPass.value = d.webdavPass || '';
  }

  // Server
  const srvOk = !!(d.serverUrl && d.authToken);
  els.serverStatus.textContent = srvOk ? d.serverUrl : '未配置';
  els.serverStatus.className = 'v ' + (srvOk ? 'g' : 'b');

  // WebDAV
  const wdOk = !!(d.webdavUrl && d.webdavUser);
  els.webdavStatus.textContent = wdOk ? '已配置' : '未配置';
  els.webdavStatus.className = 'v ' + (wdOk ? 'g' : 'm');
  els.backupBtn.disabled = !wdOk;
  els.restoreBtn.disabled = !wdOk;

  // Last backup
  els.lastBackup.textContent = d.lastBackupAt ? fmtTime(d.lastBackupAt) : '—';
  els.lastBackup.className = 'v ' + (d.lastBackupAt ? 'g' : 'm');

  // New Tab toggle
  const ntEnabled = !!d.newtabEnabled;
  els.newtabToggle.checked = ntEnabled;
  els.newtabToggle.disabled = !srvOk;

  // Connection
  try {
    const s = await browser.runtime.sendMessage({ action: 'getStatus' });
    if (s) {
      els.realtimeStatus.textContent = s.realtimeConnected ? '已连接' : '断开';
      els.realtimeStatus.className = 'v ' + (s.realtimeConnected ? 'g' : 'b');
      els.connDot.className = 'hdr-dot ' + (s.realtimeConnected ? 'online' : 'offline');
    }
  } catch { els.connDot.className = 'hdr-dot'; }
}

/* ── Backup ── */
els.backupBtn.onclick = async () => {
  showResult('备份中...', 'i');
  els.backupBtn.disabled = true;
  try {
    const r = await browser.runtime.sendMessage({ action: 'manualBackup' });
    if (r.ok) showResult('备份完成：' + r.name, 'g');
    else showResult(r.error || '备份失败', 'b');
  } catch(e) { showResult(e.message, 'b'); }
  els.backupBtn.disabled = false;
  refresh();
};

/* ── Restore ── */
els.restoreBtn.onclick = async () => {
  showResult('获取备份列表...', 'i');
  try {
    const r = await browser.runtime.sendMessage({ action: 'listBackups' });
    if (!r.ok) { showResult(r.error || '获取失败', 'b'); return; }
    if (!r.backups.length) { showResult('没有可用的备份', 'b'); return; }
    els.restorePicker.style.display = 'block';
    els.restoreList.textContent = '';
    r.backups.forEach((b, i) => {
      const div = document.createElement('div');
      div.className = 'ri';
      div.dataset.idx = i;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'rn';
      nameSpan.textContent = b.name;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'rs';
      sizeSpan.textContent = b.size + ' · ' + b.date;
      div.appendChild(nameSpan);
      div.appendChild(sizeSpan);
      els.restoreList.appendChild(div);
    });
    let sel = -1;
    els.restoreList.querySelectorAll('.ri').forEach(item => {
      item.onclick = () => {
        els.restoreList.querySelectorAll('.ri').forEach(x => x.classList.remove('sel'));
        item.classList.add('sel');
        sel = parseInt(item.dataset.idx);
        document.getElementById('confirmRestoreBtn').disabled = false;
      };
    });
    document.getElementById('confirmRestoreBtn').onclick = async () => {
      if (sel < 0) return;
      showResult('还原中...', 'i');
      try {
        const rr = await browser.runtime.sendMessage({ action: 'restoreBackup', index: sel });
        if (rr.ok) showResult('还原完成：' + rr.count + ' 个书签', 'g');
        else showResult(rr.error || '还原失败', 'b');
      } catch(e) { showResult(e.message, 'b'); }
      els.restorePicker.style.display = 'none';
      refresh();
    };
  } catch(e) { showResult(e.message, 'b'); }
};
document.getElementById('cancelRestoreBtn').onclick = () => { els.restorePicker.style.display = 'none'; };

/* ── Save ── */
document.getElementById('saveServerBtn').onclick = async () => {
  const url = els.serverUrl.value.trim().replace(/\/+$/, ''), pwd = els.authToken.value.trim();
  if (!url) { showResult('请填写服务器地址', 'b'); return; }
  try {
    const saved = await browser.storage.local.get(['authToken']);
    let token = saved.authToken || '';
    if (pwd) {
      const login = await browser.runtime.sendMessage({ action: 'loginServer', serverUrl: url, password: pwd });
      if (!login || !login.ok) throw new Error(login?.error || '登录失败');
      token = login.token;
    }
    if (!token) { showResult('请填写访问密码', 'b'); return; }
    await browser.runtime.sendMessage({ action: 'updateConfig', serverUrl: url, authToken: token,
      webdavUrl: els.webdavUrl.value.trim().replace(/\/+$/, ''),
      webdavUser: els.webdavUser.value.trim(), webdavPass: els.webdavPass.value.trim() });
    showResult('配置已保存', 'g'); refresh();
  } catch(e) { showResult(e.message, 'b'); }
};
document.getElementById('testServerBtn').onclick = async () => {
  const url = els.serverUrl.value.trim().replace(/\/+$/, '');
  if (!url) { showResult('请填写服务器地址', 'b'); return; }
  try {
    const saved = await browser.storage.local.get(['authToken']);
    const token = els.authToken.value.trim() || saved.authToken || '';
    const r = await fetch(url + '/api/sync/status', {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    if (r.ok) { const d = await r.json(); showResult('连接成功 · ' + (d.total_links||0) + ' 个链接', 'g'); }
    else showResult('服务器无响应', 'b');
  } catch(e) { showResult('无法连接', 'b'); }
};
document.getElementById('saveWebdavBtn').onclick = async () => {
  try {
    const saved = await browser.storage.local.get(['authToken']);
    await browser.runtime.sendMessage({ action: 'updateConfig',
      webdavUrl: els.webdavUrl.value.trim().replace(/\/+$/, ''),
      webdavUser: els.webdavUser.value.trim(), webdavPass: els.webdavPass.value.trim(),
      serverUrl: els.serverUrl.value.trim().replace(/\/+$/, ''),
      authToken: els.authToken.value.trim() || saved.authToken || '' });
    showResult('WebDAV 配置已保存', 'g'); refresh();
  } catch(e) { showResult(e.message, 'b'); }
};
els.testWebdavBtn.onclick = async () => {
  await browser.runtime.sendMessage({ action: 'updateConfig',
    webdavUrl: els.webdavUrl.value.trim().replace(/\/+$/, ''),
    webdavUser: els.webdavUser.value.trim(), webdavPass: els.webdavPass.value.trim() });
  showResult('测试中...', 'i'); els.testWebdavBtn.disabled = true;
  try {
    const r = await browser.runtime.sendMessage({ action: 'testWebDAV' });
    if (r.ok) showResult(r.writable === false ? '只读 (HTTP ' + r.status + ')' : 'WebDAV 连接成功', r.writable === false ? 'b' : 'g');
    else showResult(r.error || '连接失败', 'b');
  } catch(e) { showResult(e.message, 'b'); }
  els.testWebdavBtn.disabled = false;
};

/* ── Broadcast ── */
browser.runtime.onMessage.addListener(msg => {
  if (msg.kind === 'broadcast' && msg.payload?.type === 'connection') {
    els.realtimeStatus.textContent = msg.payload.connected ? '已连接' : '断开';
    els.realtimeStatus.className = 'v ' + (msg.payload.connected ? 'g' : 'b');
    els.connDot.className = 'hdr-dot ' + (msg.payload.connected ? 'online' : 'offline');
  }
});

refresh();
setInterval(refresh, 8000);
