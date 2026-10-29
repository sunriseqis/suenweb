/* eslint-disable */
// @ts-nocheck
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';

test('SSE：订阅事件流，写操作触发 links-changed 与 groups-changed', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);

  const groupRes = await h.app.inject({ method: 'POST', url: '/api/groups', payload: { name: '测试组' }, headers: bearer(token) });
  assert.equal(groupRes.statusCode, 201);
  const groupId = parse(groupRes).data.group.id;

  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const address = h.app.server.address();
  const base = 'http://127.0.0.1:' + address.port;

  const events = [];
  const controller = new AbortController();
  const streamDone = (async () => {
    const response = await fetch(base + '/api/events/stream', { signal: controller.signal, headers: bearer(token) });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const m = chunk.match(/^event: (.+)$/m);
        if (m) events.push(m[1]);
      }
    }
  })();

  await new Promise((r) => setTimeout(r, 150));
  await h.app.inject({ method: 'POST', url: '/api/links', payload: { group_id: groupId, url: 'https://sse.example.com' }, headers: bearer(token) });
  await h.app.inject({ method: 'PUT', url: '/api/groups/' + groupId, payload: { name: '改名' }, headers: bearer(token) });
  await new Promise((r) => setTimeout(r, 300));
  controller.abort();
  await streamDone.catch(() => {});
  assert.ok(events.includes('links-changed'), '应收到 links-changed，实际: ' + events.join(','));
  assert.ok(events.includes('groups-changed'), '应收到 groups-changed，实际: ' + events.join(','));
});
