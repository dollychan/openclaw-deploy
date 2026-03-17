/**
 * GET /api/session
 *
 * 功能：
 * - 通过 visitorAuth 中间件为新访客颁发签名 cookie（自动完成）
 * - 返回访客的当前状态：是否已有专属 Agent
 *
 * 前端在页面加载时调用此接口，以：
 * 1. 确保 cookie 已设置（触发 visitorAuth 的新访客逻辑）
 * 2. 了解是否需要展示"首次连接"提示
 */

import { Router } from 'express';
import * as agentRegistry from '../services/agentRegistry.js';
import * as visitorProfile from '../services/visitorProfile.js';
import * as taskManager from '../services/taskManager.js';
import * as cronManager from '../services/cronManager.js';

export function createSessionRouter(cfg) {
  const router = Router();

  // visitorAuth 已作为全局中间件运行，此处 req.visitorId 已可用
  router.get('/', (req, res) => {
    const visitorId = req.visitorId;
    const agentId = agentRegistry.get(visitorId);
    const profile = visitorProfile.get(visitorId);

    res.json({
      visitorKey: visitorId.slice(0, 8),
      agentProvisioned: agentId !== null,
      feishuConnected: Boolean(profile.feishuAccountId),
      feishuAccountId: profile.feishuAccountId ?? null,
    });
  });

  // 绑定飞书账号
  router.post('/feishu', (req, res) => {
    const { feishuAccountId } = req.body ?? {};

    if (!feishuAccountId || typeof feishuAccountId !== 'string' || feishuAccountId.trim().length === 0) {
      return res.status(400).json({ error: 'feishuAccountId is required' });
    }
    if (feishuAccountId.trim().length > 200) {
      return res.status(400).json({ error: 'feishuAccountId too long' });
    }

    visitorProfile.update(req.visitorId, { feishuAccountId: feishuAccountId.trim() });
    res.json({ ok: true, feishuConnected: true });
  });

  // 解绑飞书账号（同时停用所有已激活的 cron 任务，防止继续向旧账号推送）
  router.delete('/feishu', async (req, res) => {
    const tasks = taskManager.list(req.visitorId);
    const enabledTasks = tasks.filter((t) => t.enabled && t.cronJobId);

    // 先清除所有激活的 cron，失败单条不影响整体
    await Promise.allSettled(
      enabledTasks.map(async (t) => {
        try {
          await cronManager.deleteCron(t.cronJobId);
          taskManager.update(req.visitorId, t.id, { enabled: false, cronJobId: null });
        } catch (err) {
          console.warn(`[session] Failed to remove cron ${t.cronJobId} on Feishu unbind: ${err.message}`);
        }
      })
    );

    visitorProfile.update(req.visitorId, { feishuAccountId: null });
    res.json({ ok: true, feishuConnected: false });
  });

  return router;
}
