# Visitor Identity 设计文档

## 概述

每个访问 Widget 的用户都会被分配一个持久化的访客身份（Visitor Identity），用于跨请求识别用户、绑定专属 Agent，以及维护对话历史。

---

## 身份生成流程

```
首次访问
  │
  ▼
generateVisitorId()
  → UUID v4（加密随机）
  → 格式：vis_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  │
  ▼
signVisitorId(visitorId, HMAC_SECRET)
  → HMAC-SHA256(visitorId, secret)
  → cookie 存储格式：vis_xxxx.<64位hex签名>
  │
  ▼
写入 httpOnly cookie "visitor_id"
  → 有效期：1 年
  → SameSite=Lax
  → Secure（仅生产环境 HTTPS）
```

---

## Cookie 格式

```
cookie name:  visitor_id
cookie value: vis_550e8400-e29b-41d4-a716-446655440000.a3f1c8d2e4b7...（64位hex）
```

`visitorKey`（API 返回给前端的字段）仅为 visitorId 的前 8 位，用于 UI 显示，不暴露完整 ID。

---

## 安全机制

### HMAC 防伪造

cookie 中存储的是 `visitorId + HMAC 签名`，服务端每次请求都重新计算签名并验证。攻击者无法在不知道 `HMAC_SECRET` 的情况下伪造其他用户的 visitorId。

### timingSafeEqual 防时序攻击

签名比较使用 Node.js `crypto.timingSafeEqual`，避免通过响应时间差异推断签名内容。

### httpOnly 防 XSS 窃取

cookie 设置 `httpOnly: true`，前端 JavaScript 无法读取，防止 XSS 攻击窃取身份。

---

## Cookie 生命周期

### 保留条件

| 场景 | 结果 |
|------|------|
| 关闭浏览器后重新打开 | ✅ 保留（持久化 cookie，非 session cookie） |
| 刷新页面 / 切换标签 | ✅ 保留 |
| 同一浏览器同一域名 | ✅ 最长保留 1 年 |

### 失效条件

| 场景 | 结果 |
|------|------|
| 用户手动清除 cookie | ❌ 重新生成新身份 |
| 更换浏览器或设备 | ❌ 重新生成新身份 |
| 隐私/无痕模式关闭窗口 | ❌ session 结束后丢失 |
| 服务端更换 `HMAC_SECRET` | ❌ 旧签名验证失败，自动颁发新身份 |

---

## 跨域限制

当前 cookie 设置为 `SameSite=Lax`，适用于 Widget 与 API 服务器**同域**部署的场景。

若需要将 Widget 嵌入**第三方域名**的网站（跨域调用 `/api/chat`），浏览器会在 POST 请求时拒绝携带 `SameSite=Lax` 的 cookie，导致每次请求都被视为新访客。

跨域部署需要将 cookie 改为 `SameSite=None; Secure`，同时需要：
- 服务器必须使用 HTTPS
- 配合 CORS 白名单（`Access-Control-Allow-Origin` 精确匹配）
- 浏览器需支持第三方 cookie（部分浏览器已开始限制）

---

## 身份与 Agent 的绑定关系

```
visitorId  ──registry──▶  agentId
(cookie)                  (openclaw.json)
```

- `registry.json`：持久化存储 visitorId → agentId 的映射
- 服务重启后从磁盘恢复映射，访客身份与 Agent 绑定不丢失
- 若 registry 写入失败（磁盘错误等），下次请求会重新触发 Agent 创建流程（幂等）
