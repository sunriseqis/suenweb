import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';

test('健康检查', async () => {
  const h = await createHarness();
  try {
    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(parse(res).data.status, 'ok');
  } finally {
    await h.close();
  }
});

test('访客只读：GET /api/data 可读，写操作 401', async () => {
  const h = await createHarness();
  try {
    const read = await h.app.inject({ method: 'GET', url: '/api/data' });
    assert.equal(read.statusCode, 200);
    const data = parse(read).data;
    assert.deepEqual(data.groups, []);
    assert.equal(data.meta.linkCount, 0);
    const write = await h.app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'x' } });
    assert.equal(write.statusCode, 401);
    assert.equal(parse(write).error.code, 'UNAUTHENTICATED');
  } finally {
    await h.close();
  }
});

test('初始化 → 登录 → 状态 → 登出', async () => {
  const h = await createHarness();
  try {
    const before = await h.app.inject({ method: 'GET', url: '/api/auth/status' });
    assert.equal(parse(before).data.initialized, false);
    const token = await setupAdmin(h.app);
    const authed = await h.app.inject({ method: 'GET', url: '/api/auth/status', headers: bearer(token) });
    assert.equal(parse(authed).data.authenticated, true);
    const again = await h.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'another-pass-1' } });
    assert.equal(again.statusCode, 409);
    const wrong = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong-password' } });
    assert.equal(wrong.statusCode, 401);
    const ok = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'passw0rd!', device: 'firefox' } });
    assert.equal(ok.statusCode, 200);
    const second = parse(ok).data.token;
    const viaCookie = await h.app.inject({ method: 'GET', url: '/api/auth/status', cookies: { sw_session: second } });
    assert.equal(parse(viaCookie).data.authenticated, true);
    const out = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(second) });
    assert.equal(out.statusCode, 200);
    const after = await h.app.inject({ method: 'GET', url: '/api/auth/status', headers: bearer(second) });
    assert.equal(parse(after).data.authenticated, false);
  } finally {
    await h.close();
  }
});

test('密码最短 6 位：5 位拒绝、6 位通过；改密同一条线', async () => {
  const h = await createHarness();
  try {
    const weak = await h.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'abc12' } });
    assert.equal(weak.statusCode, 400);
    assert.equal(parse(weak).error.code, 'WEAK_PASSWORD');
    const okSetup = await h.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'abc123' } });
    assert.equal(okSetup.statusCode, 200);
    const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'abc123' } });
    assert.equal(login.statusCode, 200);
    const token = parse(login).data.token as string;
    const change = await h.app.inject({
      method: 'POST', url: '/api/auth/change-password', headers: bearer(token),
      payload: { currentPassword: 'abc123', newPassword: '12345' },
    });
    assert.equal(change.statusCode, 400);
  } finally {
    await h.close();
  }
});
test('分组：重名自动合并、空名拒绝', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const first = await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'Dev' } });
    assert.equal(first.statusCode, 201);
    const dup = await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: '  dev ' } });
    assert.equal(dup.statusCode, 200);
    assert.equal(parse(dup).data.merged, true);
    assert.equal(parse(dup).data.group.id, parse(first).data.group.id);
    const empty = await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: '   ' } });
    assert.equal(empty.statusCode, 400);
    const data = await h.app.inject({ method: 'GET', url: '/api/data' });
    assert.equal(parse(data).data.meta.groupCount, 1);
  } finally {
    await h.close();
  }
});

