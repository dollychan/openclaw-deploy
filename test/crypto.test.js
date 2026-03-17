import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signVisitorId, verifyVisitorId } from '../src/utils/crypto.js';

const SECRET = 'a'.repeat(32);

test('signVisitorId 返回 visitorId.signature 格式', () => {
  const signed = signVisitorId('vis_abc', SECRET);
  assert.match(signed, /^vis_abc\.[0-9a-f]{64}$/);
});

test('signVisitorId 对相同输入产生相同签名（确定性）', () => {
  assert.equal(signVisitorId('vis_abc', SECRET), signVisitorId('vis_abc', SECRET));
});

test('signVisitorId 对不同 secret 产生不同签名', () => {
  const s1 = signVisitorId('vis_abc', 'a'.repeat(32));
  const s2 = signVisitorId('vis_abc', 'b'.repeat(32));
  assert.notEqual(s1, s2);
});

test('verifyVisitorId 验证合法签名成功', () => {
  const signed = signVisitorId('vis_test123', SECRET);
  const result = verifyVisitorId(signed, SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.visitorId, 'vis_test123');
});

test('verifyVisitorId 拒绝篡改的签名', () => {
  const signed = signVisitorId('vis_test123', SECRET);
  const tampered = signed.slice(0, -4) + 'ffff';
  const result = verifyVisitorId(tampered, SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.visitorId, null);
});

test('verifyVisitorId 拒绝错误的 secret', () => {
  const signed = signVisitorId('vis_test123', SECRET);
  const result = verifyVisitorId(signed, 'b'.repeat(32));
  assert.equal(result.valid, false);
});

test('verifyVisitorId 拒绝无点分隔符的字符串', () => {
  const result = verifyVisitorId('nodot', SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.visitorId, null);
});

test('verifyVisitorId 拒绝 null / undefined / 空字符串', () => {
  for (const bad of [null, undefined, '', 42]) {
    const result = verifyVisitorId(bad, SECRET);
    assert.equal(result.valid, false);
    assert.equal(result.visitorId, null);
  }
});

test('verifyVisitorId 拒绝只有签名（无 visitorId）的字符串', () => {
  const result = verifyVisitorId('.abc123', SECRET);
  assert.equal(result.valid, false);
});
