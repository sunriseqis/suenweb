import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayName, normalizeNameKey, normalizeUrl } from '../src/domain/normalize.ts';

test('分组名归一化：trim、空白折叠、大小写不敏感、NFKC', () => {
  assert.equal(displayName('  阅读  列表 '), '阅读 列表');
  assert.equal(normalizeNameKey('  Dev  Tools '), 'dev tools');
  assert.equal(normalizeNameKey('ＤＥＶ'), 'dev');
});

test('URL 归一化：主机小写、去默认端口、去尾斜杠、去跟踪参数、query 排序', () => {
  assert.equal(normalizeUrl('Example.COM/a/?utm_source=x#frag').normalized, 'https://example.com/a');
  assert.equal(normalizeUrl('http://example.com:80/x').normalized, 'http://example.com/x');
  assert.equal(normalizeUrl('https://example.com:443/x').normalized, 'https://example.com/x');
  assert.equal(normalizeUrl('https://example.com/x?b=2&a=1').normalized, 'https://example.com/x?a=1&b=2');
  assert.equal(normalizeUrl('https://example.com/x?fbclid=abc').normalized, 'https://example.com/x');
});

test('URL 归一化：缺协议补 https，非 http(s) 拒绝', () => {
  assert.equal(normalizeUrl('example.com').url, 'https://example.com/');
  assert.equal(normalizeUrl('example.com').normalized, 'https://example.com');
  assert.throws(() => normalizeUrl('ftp://example.com/x'), /只支持/);
  assert.throws(() => normalizeUrl('   '), /不能为空/);
});
