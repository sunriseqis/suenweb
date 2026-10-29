import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';
import { encryptBackup, decryptBackup } from '../src/infra/backupCrypto.ts';
import { parseBookmarksHtml, renderBookmarksHtml } from '../src/domain/bookmarkIo.ts';
import { commitImport, previewImport, restoreFullSnapshot } from '../src/domain/importExport.ts';

const SAMPLE_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<DL><p>
    <DT><H3>开发</H3>
    <DL><p>
        <DT><A HREF="https://github.com/">GitHub</A>
        <DT><A HREF="https://developer.mozilla.org/">MDN</A>
        <DT><A HREF="https://github.com/?utm_source=x">GitHub 重复</A>
    </DL><p>
    <DT><H3>开发</H3>
    <DL><p>
        <DT><A HREF="https://nodejs.org/">Node</A>
    </DL><p>
    <DT><H3>娱乐</H3>
    <DL><p>
        <DT><A HREF="javascript:void(0)">坏链接</A>
    </DL><p>
</DL><p>`;

test('SWB1 加密：正确密码可解、错误密码报 WRONG_PASSWORD、篡改报错（M13 异步 pbkdf2）', async () => {
  const cipher = await encryptBackup('passw0rd!', JSON.stringify({ hello: '世界' }));
  assert.equal(cipher.subarray(0, 4).toString('ascii'), 'SWB1');
  assert.equal(await decryptBackup('passw0rd!', cipher), JSON.stringify({ hello: '世界' }));
  await assert.rejects(() => decryptBackup('wrong-pass', cipher), (err: NodeJS.ErrnoException) => (err as { code?: string }).code === 'WRONG_PASSWORD');
  const tampered = Buffer.from(cipher);
  tampered[40] ^= 0xff;
  await assert.rejects(() => decryptBackup('passw0rd!', tampered), (err: NodeJS.ErrnoException) => (err as { code?: string }).code === 'WRONG_PASSWORD');
  await assert.rejects(() => decryptBackup('passw0rd!', Buffer.from('not a backup')), (err: NodeJS.ErrnoException) => (err as { code?: string }).code === 'CORRUPT_BACKUP');
});

test('HTML 解析：同名文件夹合并、非法 URL 计数、归一化去重', () => {
  const parsed = parseBookmarksHtml(SAMPLE_HTML);
  const names = parsed.folders.map((f) => f.name).sort();
  assert.deepEqual(names, ['娱乐', '开发']);
  const dev = parsed.folders.find((f) => f.name === '开发');
  assert.equal(dev?.items.length, 4, '同名组合并后 4 条（重复项保留到预览统计层去重）');
  assert.equal(parsed.invalid, 1);
  assert.equal(parsed.total, 4, 'total 只统计合法链接');
});

test('导入预览与提交：不入库、同名合并、去重生效', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  await setupAdmin(h.app);
  const parsed = parseBookmarksHtml(SAMPLE_HTML);
  const preview = await previewImport(h.db, parsed.folders);
  assert.equal(preview.grandTotal, 4);
  assert.equal(preview.newTotal, 3, 'GitHub utm 变体归一化后视为文件内重复');

  const result = await commitImport(h.db, parsed.folders, 'allow');
  assert.equal(result.groupsCreated, 2);
  assert.equal(result.groupsMerged, 0, '文件内同名已由解析层合并，这里无既有分组可合');
  assert.equal(result.linksCreated, 3);
  // 重复导入：全部跳过
  const again = await commitImport(h.db, parsed.folders, 'allow');
  assert.equal(again.linksCreated, 0);
});

test('导入接口：预览/提交/导出/访客 401', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);

  const guest = await h.app.inject({ method: 'POST', url: '/api/import/preview', payload: { html: SAMPLE_HTML } });
  assert.equal(guest.statusCode, 401);

  const preview = await h.app.inject({ method: 'POST', url: '/api/import/preview', payload: { html: SAMPLE_HTML }, headers: bearer(token) });
  assert.equal(preview.statusCode, 200);
  const pv = parse(preview).data;
  assert.equal(pv.grandTotal, 4);

  const commit = await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: SAMPLE_HTML }, headers: bearer(token) });
  assert.equal(commit.statusCode, 200);
  assert.equal(parse(commit).data.groupsCreated, 2);

  const data = await h.app.inject({ method: 'GET', url: '/api/data' });
  const groups = parse(data).data.groups;
  assert.equal(groups.length, 2);

  const exported = await h.app.inject({ method: 'GET', url: '/api/export/bookmarks', headers: bearer(token) });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.body, /NETSCAPE-Bookmark-file-1/);
  assert.match(String(exported.headers['content-disposition']), /attachment/);
  const round = parseBookmarksHtml(exported.body);
  assert.equal(round.folders.length, 2);
});

test('加密配置导出/导入：SWB1 往返、密码错误拒绝、确认后覆盖恢复', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const password = 'passw0rd!';
  const token = await setupAdmin(h.app, password);

  await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: SAMPLE_HTML }, headers: bearer(token) });

  // 缺密码
  const noPw = await h.app.inject({ method: 'POST', url: '/api/config/export', payload: {}, headers: bearer(token) });
  assert.equal(parse(noPw).error.code, 'PASSWORD_REQUIRED');
  // 错密码
  const badPw = await h.app.inject({ method: 'POST', url: '/api/config/export', payload: { password: 'nope-nope' }, headers: bearer(token) });
  assert.equal(parse(badPw).error.code, 'WRONG_PASSWORD');
  // 正确导出
  const exp = await h.app.inject({ method: 'POST', url: '/api/config/export', payload: { password }, headers: bearer(token) });
  assert.equal(exp.statusCode, 200);
  const file = parse(exp).data.file;
  const raw = Buffer.from(file, 'base64');
  assert.equal(raw.subarray(0, 4).toString('ascii'), 'SWB1');
  assert.ok(!raw.toString('utf8').includes('github.com'), '密文不得含明文 URL');

  // 破坏库数据后用备份恢复
  const groupRes = await h.app.inject({ method: 'POST', url: '/api/groups', payload: { name: '临时组' }, headers: bearer(token) });
  const gid = parse(groupRes).data.group.id;
  await h.app.inject({ method: 'DELETE', url: '/api/groups/' + gid, headers: bearer(token) });

  // 先确认（不解密验证于前端展示）
  const check = await h.app.inject({ method: 'POST', url: '/api/config/import', payload: { password, file }, headers: bearer(token) });
  assert.equal(parse(check).data.needsConfirm, true);
  // 未确认不落库
  // 确认导入
  const imp = await h.app.inject({ method: 'POST', url: '/api/config/import', payload: { password, file, confirm: true }, headers: bearer(token) });
  assert.equal(imp.statusCode, 200);
  const restored = parse(imp).data.restored;
  assert.ok(restored.linksCreated >= 3);

  const after = await h.app.inject({ method: 'GET', url: '/api/data' });
  const names = parse(after).data.groups.map((g: { name: string }) => g.name).sort();
  assert.deepEqual(names, ['娱乐', '开发']);

  // 密码错误的导入：拒绝且不改数据
  const wrongFile = Buffer.from(await encryptBackup('other-password', JSON.stringify({ version: 1, groups: [] }))).toString('base64');
  const wrong = await h.app.inject({ method: 'POST', url: '/api/config/import', payload: { password, file: wrongFile, confirm: true }, headers: bearer(token) });
  assert.equal(parse(wrong).error.code, 'WRONG_PASSWORD');
  const stillOk = await h.app.inject({ method: 'GET', url: '/api/data' });
  assert.equal(parse(stillOk).data.groups.length, 2, '密码错误不得改数据');
});

test('快照恢复原子性：batch 中途非法 INSERT 失败后库内数据保持原样', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: SAMPLE_HTML }, headers: bearer(token) });
  const before = await h.app.inject({ method: 'GET', url: '/api/data' });
  const beforeData = JSON.parse(before.body).data;

  // preset 语句末尾拼一条必然失败的 INSERT（violates groups.name_key UNIQUE，把已有 key 重复插入）
  const badPreset = [
    { sql: 'DELETE FROM links' },
    { sql: 'DELETE FROM groups' },
    { sql: 'DELETE FROM dedupe_ignores' },
    { sql: 'INSERT INTO groups (name, name_key, type) VALUES (?, ?, ?)', params: ['x', '开发', 'tab'] },
  ];
  await assert.rejects(
    () => commitImport(h.db, [{ name: '新组', items: [{ title: 'N', url: 'https://new.example.com/' }] }], 'allow', badPreset),
    () => true,
  );

  // 失败后库内数据必须与失败前完全一致（事务整体回滚）
  const after = await h.app.inject({ method: 'GET', url: '/api/data' });
  const afterData = JSON.parse(after.body).data;
  assert.deepEqual(afterData.groups, beforeData.groups);
  assert.deepEqual(afterData.links, beforeData.links);
});

test('导入预览：multipart 文件上传与 JSON body 等价', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);

  const boundary = '----suenwebtest' + Date.now();
  const body = [
    '--' + boundary,
    'Content-Disposition: form-data; name="file"; filename="bookmarks.html"',
    'Content-Type: text/html',
    '',
    SAMPLE_HTML,
    '--' + boundary + '--',
    '',
  ].join('\r\n');

  const guest = await h.app.inject({
    method: 'POST', url: '/api/import/preview',
    payload: body,
    headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
  });
  assert.equal(guest.statusCode, 401);

  const res = await h.app.inject({
    method: 'POST', url: '/api/import/preview',
    payload: body,
    headers: { ...bearer(token), 'content-type': 'multipart/form-data; boundary=' + boundary },
  });
  assert.equal(res.statusCode, 200, res.body);
  const mp = JSON.parse(res.body).data;

  // 与 JSON body 路径等价
  const jsonRes = await h.app.inject({ method: 'POST', url: '/api/import/preview', payload: { html: SAMPLE_HTML }, headers: bearer(token) });
  const jp = JSON.parse(jsonRes.body).data;
  assert.deepEqual(mp, jp);
  assert.equal(mp.grandTotal, 4);
});
