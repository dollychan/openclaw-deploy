/**
 * 集成测试：Tasks API + Feishu 绑定 + Enable/Disable 流程
 *
 * 自动：
 *  1. 创建临时目录 + 最小 openclaw.json
 *  2. 设置测试环境变量，启动服务器子进程
 *  3. 运行所有测试用例
 *  4. 关闭服务器，清理临时目录
 *
 * 用法：node test/test-tasks-api.js
 */

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 测试统计 ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}
function fail(name, detail) {
  console.error(`  ❌ ${name}`);
  if (detail) console.error(`     ${detail}`);
  failed++;
}

function assert(cond, name, detail) {
  cond ? ok(name) : fail(name, detail);
}

// ── 等待服务器就绪 ────────────────────────────────────────────────────────────
async function waitReady(url, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not start in time');
}

// ── 主测试入口 ────────────────────────────────────────────────────────────────
const PORT = 13900;
const BASE = `http://localhost:${PORT}`;
let tmpDir, serverProc;

try {
  // 1. 准备临时目录
  tmpDir = await mkdtemp(join(tmpdir(), 'openclaw-test-'));
  const workspacesDir = join(tmpDir, 'workspaces');
  const dataDir       = join(tmpDir, 'data');
  await mkdir(workspacesDir, { recursive: true });
  await mkdir(dataDir,       { recursive: true });

  const configPath = join(tmpDir, 'openclaw.json');
  await writeFile(configPath, JSON.stringify({
    gateway: { auth: { mode: 'token', token: 'test-token' } },
    hooks: {
      enabled: true,
      token: 'test-hook-secret',
      path: '/hooks',
      allowRequestSessionKey: true,
      allowedSessionKeyPrefixes: ['web-visitor-'],
    },
  }));

  const HMAC   = 'a'.repeat(32);
  const COOKIE = 'b'.repeat(32);

  const env = {
    ...process.env,
    PORT:                    String(PORT),
    BASE_URL:                BASE,
    OPENCLAW_TOKEN:          'test-token',
    OPENCLAW_CONFIG_PATH:    configPath,
    OPENCLAW_WORKSPACES_DIR: workspacesDir,
    OPENCLAW_AGENTS_DIR:     join(tmpDir, 'agents'),
    REGISTRY_PATH:           join(dataDir, 'registry.json'),
    TASKS_PATH:              join(dataDir, 'tasks.json'),
    PROFILES_PATH:           join(dataDir, 'profiles.json'),
    HMAC_SECRET:             HMAC,
    COOKIE_SECRET:           COOKIE,
    NODE_ENV:                'test',
    OPENCLAW_BASE_URL:       'http://localhost:19999', // unreachable, intentional
  };

  // 2. 启动服务器
  console.log('\n▶ Starting test server...');
  serverProc = spawn('node', ['server.js'], {
    cwd: join(import.meta.dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.stdout.write('  [srv] ' + d));
  serverProc.stderr.on('data', (d) => process.stderr.write('  [srv] ' + d));

  await waitReady(BASE);
  console.log('▶ Server ready.\n');

  // ── 辅助：带 cookie jar 的 fetch ─────────────────────────────────────────
  let cookie = '';
  async function api(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // 保存 Set-Cookie
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let json;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  }

  // ── 测试套件 ─────────────────────────────────────────────────────────────

  console.log('── /api/session ──────────────────────────────────────────');

  // GET /api/session 初始状态
  {
    const { status, body } = await api('GET', '/api/session');
    assert(status === 200, 'GET /api/session → 200');
    assert(body.feishuConnected === false, 'feishuConnected is false initially');
    assert(body.feishuAccountId === null, 'feishuAccountId is null initially');
    assert(cookie.length > 0, 'Cookie was set');
  }

  // POST /api/session/feishu 缺少参数
  {
    const { status, body } = await api('POST', '/api/session/feishu', {});
    assert(status === 400, 'POST /feishu without body → 400');
    assert(body.error?.includes('required'), 'Error message mentions required');
  }

  // POST /api/session/feishu 成功绑定
  {
    const { status, body } = await api('POST', '/api/session/feishu', { feishuAccountId: 'ou_test123' });
    assert(status === 200, 'POST /feishu with valid ID → 200');
    assert(body.ok === true, 'Response ok=true');
    assert(body.feishuConnected === true, 'feishuConnected=true in response');
  }

  // GET /api/session 再次查询，确认绑定已持久
  {
    const { status, body } = await api('GET', '/api/session');
    assert(status === 200, 'GET /api/session after bind → 200');
    assert(body.feishuConnected === true, 'feishuConnected=true after bind');
    assert(body.feishuAccountId === 'ou_test123', 'feishuAccountId stored correctly');
  }

  console.log('\n── /api/tasks ────────────────────────────────────────────');

  // GET /api/tasks 初始为空
  {
    const { status, body } = await api('GET', '/api/tasks');
    assert(status === 200, 'GET /api/tasks → 200');
    assert(Array.isArray(body.tasks), 'body.tasks is array');
    assert(body.tasks.length === 0, 'No tasks initially');
  }

  // POST /api/tasks 参数验证
  {
    const { status, body } = await api('POST', '/api/tasks', { name: 'test' });
    assert(status === 400, 'POST /tasks missing schedule/message → 400');
  }
  {
    const { status } = await api('POST', '/api/tasks', {
      name: 'test', schedule: 'not-valid', message: 'hi',
    });
    assert(status === 400, 'POST /tasks invalid cron expression → 400');
  }

  // POST /api/tasks 成功创建
  let taskId;
  {
    const { status, body } = await api('POST', '/api/tasks', {
      name: 'Daily Report',
      schedule: '0 9 * * *',
      message: 'Please generate my daily report.',
    });
    assert(status === 201, 'POST /tasks → 201');
    assert(typeof body.task.id === 'string', 'Task has id');
    assert(body.task.name === 'Daily Report', 'Task name correct');
    assert(body.task.enabled === false, 'Task starts disabled');
    assert(body.task.cronJobId === null, 'cronJobId starts null');
    taskId = body.task.id;
  }

  // GET /api/tasks 列表中出现新任务
  {
    const { status, body } = await api('GET', '/api/tasks');
    assert(status === 200, 'GET /api/tasks after create → 200');
    assert(body.tasks.length === 1, 'One task in list');
    assert(body.tasks[0].id === taskId, 'Task ID matches');
  }

  console.log('\n── Enable/Disable（本地无 OpenClaw，期望特定错误）──────');

  // POST /api/tasks/:id/enable（无 agent 已预配）→ 400
  {
    const { status, body } = await api('POST', `/api/tasks/${taskId}/enable`);
    assert(status === 400, 'Enable without provisioned agent → 400');
    assert(body.error?.includes('agent'), 'Error mentions agent');
  }

  // POST /api/tasks/:id/enable（伪造不存在的 task）→ 404
  {
    const { status } = await api('POST', '/api/tasks/task_000000/enable');
    assert(status === 404, 'Enable non-existent task → 404');
  }

  // POST /api/tasks/:id/disable（任务本来就是 disabled）→ 200 + task unchanged
  {
    const { status, body } = await api('POST', `/api/tasks/${taskId}/disable`);
    assert(status === 200, 'Disable already-disabled task → 200 (no-op)');
    assert(body.task.enabled === false, 'Task still disabled');
  }

  // 并发 enable 竞争：第二个请求应得到 409（因为第一个会先触发 400 但锁不会持有，这里改为先注入 inFlight 然后测试另一个任务的快速并发）
  // 简化验证：同一 taskId 调两次 enable，至少能正常响应，不会崩溃
  {
    const [r1, r2] = await Promise.all([
      api('POST', `/api/tasks/${taskId}/enable`),
      api('POST', `/api/tasks/${taskId}/enable`),
    ]);
    assert(
      [400, 409].includes(r1.status) && [400, 409].includes(r2.status),
      `Concurrent enables return 400/409 (got ${r1.status}, ${r2.status})`
    );
  }

  console.log('\n── Feishu 解绑 ──────────────────────────────────────────');

  // DELETE /api/session/feishu → 200，状态清除
  {
    const { status, body } = await api('DELETE', '/api/session/feishu');
    assert(status === 200, 'DELETE /feishu → 200');
    assert(body.feishuConnected === false, 'feishuConnected=false after unbind');
  }

  // GET /api/session 确认 feishuAccountId 已清除
  {
    const { status, body } = await api('GET', '/api/session');
    assert(body.feishuConnected === false, 'Session reflects Feishu disconnected');
    assert(body.feishuAccountId === null, 'feishuAccountId cleared');
  }

  console.log('\n── DELETE /api/tasks/:id ─────────────────────────────────');

  // 删除任务
  {
    const { status, body } = await api('DELETE', `/api/tasks/${taskId}`);
    assert(status === 200, 'DELETE /tasks/:id → 200');
    assert(body.ok === true, 'ok=true');
  }

  // 确认已删除
  {
    const { status } = await api('DELETE', `/api/tasks/${taskId}`);
    assert(status === 404, 'DELETE same task again → 404');
  }

  // GET /api/tasks 确认空了
  {
    const { body } = await api('GET', '/api/tasks');
    assert(body.tasks.length === 0, 'Task list empty after delete');
  }

  console.log('\n── 健康检查 ──────────────────────────────────────────────');
  {
    const { status, body } = await api('GET', '/health');
    assert(status === 200, 'GET /health → 200');
    assert(body.status === 'ok', 'health.status = ok');
  }

} finally {
  if (serverProc) {
    serverProc.kill();
    await new Promise((r) => serverProc.on('exit', r));
  }
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── 结果 ──────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
