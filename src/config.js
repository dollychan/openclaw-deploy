/**
 * 集中配置加载器
 * 从环境变量加载所有配置，启动时验证必填项
 * 导出冻结的配置对象，防止运行时意外修改
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

/**
 * 加载并验证配置
 * @returns {object} 冻结的配置对象
 */
export function loadConfig() {
  // ── 必填项验证 ─────────────────────────────────────────────────────────────
  const required = [
    'OPENCLAW_TOKEN',
    'OPENCLAW_CONFIG_PATH',
    'OPENCLAW_WORKSPACES_DIR',
    'HMAC_SECRET',
    'COOKIE_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please copy .env.example to .env and fill in the values.`
    );
  }

  // ── HMAC 密钥长度检查 ──────────────────────────────────────────────────────
  if (process.env.HMAC_SECRET.length < 32) {
    throw new Error('HMAC_SECRET must be at least 32 characters long for security.');
  }

  const cfg = {
    // OpenClaw 连接
    openclawBaseUrl: process.env.OPENCLAW_BASE_URL ?? 'http://localhost:18789',
    openclawToken: process.env.OPENCLAW_TOKEN,

    // 文件系统路径
    openclawConfigPath: resolve(process.env.OPENCLAW_CONFIG_PATH),
    openclawWorkspacesDir: resolve(process.env.OPENCLAW_WORKSPACES_DIR),
    templateDir: resolve(process.env.TEMPLATE_DIR ?? join(PROJECT_ROOT, 'templates')),
    registryPath: resolve(process.env.REGISTRY_PATH ?? join(PROJECT_ROOT, 'data', 'registry.json')),
    tasksPath: resolve(process.env.TASKS_PATH ?? join(PROJECT_ROOT, 'data', 'tasks.json')),
    profilesPath: resolve(process.env.PROFILES_PATH ?? join(PROJECT_ROOT, 'data', 'profiles.json')),

    // Web 服务
    port: parseInt(process.env.PORT ?? '3000', 10),
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV ?? 'development',

    // 安全
    hmacSecret: process.env.HMAC_SECRET,
    cookieSecret: process.env.COOKIE_SECRET,

    // 限流
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10),

    // Agent
    agentIdPrefix: process.env.AGENT_ID_PREFIX ?? 'web-visitor-',
    maxInputLength: parseInt(process.env.MAX_INPUT_LENGTH ?? '2000', 10),
  };

  return Object.freeze(cfg);
}

// 辅助函数：在配置中使用 join（避免循环依赖）
function join(...parts) {
  return resolve(...parts);
}
