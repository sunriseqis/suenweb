import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';

test('跨组重复：选忽略后不再提示，撤销后恢复提示，且忽略只作用于该分组', async () => {
  const h = await createHarness();
  try {
    const token = await setupAdmin(h.app);
    const mk = async (name: string) => parse(await h.app.inject({ method: 'POST', url: '/api/groups', headers: bearer(token), payload: { name } })).data.group;
    const g1 = await mk('A');
    const g3 = await mk('C');
    const g4 = await mk('D');

    const url = 'https://repeat.example.com/page';
    const first = await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g1.id, url } });
    assert.equal(first.statusCode, 201);

    const prompt1 = await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g3.id, url } });
    assert.equal(prompt1.statusCode, 409);
    assert.equal(parse(prompt1).error.code, 'CROSS_GROUP_DUPLICATE');

    const ignored = await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g3.id, url, on_duplicate: 'ignore' } });
    assert.equal(ignored.statusCode, 201);

    const list = parse(await h.app.inject({ method: 'GET', url: '/api/dedupe/ignores', headers: bearer(token) })).data.ignores;
    assert.equal(list.length, 1);
    assert.equal(list[0].group_id, g3.id);

    // 删掉 C 里的那条，再次添加同一 URL：因为记过忽略，不再弹窗
    await h.app.inject({ method: 'DELETE', url: '/api/links/' + parse(ignored).data.link.id, headers: bearer(token) });
    const noPrompt = await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g3.id, url } });
    assert.equal(noPrompt.statusCode, 201);

    // 忽略只作用于该分组：D 仍然要提示
    const prompt4 = await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g4.id, url } });
    assert.equal(prompt4.statusCode, 409);

    // 撤销忽略后，C 重新开始提示
    const removed = await h.app.inject({ method: 'DELETE', url: '/api/dedupe/ignores', headers: bearer(token), payload: { url_normalized: list[0].url_normalized, group_id: g3.id } });
    assert.equal(removed.statusCode, 200);
    await h.app.inject({ method: 'DELETE', url: '/api/links/' + parse(noPrompt).data.link.id, headers: bearer(token) });
    const promptAgain = await h.app.inject({ method: 'POST', url: '/api/links', headers: bearer(token), payload: { group_id: g3.id, url } });
    assert.equal(promptAgain.statusCode, 409);

    const missing = await h.app.inject({ method: 'DELETE', url: '/api/dedupe/ignores', headers: bearer(token), payload: { url_normalized: list[0].url_normalized, group_id: g3.id } });
    assert.equal(missing.statusCode, 400);
    assert.equal(parse(missing).error.code, 'IGNORE_NOT_FOUND');
  } finally {
    await h.close();
  }
});
