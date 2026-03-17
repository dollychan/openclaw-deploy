import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputValidator } from '../src/middleware/inputValidator.js';

/** 创建 Express req/res/next 的轻量 mock */
function makeMocks(body = {}) {
  const req = { body };
  const res = {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next: () => { nextCalled = true; }, isNextCalled: () => nextCalled };
}

const validator = createInputValidator({ maxInputLength: 100 });

test('正常消息通过验证并写回清理后的内容', () => {
  const { req, res, next, isNextCalled } = makeMocks({ message: '  你好！  ' });
  validator(req, res, next);
  assert.equal(isNextCalled(), true);
  assert.equal(req.body.message, '你好！');
});

test('缺少 message 字段返回 400', () => {
  const { req, res, next } = makeMocks({});
  validator(req, res, next);
  assert.equal(res._status, 400);
  assert.match(res._json.error, /required/);
});

test('message 为非字符串返回 400', () => {
  for (const bad of [123, true, null, [], {}]) {
    const { req, res, next } = makeMocks({ message: bad });
    validator(req, res, next);
    assert.equal(res._status, 400);
  }
});

test('纯空白消息返回 400', () => {
  const { req, res, next } = makeMocks({ message: '   \t  ' });
  validator(req, res, next);
  assert.equal(res._status, 400);
  assert.match(res._json.error, /empty/);
});

test('超长消息返回 400 并附带 maxLength', () => {
  const { req, res, next } = makeMocks({ message: 'a'.repeat(101) });
  validator(req, res, next);
  assert.equal(res._status, 400);
  assert.equal(res._json.maxLength, 100);
});

test('恰好 maxLength 字符的消息通过验证', () => {
  const { req, res, next, isNextCalled } = makeMocks({ message: 'a'.repeat(100) });
  validator(req, res, next);
  assert.equal(isNextCalled(), true);
});

test('控制字符（null 字节）被移除', () => {
  const { req, res, next, isNextCalled } = makeMocks({ message: 'hello\x00world' });
  validator(req, res, next);
  assert.equal(isNextCalled(), true);
  assert.equal(req.body.message, 'helloworld');
});

test('换行符和制表符被保留', () => {
  const { req, res, next, isNextCalled } = makeMocks({ message: 'line1\nline2\ttab' });
  validator(req, res, next);
  assert.equal(isNextCalled(), true);
  assert.equal(req.body.message, 'line1\nline2\ttab');
});

test('纯控制字符消息返回 400', () => {
  const { req, res, next } = makeMocks({ message: '\x00\x01\x02' });
  validator(req, res, next);
  assert.equal(res._status, 400);
  assert.match(res._json.error, /invalid characters/);
});