test('链接去重：同组静默去重，跨组默认弹窗(409) / allow 放行 / skip 不加', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const g1 = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'A' } })).data.group;
    const g2 = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'B' } })).data.group;

    const l1 = await h.app.inject({
      method: 'POST', url: '/api/links', headers: bearer(token),
      payload: { group_id: g1.id, title: '示例', url: 'https://Example.com/path/?utm_source=x' },
    });
    assert.equal(l1.statusCode, 201);
    assert.equal(parse(l1).data.link.url_normalized, 'https://example.com/path');

    const sameGroup = await h.app.inject({
      method: 'POST', url: '/api/links', headers: bearer(token),
      payload: { group_id: g1.id, url: 'example.com/path' },
    });
    assert.equal(sameGroup.statusCode, 200);
    assert.equal(parse(sameGroup).data.merged, true);
    assert.equal(parse(sameGroup).data.link.id, parse(l1).data.link.id);

    const cross = await h.app.inject({
      method: 'POST', url: '/api/links', headers: bearer(token),
      payload: { group_id: g2.id, url: 'https://example.com/path' },
    });
    assert.equal(cross.statusCode, 409);
    assert.equal(parse(cross).error.code, 'CROSS_GROUP_DUPLICATE');
    assert.equal(parse(cross).error.details.existing.group_id, g1.id);
    assert.deepEqual(parse(cross).error.details.options, ['allow', 'ignore', 'skip']);

    const allowed = await h.app.inject({
      method: 'POST', url: '/api/links', headers: bearer(token),
      payload: { group_id: g2.id, url: 'https://example.com/path', on_duplicate: 'allow' },
    });
    assert.equal(allowed.statusCode, 201);
    assert.equal(parse(allowed).data.cross_group_duplicate, true);

    const g3 = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'C' } })).data.group;
    const skipped = await h.app.inject({
      method: 'POST', url: '/api/links', headers: bearer(token),
      payload: { group_id: g3.id, url: 'https://example.com/path', on_duplicate: 'skip' },
    });
    assert.equal(skipped.statusCode, 200);
    assert.equal(parse(skipped).data.skipped, true);
    assert.equal(parse(skipped).data.link.id, parse(l1).data.link.id);

    const data = parse(await h.app.inject({ method: 'GET', url: '/api/data' })).data;
    assert.equal(data.meta.groupCount, 3);
    assert.equal(data.meta.linkCount, 2);
  } finally {
    await h.close();
  }
});
test('排序与跨组移动（目标组重复则静默合并）', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const g1 = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'A' } })).data.group;
    const g2 = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'B' } })).data.group;
    const a = parse(await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g1.id, url: 'https://a.example.com' } })).data.link;
    const b = parse(await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g1.id, url: 'https://b.example.com' } })).data.link;
    const reordered = await h.app.inject({
      method: 'POST', url: '/api/reorder/links', headers: bearer(token),
      payload: { group_id: g1.id, ids: [b.id, a.id] },
    });
    assert.equal(reordered.statusCode, 200);
    const order = parse(reordered).data.links.map((l: { id: number }) => l.id);
    assert.deepEqual(order, [b.id, a.id]);

    const moved = await h.app.inject({
      method: 'POST', url: '/api/links/' + a.id + '/move', headers: bearer(token),
      payload: { group_id: g2.id },
    });
    assert.equal(moved.statusCode, 200);
    assert.equal(parse(moved).data.merged, false);
    assert.equal(parse(moved).data.link.group_id, g2.id);

    await h.app.inject({
      method: 'POST', url: '/api/links', headers: bearer(token),
      payload: { group_id: g2.id, url: 'https://b.example.com', on_duplicate: 'allow' },
    });
    const mergeOnMove = await h.app.inject({
      method: 'POST', url: '/api/links/' + b.id + '/move', headers: bearer(token),
      payload: { group_id: g2.id },
    });
    assert.equal(parse(mergeOnMove).data.merged, true);
  } finally {
    await h.close();
  }
});

test('分组改名为已存在名称时合并（链接随之迁移）', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const keep = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'Keep' } })).data.group;
    const tmp = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'Temp' } })).data.group;
    await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: tmp.id, url: 'https://merged.example.com' } });
    const merged = await h.app.inject({
      method: 'PUT', url: '/api/groups/' + tmp.id, headers: bearer(token),
      payload: { name: ' keep ' },
    });
    assert.equal(merged.statusCode, 200);
    assert.equal(parse(merged).data.merged, true);
    assert.equal(parse(merged).data.group.id, keep.id);
    const data = await h.app.inject({ method: 'GET', url: '/api/data' });
    const groups = parse(data).data.groups;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].links.length, 1);
  } finally {
    await h.close();
  }
});

