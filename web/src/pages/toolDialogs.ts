// v6 设置页复用工具弹窗：全部走现有 overlay 体系；输入只在弹窗内，页面零输入框。
import { api, type ImportPreview } from '../lib/api.ts';
import { el } from '../lib/dom.ts';
import { button } from '../ui/button.ts';
import { field } from '../ui/field.ts';
import { openDialog, overlayActions } from '../ui/overlay.ts';

type Done = (message: string) => void;
type Fail = (message: string) => void;

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

async function readBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function filePicker(accept: string): HTMLInputElement {
  return el('input', { type: 'file', accept, class: 'w-full text-[12px] text-fg' }) as HTMLInputElement;
}

function cancel(handle: { close: () => void }): HTMLElement {
  return button({ label: '取消', variant: 'ghost', size: 'sm', onClick: () => handle.close() });
}

/** 提交防重复：执行期间禁用按钮，异常路径也在 finally 恢复 */
function guardClick(fn: (event: MouseEvent) => Promise<void>): (event: MouseEvent) => void {
  return (event) => {
    const btn = event.currentTarget as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    void fn(event).finally(() => {
      btn.disabled = false;
    });
  };
}

/** 导入书签 HTML：选文件 → 预览统计 → 确认导入 */
export function openImportBookmarksDialog(done: Done, fail: Fail): void {
  const handle = openDialog({ title: '导入书签', subtitle: '支持浏览器导出的 Netscape HTML；同名文件夹自动合并，归一化去重' });
  const picker = filePicker('.html,.htm,.json');
  const previewBox = el('div', { class: 'space-y-1 text-[12px] text-fg' });
  const actions = el('div', { class: 'flex flex-wrap gap-1.5' });
  let html = '';

  actions.append(
    button({
      label: '预览', iconName: 'search', variant: 'secondary', size: 'sm',
      onClick: guardClick(async () => {
        const file = picker.files?.[0];
        if (!file) { fail('先选择书签导出的 HTML 文件'); return; }
        try {
          html = await readTextFile(file);
          const result = await api.importPreview(html);
          if (!result.ok) { fail(result.error.message); return; }
          const pv: ImportPreview = result.data;
          previewBox.textContent = '';
          previewBox.appendChild(el('p', { class: 'font-semibold', text: '共 ' + pv.grandTotal + ' 条 / ' + pv.folders.length + ' 组：新增 ' + pv.newTotal + '，文件内重复 ' + pv.duplicateInFile + '，库内已存在 ' + pv.existsAnywhere + (pv.parseInvalid ? '，非法链接 ' + pv.parseInvalid : '') }));
          for (const folder of pv.folders) {
            previewBox.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: folder.name + '：' + folder.total + ' 条 → 新增 ' + folder.new_links }));
          }
        } catch (err) { fail((err as Error).message); }
      }),
    }),
    button({
      label: '导入', iconName: 'plus', variant: 'primary', size: 'sm',
      onClick: guardClick(async () => {
        if (!html) { fail('先点「预览」确认内容'); return; }
        const result = await api.importCommit(html);
        if (!result.ok) { fail(result.error.message); return; }
        const r = result.data;
        handle.close();
        done('导入完成：' + r.groupsCreated + ' 新组 / ' + r.groupsMerged + ' 合并组，' + r.linksCreated + ' 新链接，跳过 ' + r.linksSkipped);
      }),
    }),
  );
  handle.body.append(picker, actions, previewBox);
}

