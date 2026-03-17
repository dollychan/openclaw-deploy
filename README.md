# OpenClaw Web Widget

为每位网页访客自动预配专属 OpenClaw Agent，实现**记忆隔离 + 人设隔离**的嵌入式 AI 助手。

## 架构

```
访客浏览器
  └── widget.js（同域嵌入）
        └── POST /api/chat  →  [本服务]  →  OpenClaw Hooks  →  AI 模型
                                    └── 按 visitorId 自动创建/路由 Agent
```

每位访客首次访问时，服务会自动：
1. 从 `templates/` 复制 workspace（SOUL.md / USER.md / AGENTS.md / IDENTITY.md）
2. 在 OpenClaw 注册专属 Agent
3. 添加路由 binding，后续请求始终路由到同一 Agent

## 前置条件

- Node.js >= 22
- OpenClaw Gateway 已运行（默认 `http://localhost:18789`）
- OpenClaw `hooks` 已在 `openclaw.json` 中启用

**openclaw.json 最小配置：**

```json5
{
  gateway: {
    auth: { mode: "token", token: "your_token" },
    bind: "loopback",
  },
  hooks: {
    enabled: true,
    token: "your_hook_secret",
    path: "/hooks",
    allowRequestSessionKey: true,
    allowedSessionKeyPrefixes: ["web-visitor-"],
  },
  session: { scope: "per-sender" },
}
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填写 OPENCLAW_TOKEN、HMAC_SECRET 等

# 3. 生成随机密钥（示例）
openssl rand -hex 32   # 用于 HMAC_SECRET
openssl rand -hex 32   # 用于 COOKIE_SECRET

# 4. 启动
npm start              # 生产
npm run dev            # 开发（自动重启）
```

## 嵌入 Widget

在与本服务**同域**的任意页面中添加：

```html
<script
  src="https://yourserver.com/widget.js"
  data-title="AI 助手"
  data-color="#6366f1"
  data-welcome="你好！有什么可以帮你？">
</script>
```

| 属性 | 说明 | 默认值 |
|------|------|--------|
| `data-title` | 聊天窗口标题 | `Assistant` |
| `data-color` | 主题色 | `#6366f1` |
| `data-welcome` | 欢迎语 | `Hi! How can I help you today?` |
| `data-placeholder` | 输入框占位文字 | `Type a message…` |
| `data-api-base` | 后端地址（同域可省略） | 当前页面 origin |

## 部署

```bash
# 安装依赖
npm install --omit=dev

# 启动服务（使用 pm2 保持后台运行）
npm install -g pm2
pm2 start src/server.js --name openclaw-widget
pm2 save
pm2 startup   # 按提示执行以设置开机自启
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENCLAW_TOKEN` | ✅ | OpenClaw gateway.auth.token |
| `OPENCLAW_CONFIG_PATH` | ✅ | openclaw.json 路径 |
| `OPENCLAW_WORKSPACES_DIR` | ✅ | 用户 workspace 根目录 |
| `HMAC_SECRET` | ✅ | visitorId HMAC 签名密钥（≥32字符） |
| `COOKIE_SECRET` | ✅ | cookie 签名密钥 |
| `OPENCLAW_BASE_URL` | | OpenClaw 地址（默认 `http://localhost:18789`） |
| `BASE_URL` | | 本服务公网地址（用于 CORS） |
| `PORT` | | 监听端口（默认 `3000`） |
| `RATE_LIMIT_MAX_REQUESTS` | | 每分钟最大请求数（默认 `20`） |
| `MAX_INPUT_LENGTH` | | 单条消息最大字符数（默认 `2000`） |

## 安全说明

- Widget 仅支持**同域嵌入**，CORS 限制为 `BASE_URL`
- Cookie 使用 `HttpOnly + SameSite=Lax + HMAC 签名`，防止 XSS 窃取与 CSRF
- visitorId 由服务端签发，客户端无法伪造他人身份
- OpenClaw 连接 Token 仅存在服务端，不暴露给浏览器

## 反向代理注意事项

SSE 流式响应需要关闭缓冲，Nginx 示例：

```nginx
location /api/chat {
    proxy_pass http://localhost:3000;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 120s;
    proxy_set_header Connection '';
    chunked_transfer_encoding on;
}
```
