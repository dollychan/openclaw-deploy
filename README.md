# OpenClaw Web Widget

为每位网页访客自动预配专属 OpenClaw Agent，实现**记忆隔离 + 人设隔离**的嵌入式 AI 助手。支持访客绑定飞书账号，并为 Agent 设置定时任务，将结果推送至飞书。

## 架构

```
访客浏览器
  └── widget.js（同域嵌入）
        ├── POST /api/chat      →  [本服务]  →  OpenClaw Hooks  →  AI 模型
        ├── /api/session        →  访客身份 + 飞书账号管理
        └── /api/tasks          →  定时任务 CRUD + enable/disable
                                        └── openclaw cron add/delete（CLI）
                                                └── 结果推送至飞书
```

每位访客首次访问时，服务会自动：
1. 从 `templates/` 复制 workspace（SOUL.md / USER.md / AGENTS.md / IDENTITY.md）
2. 在 OpenClaw 注册专属 Agent
3. 后续请求始终路由到同一 Agent（session key: `agent:<agentId>:main`）

## 功能

### 聊天
- 流式 SSE 响应，支持打字指示器
- 每位访客拥有独立 Agent，记忆完全隔离

### 定时任务（Scheduled Tasks）
访客可在 Widget 的任务面板中管理定时任务：

1. **绑定飞书账号** — 填写飞书 user/open ID，作为任务结果的推送目标
2. **创建任务** — 填写任务名称、cron 表达式、触发消息
3. **启用任务** — 开关打开后，任务注册到 OpenClaw cron，按计划向 Agent 发送消息并将回复推送至飞书
4. **停用/删除任务** — 同步从 OpenClaw cron 中移除
5. **解绑飞书** — 自动停用所有激活中的 cron 任务

不同访客之间的任务执行和推送结果完全隔离（通过 `--session agent:<agentId>:main` 路由到各自的 Agent）。

## 前置条件

- Node.js >= 22
- OpenClaw Gateway 已运行（默认 `http://localhost:18789`）
- OpenClaw `hooks` 已在 `openclaw.json` 中启用
- （可选）飞书集成已在 OpenClaw 中配置（用于定时任务推送）

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

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/session` | 获取访客状态（agentProvisioned、feishuConnected） |
| `POST` | `/api/session/feishu` | 绑定飞书账号 `{ feishuAccountId }` |
| `DELETE` | `/api/session/feishu` | 解绑飞书账号（同时停用所有 cron） |
| `POST` | `/api/chat` | 发送消息，SSE 流式响应 |
| `GET` | `/api/tasks` | 获取当前访客的所有任务 |
| `POST` | `/api/tasks` | 创建任务 `{ name, schedule, message }` |
| `DELETE` | `/api/tasks/:taskId` | 删除任务（已启用则先清除 cron） |
| `POST` | `/api/tasks/:taskId/enable` | 启用任务（需已绑定飞书） |
| `POST` | `/api/tasks/:taskId/disable` | 停用任务 |

## 部署

```bash
# 安装依赖
npm install --omit=dev

# 启动服务（使用 pm2 保持后台运行）
npm install -g pm2
pm2 start server.js --name openclaw-widget
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
| `REGISTRY_PATH` | | visitorId→agentId 映射文件（默认 `data/registry.json`） |
| `TASKS_PATH` | | 任务持久化文件（默认 `data/tasks.json`） |
| `PROFILES_PATH` | | 访客配置文件（默认 `data/profiles.json`） |
| `RATE_LIMIT_MAX_REQUESTS` | | 每分钟最大请求数（默认 `20`） |
| `MAX_INPUT_LENGTH` | | 单条消息最大字符数（默认 `2000`） |

## 数据文件

服务运行时会在 `data/` 目录下自动创建三个持久化文件：

| 文件 | 内容 |
|------|------|
| `data/registry.json` | visitorId → agentId 映射 |
| `data/tasks.json` | 每位访客的定时任务列表 |
| `data/profiles.json` | 每位访客的个人配置（飞书账号等） |

## 安全说明

- Widget 仅支持**同域嵌入**，CORS 限制为 `BASE_URL`
- Cookie 使用 `HttpOnly + SameSite=Lax + HMAC 签名`，防止 XSS 窃取与 CSRF
- visitorId 由服务端签发，客户端无法伪造他人身份
- OpenClaw 连接 Token 仅存在服务端，不暴露给浏览器
- Widget 所有动态内容通过 DOM API 设置，无 innerHTML 注入风险

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