/** 导出加密配置：输管理密码 → 下载 .swb1 */
export function openExportConfigDialog(done: Done, fail: Fail): void {
  const handle = openDialog({ title: '导出加密配置', subtitle: '密钥由管理密码派生（SWB1 格式），导出文件不泄露任何明文' });
  const pw = field({ label: '管理密码', type: 'password', autocomplete: 'current-password' });
  handle.body.append(
    pw.wrapper,
    overlayActions(
      button({
        label: '导出', iconName: 'shield', variant: 'primary', size: 'sm',
        onClick: guardClick(async () => {
          const password = (pw.input as HTMLInputElement).value;
          if (!password) { fail('先输入管理密码'); return; }
          const result = await api.configExport(password);
          if (!result.ok) { fail(result.error.message); return; }
          const blob = new Blob([atob(result.data.file)], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'suenweb-config-' + new Date().toISOString().slice(0, 10) + '.swb1';
          a.click();
          URL.revokeObjectURL(url);
          handle.close();
          done('已导出：' + result.data.groups + ' 组 / ' + result.data.links + ' 链接（SWB1 加密）');
        }),
      }),
      cancel(handle),
    ),
  );
}

/** 还原加密配置：选文件 + 输密码 + 覆盖预览 + 二次确认 */
export function openRestoreConfigDialog(done: Done, fail: Fail): void {
  const handle = openDialog({ title: '还原加密配置', subtitle: '覆盖恢复全部分组与链接；密码错误或文件损坏不会修改任何数据' });
  const picker = filePicker('.swb1');
  const pw = field({ label: '管理密码', type: 'password', autocomplete: 'current-password' });
  handle.body.append(
    picker,
    pw.wrapper,
    overlayActions(
      button({
        label: '还原', iconName: 'refresh', variant: 'primary', size: 'sm',
        onClick: guardClick(async () => {
          const file = picker.files?.[0];
          const password = (pw.input as HTMLInputElement).value;
          if (!file || !password) { fail('选择 .swb1 文件并输入管理密码'); return; }
          const fileB64 = await readBase64(file);
          const check = await api.configImportCheck(password, fileB64);
          if (!check.ok) { fail(check.error.message); return; }
          const info = check.data;
          if (!window.confirm('备份含 ' + info.groups + ' 组 / ' + info.links + ' 条链接（导出于 ' + (info.exportedAt ?? '未知时间') + '）。\n还原会覆盖现有全部分组与链接，确定继续？')) return;
          const result = await api.configImport(password, fileB64);
          if (!result.ok) { fail(result.error.message); return; }
          const r = result.data.restored;
          handle.close();
          done('还原完成：' + r.groupsCreated + ' 组 / ' + r.linksCreated + ' 链接');
        }),
      }),
      cancel(handle),
    ),
  );
}

/** 检查重复：聚类列表 + 逐簇删除 */
export function openDuplicatesDialog(done: Done, fail: Fail): void {
  const handle = openDialog({ title: '检查重复链接', subtitle: '全库按归一化网址聚类；归一化会去掉 utm 等跟踪参数' });
  const box = el('div', { class: 'space-y-2 text-[12px] text-fg' });
  handle.body.append(box, overlayActions(cancel(handle)));
  box.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '检测中…' }));

  void (async () => {
    const result = await api.duplicates();
    box.textContent = '';
    if (!result.ok) { fail(result.error.message); return; }
    if (result.data.total === 0) {
      box.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '没有跨组重复。' }));
      return;
    }
    for (const cluster of result.data.duplicates) {
      const line = el('div', { class: 'border-l-2 border-[var(--c-line-strong)] pl-2' },
        el('p', { class: 'truncate text-[12px]', text: cluster.url_normalized + '（' + cluster.occurrences.length + ' 处）' }),
      );
      for (const occ of cluster.occurrences) {
        line.appendChild(el('p', { class: 'truncate text-[11px] text-[var(--c-fg-soft)]', text: '· ' + occ.group_name + ' / ' + occ.title }));
      }
      line.appendChild(button({
        label: '保留第一条，删其余', variant: 'ghost', size: 'xs',
        onClick: guardClick(async () => {
          const ids = cluster.occurrences.slice(1).map((o) => o.id);
          const del = await api.deleteDuplicates(ids);
          if (del.ok) { handle.close(); done('已删除 ' + del.data.deleted + ' 条重复'); }
          else fail(del.error.message);
        }),
      }));
      box.appendChild(line);
    }
  })();
}

