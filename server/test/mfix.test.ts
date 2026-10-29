import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';
import { isPrivateHost } from '../src/domain/isPrivateHost.ts';
import { encryptBackup } from '../src/infra/backupCrypto.ts';

// ---- M6：并发创建同一 URL 不 500、只产生一条 ----
test('M6 并发创建同一链接：Promise.all x5 全部成功且只入库一条', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  const g = await h.app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'M6组' }, headers: bearer(token) });
  const groupId = parse(g).data.group.id;

  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      h.app.inject({ method: 'POST', url: '/api/links', payload: { group_id: groupId, url: 'https://m6.example.com/' }, headers: bearer(token) }),
    ),
  );
  for (const res of responses) {
    assert.ok(res.statusCode < 500, '不应 500: ' + res.statusCode + ' ' + res.body);
  }
  const rows = await h.db.all<{ id: number }>('SELECT id FROM links WHERE url_normalized = ? AND group_id = ?', ['https://m6.example.com', groupId]);
  assert.equal(rows.length, 1, '并发后只应有一条链接');
  const mergedCount = responses.filter((r) => parse(r).data.merged === true).length;
  assert.ok(mergedCount >= 1, '至少一条应是 merged');
  // 所有成功响应指向同一条链接
  const ids = new Set(responses.map((r) => parse(r).data.link.id));
  assert.equal(ids.size, 1);
});

// ---- M8：重复配置 WebDAV 保留旧备份密钥 ----
test('M8 两次配置 WebDAV：第一次备份的文件第二次配置后仍可下载解密', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app, 'passw0rd!');

  const firstConfig = await h.app.inject({
    method: 'POST', url: '/api/backup/config',
    payload: { url: 'http://example.invalid/dav', username: 'u', password: 'p', adminPassword: 'passw0rd!' },
    headers: bearer(token),
  });
  assert.equal(firstConfig.statusCode, 200);
  const key1 = await h.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'backup.wrapped.key'");
  assert.ok(key1?.value);

  // 手动加密一份「旧备份」（用第一把密钥）
  const { encryptBackup: enc } = await import('../src/infra/backupCrypto.ts');
  const oldBlob = await enc(key1!.value, JSON.stringify({ version: 1, groups: [] }));

  // 第二次配置：密钥必须不变
  const secondConfig = await h.app.inject({
    method: 'POST', url: '/api/backup/config',
    payload: { url: 'http://example.invalid/dav2', username: 'u', password: 'p', adminPassword: 'passw0rd!' },
    headers: bearer(token),
  });
  assert.equal(secondConfig.statusCode, 200);
  const key2 = await h.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'backup.wrapped.key'");
  assert.equal(key2!.value, key1!.value, '重复配置不得轮换备份密钥');

  // 旧备份用当前密钥仍可解
  const { decryptBackup: dec } = await import('../src/infra/backupCrypto.ts');
  assert.equal(await dec(key2!.value, oldBlob), JSON.stringify({ version: 1, groups: [] }));
});

// ---- M9：私网主机黑名单 ----
test('M9 isPrivateHost 纯函数覆盖黑名单', () => {
  for (const blocked of ['localhost', '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '0.0.0.0', '[::1]', '::1', '0x7f.0.0.1', '0x7f000001', '0177.0.0.1', '10.1.2.3']) {
    assert.equal(isPrivateHost(blocked), true, blocked + ' 应被拦截');
  }
  for (const allowed of ['example.com', 'github.com', 'example.invalid', '172.32.0.1', 'suenweb.dev']) {
    assert.equal(isPrivateHost(allowed), false, allowed + ' 应放行');
  }
});

test('M9 check-links 对私网 URL 判失败且不发起请求', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  const g = await h.app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'G' }, headers: bearer(token) });
  const groupId = parse(g).data.group.id;
  for (const url of ['http://127.0.0.1:9/x', 'http://10.0.0.1/y']) {
    await h.app.inject({ method: 'POST', url: '/api/links', payload: { group_id: groupId, url }, headers: bearer(token) });
  }
  const res = await h.app.inject({ method: 'POST', url: '/api/tools/check-links', payload: { limit: 10 }, headers: bearer(token) });
  assert.equal(res.statusCode, 200);
  const data = parse(res).data;
  assert.equal(data.deadCount, 2, '私网链接应全部判死');
  for (const dead of data.dead) {
    assert.equal(dead.status, null, '私网请求不得真实发出（status 应为 null）: ' + dead.url);
  }
});

test('M9 icon-refresh 对私网域名不发起任何请求（负缓存语义，无异常）', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  await h.app.repos.settings.set('ui.fetch_icons', true);
  const res = await h.app.inject({ method: 'POST', url: '/api/tools/icon-refresh', payload: { domain: '127.0.0.1' }, headers: bearer(token) });
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).data.refetched, true);
  assert.equal(parse(res).data.status, 'negative', '私网域名应走负缓存（不真实出网）');
});

// ---- M11：SSE 未认证 401、?token= 可订阅 ----
test('M11 SSE：未认证 401，query token 与 Bearer 均可订阅', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);

  const anon = await h.app.inject({ method: 'GET', url: '/api/events/stream' });
  assert.equal(anon.statusCode, 401, '未认证订阅应 401');

  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const address = h.app.server.address();
  const base = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);

  const readFirstLine = async (url: string, headers: Record<string, string>): Promise<{ status: number; first: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(base + url, { signal: controller.signal, headers });
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      reader.cancel().catch(() => {});
      return { status: response.status, first: new TextDecoder().decode(value ?? new Uint8Array()) };
    } finally {
      clearTimeout(timer);
    }
  };

  const byBearer = await readFirstLine('/api/events/stream', { authorization: 'Bearer ' + token });
  assert.equal(byBearer.status, 200);
  assert.ok(byBearer.first.includes(': connected'));

  const byQuery = await readFirstLine('/api/events/stream?token=' + encodeURIComponent(token), {});
  assert.equal(byQuery.status, 200, 'query token 应通过');
  assert.ok(byQuery.first.includes(': connected'));
});

// ---- M12：路由级 bodyLimit 64MB ----
test('M12 大 payload 导入不再 413（5MB base64 通过 bodyLimit）', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app, 'passw0rd!');
  // 5MB 随机 base64（不是合法备份 → 应得到 CORRUPT_BACKUP 业务错而不是 413）
  const big = Buffer.alloc(5 * 1024 * 1024, 'a').toString('base64');
  const res = await h.app.inject({
    method: 'POST', url: '/api/config/import',
    payload: { password: 'passw0rd!', file: big, confirm: true },
    headers: { ...bearer(token), 'content-type': 'application/json' },
  });
  assert.notEqual(res.statusCode, 413, '不应 413: ' + res.body.slice(0, 200));
  assert.equal(JSON.parse(res.body).error.code, 'CORRUPT_BACKUP', '过了 bodyLimit 进入业务层校验');
});

test('M12 restore-snapshot 大 payload 不 413', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  const big = 'x'.repeat(5 * 1024 * 1024);
  const res = await h.app.inject({
    method: 'POST', url: '/api/config/restore-snapshot',
    payload: { password: 'passw0rd!', snapshot: { groups: [{ name: 'g', links: [{ title: big, url: 'https://a.example.com/' }] }] } },
    headers: bearer(token),
  });
  assert.notEqual(res.statusCode, 413);
});
