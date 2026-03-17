import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 每个测试使用独立的临时文件，避免模块级队列状态干扰
function tmpConfig() {
  return join(tmpdir(), `openclaw-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

async function cleanup(...paths) {
  for (const p of paths) {
    if (existsSync(p)) await unlink(p).catch(() => {});
    if (existsSync(p + '.tmp')) await unlink(p + '.tmp').catch(() => {});
  }
}

test('updateConfig 在文件不存在时创建基本结构并写入', async () => {
  const { updateConfig } = await import('../src/services/configManager.js');
  const cfg = tmpConfig();

  await updateConfig((config) => {
    config.agents.list.push({ id: 'test-agent', workspace: '/tmp/test' });
  }, cfg);

  const data = JSON.parse(await readFile(cfg, 'utf8'));
  assert.equal(data.agents.list.length, 1);
  assert.equal(data.agents.list[0].id, 'test-agent');
  await cleanup(cfg);
});

test('updateConfig 保留已有配置内容', async () => {
  const { updateConfig } = await import('../src/services/configManager.js');
  const cfg = tmpConfig();

  const initial = {
    agents: { list: [{ id: 'existing', workspace: '/tmp/existing' }] },
    bindings: [{ agentId: 'existing', match: { peer: 'old-peer' } }],
  };
  await writeFile(cfg, JSON.stringify(initial), 'utf8');

  await updateConfig((config) => {
    config.agents.list.push({ id: 'new-agent', workspace: '/tmp/new' });
  }, cfg);

  const data = JSON.parse(await readFile(cfg, 'utf8'));
  assert.equal(data.agents.list.length, 2);
  assert.equal(data.agents.list[0].id, 'existing');
  assert.equal(data.agents.list[1].id, 'new-agent');
  assert.equal(data.bindings.length, 1);
  await cleanup(cfg);
});

test('并发 updateConfig 批量写入，所有更新均被保存', async () => {
  const { updateConfig } = await import('../src/services/configManager.js');
  const cfg = tmpConfig();

  // 同时触发 10 个并发更新
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateConfig((config) => {
        config.agents.list.push({ id: `agent-${i}`, workspace: `/tmp/ws-${i}` });
      }, cfg)
    )
  );

  const data = JSON.parse(await readFile(cfg, 'utf8'));
  assert.equal(data.agents.list.length, 10);

  const ids = new Set(data.agents.list.map((a) => a.id));
  for (let i = 0; i < 10; i++) {
    assert.ok(ids.has(`agent-${i}`), `agent-${i} 应该被保存`);
  }
  await cleanup(cfg);
});

test('updateConfig 中的错误不影响其他并发任务', async () => {
  const { updateConfig } = await import('../src/services/configManager.js');
  const cfg = tmpConfig();

  const results = await Promise.allSettled([
    updateConfig(() => { throw new Error('故意出错'); }, cfg),
    updateConfig((config) => {
      config.agents.list.push({ id: 'good-agent', workspace: '/tmp/good' });
    }, cfg),
  ]);

  // 第一个 reject，第二个 fulfill
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');

  const data = JSON.parse(await readFile(cfg, 'utf8'));
  assert.equal(data.agents.list.some((a) => a.id === 'good-agent'), true);
  await cleanup(cfg);
});

test('updateConfig 写入标准 JSON（非 JSON5）', async () => {
  const { updateConfig } = await import('../src/services/configManager.js');
  const cfg = tmpConfig();

  await updateConfig((config) => {
    config.agents.list.push({ id: 'json-test' });
  }, cfg);

  // 标准 JSON.parse 应能解析（不含注释/尾逗号）
  const raw = await readFile(cfg, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
  await cleanup(cfg);
});
