/**
 * OpenClaw Web Widget - 主入口
 *
 * 启动方式：
 *   node server.js          # 生产环境
 *   node --watch server.js  # 开发模式（自动重启）
 */

import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { loadConfig } from './src/config.js';
import { load as loadRegistry } from './src/services/agentRegistry.js';
import { createVisitorAuth } from './src/middleware/visitorAuth.js';
import { createSessionRouter } from './src/routes/session.js';
import { createChatRouter } from './src/routes/chat.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 加载并验证配置 ──────────────────────────────────────────────────────────
let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error('❌ Configuration error:', err.message);
  process.exit(1);
}

// ── 从磁盘恢复 Agent 映射 ───────────────────────────────────────────────────
await loadRegistry(cfg.registryPath);

// ── 创建 Express 应用 ────────────────────────────────────────────────────────
const app = express();

// ── 全局中间件 ────────────────────────────────────────────────────────────────

// Cookie 解析（必须在 visitorAuth 之前）
app.use(cookieParser(cfg.cookieSecret));

// JSON 请求体解析（限制 10kb，防止超大 payload）
app.use(express.json({ limit: '10kb' }));

// CORS：仅允许来自配置的 BASE_URL 的跨域请求
// 注意：Allow-Credentials: true 与 Allow-Origin: * 不能共存（浏览器会拒绝）
app.use((req, res, next) => {
  const allowedOrigin = cfg.baseUrl;
  const origin = req.headers.origin;

  if (origin) {
    // 有 Origin 头（浏览器跨域请求）：严格校验来源
    const isAllowed = cfg.nodeEnv === 'development' || origin === allowedOrigin;
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
  }
  // 无 Origin 头（同域请求、curl 等直接请求）：不设置 CORS 头，正常放行

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Visitor Auth：为所有 /api 路由注入 req.visitorId
app.use('/api', createVisitorAuth(cfg));

// ── 静态文件：widget.js ───────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('widget.js')) {
      // 允许跨域加载 widget.js（嵌入第三方网页时需要）
      res.setHeader('Access-Control-Allow-Origin', '*');
      // 缓存 1 小时
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// ── API 路由 ──────────────────────────────────────────────────────────────────
app.use('/api/session', createSessionRouter(cfg));
app.use('/api/chat', createChatRouter(cfg));

// ── 健康检查 ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 处理 ──────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── 全局错误处理 ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 启动服务器 ────────────────────────────────────────────────────────────────
app.listen(cfg.port, () => {
  console.log('');
  console.log('🤖 OpenClaw Web Widget Service');
  console.log('─'.repeat(40));
  console.log(`  ✅ Listening on  http://localhost:${cfg.port}`);
  console.log(`  🔗 OpenClaw at   ${cfg.openclawBaseUrl}`);
  console.log(`  📁 Workspaces    ${cfg.openclawWorkspacesDir}`);
  console.log(`  🌍 Base URL      ${cfg.baseUrl}`);
  console.log(`  🔒 Environment   ${cfg.nodeEnv}`);
  console.log('─'.repeat(40));
  console.log('');
  console.log('  Embed widget in any page with:');
  console.log(`  <script src="${cfg.baseUrl}/widget.js"></script>`);
  console.log('');
});