/** 检查失效：进度 → 结果 → 删全部失效 */
export function openDeadLinksDialog(done: Done, fail: Fail): void {
  const handle = openDialog({ title: '失效链接检测', subtitle: '批量探活（6s 超时），结果自动保存可复查' });
  const box = el('div', { class: 'space-y-1 text-[12px] text-fg' });
  handle.body.append(box);
  box.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '检测中…（最近 200 条）' }));

  void (async () => {
    const result = await api.checkLinks(200);
    box.textContent = '';
    if (!result.ok) { fail(result.error.message); return; }
    box.appendChild(el('p', { class: 'font-semibold', text: '检查 ' + result.data.checked + ' 条，失效 ' + result.data.deadCount + ' 条。' }));
    for (const dead of result.data.dead) {
      box.appendChild(el('p', { class: 'truncate text-[11px] text-[var(--c-fg-soft)]', text: '· [' + (dead.status ?? '无响应') + '] ' + dead.group_name + ' / ' + dead.title }));
    }
    if (result.data.deadCount > 0) {
      box.appendChild(button({
        label: '删除全部失效项', iconName: 'trash', variant: 'primary', size: 'xs',
        onClick: guardClick(async () => {
          const del = await api.deleteDead(result.data.dead.map((d) => d.id));
          if (del.ok) { handle.close(); done('已删除 ' + del.data.deleted + ' 条失效链接'); }
          else fail(del.error.message);
        }),
      }));
    }
  })();
}

/** WebDAV 配置：五框全进弹窗 */
export function openWebDavConfigDialog(done: Done, fail: Fail, onChanged: () => Promise<void> | void): void {
  const handle = openDialog({ title: '配置 WebDAV 备份', subtitle: '配置后每日自动加密上传并按份数轮转；未配置则不做任何备份' });
  const url = field({ label: 'WebDAV 地址', type: 'url', placeholder: 'https://dav.example.com/dav/' });
  const user = field({ label: '用户名', type: 'text', autocomplete: 'off' });
  const pass = field({ label: 'WebDAV 密码', type: 'password', autocomplete: 'off' });
  const keep = field({ label: '保留份数（自动备份轮转）', type: 'text' });
  const admin = field({ label: '管理密码（初始化备份密钥用）', type: 'password', autocomplete: 'current-password' });
  handle.body.append(
    url.wrapper, user.wrapper, pass.wrapper, keep.wrapper, admin.wrapper,
    overlayActions(
      button({
        label: '保存并测试', iconName: 'check', variant: 'primary', size: 'sm',
        onClick: guardClick(async () => {
          const address = (url.input as HTMLInputElement).value.trim();
          const username = (user.input as HTMLInputElement).value.trim();
          const password = (pass.input as HTMLInputElement).value;
          const keepCount = Number((keep.input as HTMLInputElement).value) || 30;
          const adminPassword = (admin.input as HTMLInputElement).value;
          if (!address || !adminPassword) { fail('填 WebDAV 地址与管理密码'); return; }
          const result = await api.backupConfig({ url: address, username, password, keepCount, adminPassword });
          if (!result.ok) { fail(result.error.message); return; }
          if (!result.data.writable) { fail('连通但不可写：' + (result.data.error ?? '')); return; }
          await onChanged();
          handle.close();
          done('WebDAV 已配置，自动备份已开启');
        }),
      }),
      cancel(handle),
    ),
  );
}

