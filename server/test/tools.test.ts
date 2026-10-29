import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';

const SEED_HTML = '<DL><p>' +
  '<DT><H3>A</H3><DL><p>' +
  '<DT><A HREF="https://dup.example.com/">首页</A>' +
  '<DT><A HREF="https://alive.example.com/">活的</A>' +
  '</DL><p>' +
  '<DT><H3>B</H3><DL><p>' +
  '<DT><A HREF="https://dup.example.com/?utm_source=x">同一页</A>' +
  '</DL><p></DL><p>';

test('TOOL-02：重复聚类与批量删除（ut m 归一化后跨组重复）', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: SEED_HTML }, headers: bearer(token) });

  const dup = await h.app.inject({ method: 'GET', url: '/api/tools/duplicates', headers: bearer(token) });
  assert.equal(parse(dup).data.total, 1, 'dup.example.com 跨组重复（utm 归一化）');
  const cluster = parse(dup).data.duplicates[0];
  assert.equal(cluster.occurrences.length, 2);

  // 删除其中一条（keepIds 语义：传要删除的 id）
  const toDelete = cluster.occurrences[1].id;
  const del = await h.app.inject({ method: 'POST', url: '/api/tools/duplicates/delete', payload: { keepIds: [toDelete] }, headers: bearer(token) });
  assert.equal(parse(del).data.deleted, 1);
  const after = await h.app.inject({ method: 'GET', url: '/api/tools/duplicates', headers: bearer(token) });
  assert.equal(parse(after).data.total, 0);
});

test('TOOL-02：越界删除拒绝——非聚类 id 与整簇全删均返回 INVALID_DELETE_TARGET', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: SEED_HTML }, headers: bearer(token) });

  const dup = await h.app.inject({ method: 'GET', url: '/api/tools/duplicates', headers: bearer(token) });
  const cluster = parse(dup).data.duplicates[0];
  const allLinks = await h.db.all<{ id: number; url: string }>('SELECT id, url FROM links');

  // 非重复链接（簇成员数 < 2）：拒绝
  const aliveId = allLinks.find((l) => l.url.includes('alive.example.com'))!.id;
  const delNonDup = await h.app.inject({ method: 'POST', url: '/api/tools/duplicates/delete', payload: { keepIds: [aliveId] }, headers: bearer(token) });
  assert.equal(delNonDup.statusCode, 400);
  assert.equal(parse(delNonDup).error.code, 'INVALID_DELETE_TARGET');

  // 不存在的 id：拒绝
  const delGhost = await h.app.inject({ method: 'POST', url: '/api/tools/duplicates/delete', payload: { keepIds: [999999] }, headers: bearer(token) });
  assert.equal(parse(delGhost).error.code, 'INVALID_DELETE_TARGET');

  // 整簇全删：拒绝且数据不变
  const allIds = cluster.occurrences.map((o: { id: number }) => o.id);
  const delAll = await h.app.inject({ method: 'POST', url: '/api/tools/duplicates/delete', payload: { keepIds: allIds }, headers: bearer(token) });
  assert.equal(delAll.statusCode, 400);
  assert.equal(parse(delAll).error.code, 'INVALID_DELETE_TARGET');
  const countAfter = await h.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM links');
  assert.equal(countAfter?.c, 3, '整簇删除被拒绝，三条链接都在');
});

test('TOOL-05：图标手动刷新（清缓存 + 重新抓取）', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);

  const bad = await h.app.inject({ method: 'POST', url: '/api/tools/icon-refresh', payload: { domain: 'bad domain!' }, headers: bearer(token) });
  assert.equal(parse(bad).error.code, 'INVALID_DOMAIN');
  const guest = await h.app.inject({ method: 'POST', url: '/api/tools/icon-refresh', payload: { domain: 'example.com' } });
  assert.equal(guest.statusCode, 401);

  const ok = await h.app.inject({ method: 'POST', url: '/api/tools/icon-refresh', payload: { domain: 'no-such-host.invalid' }, headers: bearer(token) });
  assert.equal(parse(ok).data.purged, true);
});

test('TOOL-03：失效链接检测（打不通的记 dead，可查可删）', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  await h.app.inject({ method: 'POST', url: '/api/import/commit', payload: { html: SEED_HTML }, headers: bearer(token) });

  const check = await h.app.inject({ method: 'POST', url: '/api/tools/check-links', payload: { limit: 50 }, headers: bearer(token) });
  assert.equal(check.statusCode, 200, check.body);
  const data = parse(check).data;
  assert.equal(data.checked, 3);
  // *.example.com 保留域解析失败 → 全部 dead
  assert.equal(data.deadCount, 3);

  // 结果保存可复查
  const saved = await h.app.inject({ method: 'GET', url: '/api/tools/check-links', headers: bearer(token) });
  const stored = parse(saved).data.result;
  assert.ok(stored && stored.checkedAt && stored.dead.length === 3, '上次检测结果应已保存');

  // 删除失效项
  const deadIds = data.dead.map((d: { id: number }) => d.id);
  const del = await h.app.inject({ method: 'POST', url: '/api/tools/dead-links/delete', payload: { ids: deadIds.slice(0, 1) }, headers: bearer(token) });
  assert.equal(parse(del).data.deleted, 1);
});
