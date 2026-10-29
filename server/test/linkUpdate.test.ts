import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';

test('链接编辑：PUT 改标题/URL/备注/自定义图标，全部 200（回归 2026-10-27 INTERNAL_ERROR）', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);
  const g = await h.app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'T' }, headers: bearer(token) });
  const gid = parse(g).data.group.id;
  const l = await h.app.inject({ method: 'POST', url: '/api/links', payload: { group_id: gid, url: 'https://a.example.com/' }, headers: bearer(token) });
  const id = parse(l).data.link.id;

  // 纯标题编辑（曾因 SQL 缺引号 500）
  const u1 = await h.app.inject({ method: 'PUT', url: '/api/links/' + id, payload: { title: '改名' }, headers: bearer(token) });
  assert.equal(u1.statusCode, 200);
  assert.equal(parse(u1).data.link.title, '改名');
  assert.equal(parse(u1).data.link.sync_state, 'pending', '改标题后回 pending 等插件回写');

  // 自定义图标 + icon_type
  const u2 = await h.app.inject({ method: 'PUT', url: '/api/links/' + id, payload: { icon: 'https://a.example.com/logo.png', icon_type: 'url' }, headers: bearer(token) });
  assert.equal(u2.statusCode, 200);
  assert.equal(parse(u2).data.link.icon, 'https://a.example.com/logo.png');
  assert.equal(parse(u2).data.link.icon_type, 'url');

  // 清空图标回 auto
  const u3 = await h.app.inject({ method: 'PUT', url: '/api/links/' + id, payload: { icon: null, icon_type: 'auto' }, headers: bearer(token) });
  assert.equal(u3.statusCode, 200);
  assert.equal(parse(u3).data.link.icon, null);
  assert.equal(parse(u3).data.link.icon_type, 'auto');

  // 非法 icon_type 拒绝
  const u4 = await h.app.inject({ method: 'PUT', url: '/api/links/' + id, payload: { icon_type: 'nope' }, headers: bearer(token) });
  assert.equal(u4.statusCode, 400);
});
