import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as registry from '../src/services/agentRegistry.js';

// 测试用的注册表临时文件
const TMP_REGISTRY = join(tmpdir(), `registry-test-${Date.now()}.json`);

after(async () => {
  if (existsSync(TMP_REGISTRY)) await unlink(TMP_REGISTRY);
  if (existsSync(TMP_REGISTRY + '.tmp')) await unlink(TMP_REGISTRY + '.tmp');
});

test('初始状态：size 为 0', () => {
  assert.equal(registry.size(), 0);
});

test('has() 对未注册的 visitorId 返回 false', () => {
  assert.equal(registry.has('vis_not_exist'), false);
});

test('get() 对未注册的 visitorId 返回 null', () => {
  assert.equal(registry.get('vis_not_exist'), null);
});

test('set() + get() 正确保存并读取映射', () => {
  registry.set('vis_aaa', 'web-visitor-agent1', TMP_REGISTRY);
  assert.equal(registry.get('vis_aaa'), 'web-visitor-agent1');
});

test('set() 后 has() 返回 true', () => {
  registry.set('vis_bbb', 'web-visitor-agent2', TMP_REGISTRY);
  assert.equal(registry.has('vis_bbb'), true);
});

test('size() 随 set() 递增', () => {
  const before = registry.size();
  registry.set(`vis_size_test_${Date.now()}`, 'agent-x', TMP_REGISTRY);
  assert.equal(registry.size(), before + 1);
});

test('set() 可以覆盖已有映射', () => {
  registry.set('vis_overwrite', 'agent-old', TMP_REGISTRY);
  registry.set('vis_overwrite', 'agent-new', TMP_REGISTRY);
  assert.equal(registry.get('vis_overwrite'), 'agent-new');
});

test('load() 从磁盘恢复映射', async () => {
  const data = { 'vis_loaded': 'agent-from-disk' };
  await writeFile(TMP_REGISTRY, JSON.stringify(data), 'utf8');

  await registry.load(TMP_REGISTRY);
  assert.equal(registry.get('vis_loaded'), 'agent-from-disk');
});

test('load() 在文件不存在时不抛出错误', async () => {
  await assert.doesNotReject(() => registry.load('/nonexistent/path/registry.json'));
});

test('持久化：set() 后文件最终写入磁盘', async () => {
  registry.set('vis_persist_check', 'agent-persist', TMP_REGISTRY);
  // 等待防抖写入（100ms + 余量）
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(existsSync(TMP_REGISTRY), true);
  const { readFile } = await import('node:fs/promises');
  const content = JSON.parse(await readFile(TMP_REGISTRY, 'utf8'));
  assert.equal(content['vis_persist_check'], 'agent-persist');
});