/** 还原备份：列表 + 选中 + 输密码 + 确认覆盖 */
export function openRestoreBackupDialog(done: Done, fail: Fail, onChanged: () => Promise<void> | void): void {
  const handle = openDialog({ title: '还原备份', subtitle: '远端备份列表；选中后输入管理密码即可还原（覆盖现有数据）' });
  const list = el('div', { class: 'space-y-1 text-[12px] text-fg' });
  const pw = field({ label: '管理密码', type: 'password', autocomplete: 'current-password' });
  let selected: string | null = null;
  handle.body.append(list, pw.wrapper);

  void (async () => {
    const result = await api.backupList();
    list.textContent = '';
    if (!result.ok) { fail(result.error.message); return; }
    if (result.data.backups.length === 0) {
      list.appendChild(el('p', { class: 'text-[11px] text-[var(--c-fg-soft)]', text: '远端还没有备份文件。' }));
      return;
    }
    for (const item of [...result.data.backups].reverse()) {
      const line = el('div', {
        class: 'backup-line flex cursor-pointer items-center justify-between gap-2 border-l-2 border-[var(--c-line-strong)] pl-2',
      },
        el('p', { class: 'min-w-0 truncate text-[12px]', text: item.name + '（' + Math.round(item.size / 1024) + ' KB · ' + (item.lastModified ?? '') + '）' }),
      );
      line.addEventListener('click', () => {
        selected = item.name;
        list.querySelectorAll('.backup-line').forEach((n) => n.classList.remove('bg-[var(--c-accent-soft)]'));
        line.classList.add('bg-[var(--c-accent-soft)]');
      });
      list.appendChild(line);
    }
  })();

  handle.body.append(
    overlayActions(
      button({
        label: '还原选中备份', iconName: 'refresh', variant: 'primary', size: 'sm',
        onClick: guardClick(async () => {
          const password = (pw.input as HTMLInputElement).value;
          if (!selected) { fail('先在列表里选中一份备份'); return; }
          if (!password) { fail('输入管理密码'); return; }
          const dl = await api.backupDownload(selected, password);
          if (!dl.ok) { fail(dl.error.message); return; }
          const snap = dl.data.snapshot;
          const total = snap.groups.reduce((sum, g) => sum + g.links.length, 0);
          if (!window.confirm('备份含 ' + snap.groups.length + ' 组 / ' + total + ' 条链接。\n还原会覆盖现有全部分组与链接，确定继续？')) return;
          const result = await api.configImportFromSnapshot(password, { groups: snap.groups });
          if (!result.ok) { fail(result.error.message); return; }
          const r = result.data.restored;
          await onChanged();
          handle.close();
          done('还原完成：' + r.groupsCreated + ' 组 / ' + r.linksCreated + ' 链接');
        }),
      }),
      cancel(handle),
    ),
  );
}

/** 修改密码：两框进弹窗 */
export function openChangePasswordDialog(fail: Fail, submit: (current: string, next: string) => Promise<boolean>): void {
  const handle = openDialog({ title: '修改密码', subtitle: '至少 6 位；改密后其他设备的会话立即失效' });
  const current = field({ label: '当前密码', type: 'password', autocomplete: 'current-password' });
  const next = field({ label: '新密码（最短 6 位）', type: 'password', autocomplete: 'new-password' });
  handle.body.append(
    current.wrapper, next.wrapper,
    overlayActions(
      button({
        label: '修改', iconName: 'shield', variant: 'primary', size: 'sm',
        onClick: guardClick(async () => {
          const c = (current.input as HTMLInputElement).value;
          const n = (next.input as HTMLInputElement).value;
          if (n.length < 6) { fail('新密码至少 6 位'); return; }
          const ok = await submit(c, n);
          if (ok) handle.close();
        }),
      }),
      cancel(handle),
    ),
  );
}

/** 刷新站点图标：输域名 → 清缓存并重抓 */
export function openIconRefreshDialog(done: Done, fail: Fail): void {
  const handle = openDialog({ title: '刷新站点图标', subtitle: '站点换了图标或之前抓取失败被负缓存时使用；输入域名清除缓存并立即重抓' });
  const domain = field({ label: '域名', type: 'text', placeholder: 'example.com' });
  handle.body.append(
    domain.wrapper,
    overlayActions(
      button({
        label: '刷新', iconName: 'refresh', variant: 'primary', size: 'sm',
        onClick: guardClick(async () => {
          const host = (domain.input as HTMLInputElement).value.trim().toLowerCase();
          if (!host) { fail('输入域名，例如 example.com'); return; }
          const result = await api.iconRefresh(host);
          if (!result.ok) { fail(result.error.message); return; }
          handle.close();
          done(result.data.refetched ? '已清除缓存并重抓：' + (result.data.status ?? '') : '已清除旧缓存');
        }),
      }),
      cancel(handle),
    ),
  );
}
