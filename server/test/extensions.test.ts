import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, createHarness, parse, setupAdmin } from './helpers.ts';
import { storeUrl } from '../src/domain/stores.ts';

const FIREFOX_LIST = [
  { ext_id: 'uBlock0@raymondhill.net', name: 'uBlock Origin', version: '1.59.0' },
  { ext_id: '{12345678-aaaa-bbbb-cccc-123456789abc}', name: '某 GUID 插件', version: '2.0' },
];
const CHROME_LIST = [
  { ext_id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', name: 'uBlock Origin', version: '1.59.0' },
];

test('EXT：上报全量替换、按浏览器分组、删除单条、商店链接规则', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const token = await setupAdmin(h.app);

  // 访客不可读写
  const guest = await h.app.inject({ method: 'GET', url: '/api/extensions' });
  assert.equal(guest.statusCode, 401);

  // Firefox 上报
  const up1 = await h.app.inject({ method: 'POST', url: '/api/extensions', payload: { browser: 'firefox', extensions: FIREFOX_LIST }, headers: bearer(token) });
  assert.equal(up1.statusCode, 200, up1.body);
  assert.equal(parse(up1).data.total, 2);

  // 非法浏览器拒绝
  const bad = await h.app.inject({ method: 'POST', url: '/api/extensions', payload: { browser: 'safari', extensions: [] }, headers: bearer(token) });
  assert.equal(parse(bad).error.code, 'INVALID_BROWSER');

  // Chrome 上报（同名跨浏览器）
  const up2 = await h.app.inject({ method: 'POST', url: '/api/extensions', payload: { browser: 'chrome', extensions: CHROME_LIST }, headers: bearer(token) });
  assert.equal(parse(up2).data.total, 1);

  // 列表分组
  const list = await h.app.inject({ method: 'GET', url: '/api/extensions', headers: bearer(token) });
  const data = parse(list).data;
  assert.equal(data.total, 3);
  assert.equal(data.byBrowser.firefox.length, 2);
  assert.equal(data.byBrowser.chrome.length, 1);
  assert.equal(data.byBrowser.chrome[0].name, 'uBlock Origin');

  // 全量替换：firefox 只留 1 条
  const up3 = await h.app.inject({ method: 'POST', url: '/api/extensions', payload: { browser: 'firefox', extensions: [FIREFOX_LIST[0]] }, headers: bearer(token) });
  assert.equal(parse(up3).data.total, 1);
  const list2 = parse(await (await h.app.inject({ method: 'GET', url: '/api/extensions', headers: bearer(token) })).json ? await h.app.inject({ method: 'GET', url: '/api/extensions', headers: bearer(token) }) : await h.app.inject({ method: 'GET', url: '/api/extensions', headers: bearer(token) }));
  void list2;
  const again = await h.app.inject({ method: 'GET', url: '/api/extensions', headers: bearer(token) });
  assert.equal(parse(again).data.byBrowser.firefox.length, 1);

  // 删除单条
  const del = await h.app.inject({ method: 'DELETE', url: '/api/extensions/' + parse(again).data.byBrowser.chrome[0].id, headers: bearer(token) });
  assert.equal(parse(del).data.removed, 1);
  const del404 = await h.app.inject({ method: 'DELETE', url: '/api/extensions/99999', headers: bearer(token) });
  assert.equal(del404.statusCode, 404);
});

test('EXT-04 商店链接规则单点', () => {
  assert.equal(storeUrl({ ext_id: 'uBlock0@raymondhill.net', name: 'uBlock Origin', version: '' }, 'firefox'), 'https://addons.mozilla.org/firefox/addon/uBlock0@raymondhill.net/');
  assert.match(storeUrl({ ext_id: '{1234-abcd}', name: 'X', version: '' }, 'firefox'), /addons\.mozilla\.org\/firefox\/search\/\?q=X/);
  assert.match(storeUrl({ ext_id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', name: 'uBO', version: '' }, 'chrome'), /chromewebstore\.google\.com/);
});