test('删除分组级联删除链接', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const g = parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name: 'X' } })).data.group;
    await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g.id, url: 'https://x.example.com' } });
    const del = await h.app.inject({ method: 'DELETE', url: '/api/groups/' + g.id, headers: bearer(token) });
    assert.equal(del.statusCode, 200);
    const data = parse(await h.app.inject({ method: 'GET', url: '/api/data' })).data;
    assert.equal(data.meta.groupCount, 0);
    assert.equal(data.meta.linkCount, 0);
  } finally {
    await h.close();
  }
});

test('改密码：其他会话失效，新密码可登录', async () => {
  const h = await createHarness();
  try {
    const keep = await setupAdmin(h.app);
    const other = parse(await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'passw0rd!', device: 'chrome' } })).data.token;
    const changed = await h.app.inject({
      method: 'POST', url: '/api/auth/change-password', headers: bearer(keep),
      payload: { currentPassword: 'passw0rd!', newPassword: 'new-passw0rd' },
    });
    assert.equal(changed.statusCode, 200);
    const stillIn = await h.app.inject({ method: 'GET', url: '/api/auth/status', headers: bearer(keep) });
    assert.equal(parse(stillIn).data.authenticated, true);
    const kicked = await h.app.inject({ method: 'GET', url: '/api/auth/status', headers: bearer(other) });
    assert.equal(parse(kicked).data.authenticated, false);
    const oldPw = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'passw0rd!' } });
    assert.equal(oldPw.statusCode, 401);
    const newPw = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'new-passw0rd' } });
    assert.equal(newPw.statusCode, 200);
  } finally {
    await h.close();
  }
});

test('设置：公开读、需登录写、内部键不可写', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const denied = await h.app.inject({ method: 'PUT', url: '/api/settings', payload: { 'ui.theme': 'dark' } });
    assert.equal(denied.statusCode, 401);
    const ok = await h.app.inject({ method: 'PUT', url: '/api/settings', headers: bearer(token), payload: { 'ui.theme': 'dark', 'site.title': '我的书签' } });
    assert.equal(ok.statusCode, 200);
    const pub = parse(await h.app.inject({ method: 'GET', url: '/api/settings' })).data.settings;
    assert.equal(pub['ui.theme'], 'dark');
    const internal = await h.app.inject({ method: 'PUT', url: '/api/settings', headers: bearer(token), payload: { 'auth.password_hash': 'x' } });
    assert.equal(internal.statusCode, 400);
    assert.equal(parse(internal).error.code, 'SETTING_NOT_WRITABLE');
  } finally {
    await h.close();
  }
});

test('站点图标：默认关闭时返回 ICONS_DISABLED，非法域名 400', async () => {
  const h = await createHarness();
  try {
    const off = await h.app.inject({ method: 'GET', url: '/api/icon?domain=example.com' });
    assert.equal(off.statusCode, 404);
    assert.equal(parse(off).error.code, 'ICONS_DISABLED');
    const bad = await h.app.inject({ method: 'GET', url: '/api/icon?domain=' + encodeURIComponent('https://x/y') });
    assert.equal(bad.statusCode, 400);
  } finally {
    await h.close();
  }
});

test('站点图标：开启后游客只读缓存，不触发抓取', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const put = await h.app.inject({
      method: 'PUT', url: '/api/settings', headers: bearer(token), payload: { 'ui.fetch_icons': true },
    });
    assert.equal(put.statusCode, 200);
    const guest = await h.app.inject({ method: 'GET', url: '/api/icon?domain=example.com' });
    assert.equal(guest.statusCode, 404);
    assert.equal(parse(guest).error.code, 'ICON_NOT_CACHED');
  } finally {
    await h.close();
  }
});
