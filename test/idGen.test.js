import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateVisitorId, generateAgentId } from '../src/utils/idGen.js';

test('generateVisitorId 以 vis_ 开头', () => {
  assert.match(generateVisitorId(), /^vis_/);
});

test('generateVisitorId 格式为 vis_<uuid-v4>', () => {
  const id = generateVisitorId();
  // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  assert.match(id, /^vis_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('generateVisitorId 每次产生不同的值', () => {
  const ids = new Set(Array.from({ length: 100 }, generateVisitorId));
  assert.equal(ids.size, 100);
});

test('generateAgentId 使用默认前缀', () => {
  assert.match(generateAgentId(), /^web-visitor-[0-9a-f]{16}$/);
});

test('generateAgentId 使用自定义前缀', () => {
  assert.match(generateAgentId('custom-'), /^custom-[0-9a-f]{16}$/);
});

test('generateAgentId 每次产生不同的值', () => {
  const ids = new Set(Array.from({ length: 100 }, generateAgentId));
  assert.equal(ids.size, 100);
});
