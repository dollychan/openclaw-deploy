# OpenClaw Workspace 行为说明

## 背景

在为每位访客动态创建专属 Agent 时，发现 OpenClaw 在文件系统上的 workspace 行为与预期不一致，经过调试最终确认为 OpenClaw 的设计特性。

---

## 观察到的现象

1. 在 `openclaw.json` 中为 visitor agent 配置了：
   ```json
   {
     "id": "web-visitor-xxxx",
     "workspace": "/root/.openclaw/workspaces/web-visitor-xxxx",
     "agentDir": "/root/.openclaw/agents/web-visitor-xxxx/agent"
   }
   ```

2. OpenClaw 在 `~/.openclaw/` 根目录下**额外创建**了：
   ```
   ~/.openclaw/workspace-web-visitor-xxxx/
   ```

3. Session 的 MEMORY.md 实际写入的是配置中 `workspace` 字段指定的路径（`workspaces/web-visitor-xxxx/`），而非上述额外创建的目录。

---

## 根本原因

OpenClaw 在初始化每个 agent 时，会**按命名约定**在 `~/.openclaw/` 下自动创建 `workspace-<agentId>` 目录，这是其默认初始化行为，不受 `workspace` 配置字段影响。

该目录为**空目录**，不用于实际的 session 写入。

---

## 关键结论

| 目录 | 用途 | 由谁创建 |
|------|------|---------|
| `workspaces/<agentId>/` | 配置的 workspace，存放 SOUL.md、USER.md、AGENTS.md、MEMORY.md | 本服务预创建（含模板文件） |
| `~/.openclaw/workspace-<agentId>/` | OpenClaw 按约定创建的空目录，无实际内容 | OpenClaw 自动创建 |
| `~/.openclaw/agents/<agentId>/` | session 历史、auth profiles、model 配置 | OpenClaw 自动创建 |

---

## agentDir 字段的重要性

早期曾尝试从 `openclaw.json` 的 agent 配置中**移除 `agentDir` 字段**，结果导致：

- OpenClaw 找不到 session 存储路径
- Fallback 到 `~/.openclaw/workspace-<agentId>/` 作为 session 工作目录
- MEMORY.md 被错误写入该目录，而非配置的 workspace

**结论**：`agentDir` 必须保留在 agent 配置中。OpenClaw 依赖它确定 session 和 auth 的存储位置。不需要手动预创建该目录——OpenClaw 在首次建立 session 时自动创建。

---

## 当前正确配置

```json
{
  "id": "web-visitor-xxxx",
  "workspace": "/root/.openclaw/workspaces/web-visitor-xxxx",
  "agentDir": "/root/.openclaw/agents/web-visitor-xxxx/agent",
  "identity": { "name": "Assistant", "emoji": "🤖" },
  "tools": { "deny": ["exec", "bash", "computer"] }
}
```

- `workspace`：本服务预创建，包含从 `templates/` 复制的人设文件
- `agentDir`：不需要预创建，OpenClaw 自动管理
- `~/.openclaw/workspace-<agentId>/`：OpenClaw 自动创建的空目录，可忽略

---

## 注意事项

- `~/.openclaw/workspace-<agentId>/` 会随 visitor agent 数量增长而积累，可定期清理
- agent 的 `models.json` 等文件**不需要手动复制**，OpenClaw 在首次建立 session 时自动创建
- `agentDir` 字段被移除时，OpenClaw 会静默 fallback 到错误的 workspace 路径，不会报错
