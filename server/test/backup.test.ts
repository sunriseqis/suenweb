import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';

/** 极简 WebDAV stub：内存对象存储，支持 MKCOL/PUT/PROPFIND/GET/DELETE */
function startStub(): Promise<{ port: number; files: Map<string, Buffer>; close: () => Promise<void> }> {
  const files = new Map<string, Buffer>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = decodeURIComponent((req.url ?? '/').replace(/\/+$/, '') || '/');
    const auth = req.headers.authorization ?? '';
    if (auth !== 'Basic ' + Buffer.from('user:pass').toString('base64')) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === 'MKCOL') { files.set(url, Buffer.alloc(0)); res.writeHead(201).end(); return; }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { files.set(url, Buffer.concat(chunks)); res.writeHead(files.has(url + '/x') ? 201 : 201).end(); });
      return;
    }
    if (req.method === 'GET') {
      const hit = files.get(url);
      if (!hit) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-length': String(hit.length) }).end(hit);
      return;
    }
    if (req.method === 'DELETE') { files.delete(url); res.writeHead(204).end(); return; }
    if (req.method === 'PROPFIND') {
      const depth = req.headers.depth;
      if (depth === '0') { res.writeHead(207).end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>'); return; }
      let xml = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">';
      for (const [key, value] of files) {
        if (!key.startsWith(url + '/') || key === url) continue;
        const name = key.slice(url.length + 1);
        if (name.includes('/')) continue;
        xml += '<d:response><d:href>' + key + '</d:href><d:propstat><d:prop>' +
          '<d:getlastmodified>Thu, 01 Jan 2026 00:00:0' + (xml.length % 9) + ' GMT</d:getlastmodified>' +
          '<d:getcontentlength>' + value.length + '</d:getcontentlength>' +
          '</d:prop></d:propstat></d:response>';
      }
      xml += '</d:multistatus>';
      res.writeHead(207, { 'content-type': 'application/xml' }).end(xml);
      return;
    }
    res.writeHead(405).end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, files, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test('WebDAV 备份：配置+测试、手动备份上传、列表、轮转、下载解密', async (t) => {
  const h = await createHarness();
  const stub = await startStub();
  t.after(async () => { await h.close(); await stub.close(); });
  const token = await setupAdmin(h.app, 'passw0rd!');

  // 未配置时状态与运行
  const st0 = await h.app.inject({ method: 'GET', url: '/api/backup/status', headers: bearer(token) });
  assert.equal(parse(st0).data.configured, false);
  const run0 = await h.app.inject({ method: 'POST', url: '/api/backup/run', payload: {}, headers: bearer(token) });
  assert.equal(parse(run0).error.code, 'WEBDAV_NOT_CONFIGURED');

  // 配置（adminPassword 初始化备份密钥）
  const cfg = await h.app.inject({
    method: 'POST', url: '/api/backup/config',
    payload: { url: 'http://127.0.0.1:' + stub.port + '/dav', username: 'user', password: 'pass', keepCount: 3, adminPassword: 'passw0rd!' },
    headers: bearer(token),
  });
  assert.equal(cfg.statusCode, 200, cfg.body);
  assert.equal(parse(cfg).data.writable, true);

  // 建点数据再备份
  await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: '<DL><p><DT><H3>A</H3><DL><p><DT><A HREF="https://b.example.com/">B</A></DL><p></DL><p>' }, headers: bearer(token) });
  const run1 = await h.app.inject({ method: 'POST', url: '/api/backup/run', payload: { kind: 'manual' }, headers: bearer(token) });
  assert.equal(run1.statusCode, 200, run1.body);
  const file1 = parse(run1).data.file;
  assert.match(file1, /suenweb-backup-manual-.*\.swb1/);

  // stub 中能看到密文文件（SWB1 魔数）
  const keys = [...stub.files.keys()].filter((k) => k.endsWith('.swb1'));
  assert.equal(keys.length, 1);
  const stored = stub.files.get(keys[0])!;
  assert.equal(stored.subarray(0, 4).toString('ascii'), 'SWB1');
  assert.ok(!stored.toString('utf8').includes('example.com'), '密文不含明文 URL');

  // 列表
  const list = await h.app.inject({ method: 'GET', url: '/api/backup/list', headers: bearer(token) });
  assert.equal(parse(list).data.backups.length, 1);

  // 下载解密
  const dl = await h.app.inject({ method: 'POST', url: '/api/backup/download', payload: { name: file1, password: 'passw0rd!' }, headers: bearer(token) });
  assert.equal(dl.statusCode, 200, dl.body);
  const snap = parse(dl).data.snapshot;
  assert.equal(snap.groups.length, 1);
  assert.equal(snap.groups[0].links.length, 1);

  // 密码错误拒绝
  const dlBad = await h.app.inject({ method: 'POST', url: '/api/backup/download', payload: { name: file1, password: 'wrong-password' }, headers: bearer(token) });
  assert.equal(parse(dlBad).error.code, 'WRONG_PASSWORD');

  // 轮转：keepCount=3，连跑 5 次自动备份，只留 3 份 auto
  for (let i = 0; i < 5; i++) {
    await h.app.inject({ method: 'POST', url: '/api/backup/run', payload: { kind: 'auto' }, headers: bearer(token) });
  }
  const autos = [...stub.files.keys()].filter((k) => k.includes('backup-auto-'));
  assert.ok(autos.length <= 3, '轮转后 auto ≤ 3，实际 ' + autos.length);
  // 手动备份不受轮转影响
  const manuals = [...stub.files.keys()].filter((k) => k.includes('backup-manual-'));
  assert.equal(manuals.length, 1);

  // 状态回显
  const st1 = await h.app.inject({ method: 'GET', url: '/api/backup/status', headers: bearer(token) });
  const status = parse(st1).data;
  assert.equal(status.configured, true);
  assert.equal(status.keepCount, 3);
  assert.ok(status.lastRunAt);
});

test('WebDAV 302 重定向拒绝：redirect manual 下测试接口报重定向错误', async (t) => {
  const h = await createHarness();
  const redirectServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(302, { location: 'http://evil.example.com/dav' }).end();
  });
  const stub = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    redirectServer.listen(0, '127.0.0.1', () => {
      const address = redirectServer.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, close: () => new Promise((r) => redirectServer.close(() => r())) });
    });
  });
  t.after(async () => { await h.close(); await stub.close(); });
  const token = await setupAdmin(h.app, 'passw0rd!');

  const cfg = await h.app.inject({
    method: 'POST', url: '/api/backup/config',
    payload: { url: 'http://127.0.0.1:' + stub.port + '/dav', username: 'user', password: 'pass', keepCount: 3, adminPassword: 'passw0rd!' },
    headers: bearer(token),
  });
  assert.equal(cfg.statusCode, 200, cfg.body);
  const data = parse(cfg).data;
  assert.equal(data.ok, false);
  assert.match(data.error, /重定向/);
});
