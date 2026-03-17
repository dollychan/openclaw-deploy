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

export function createSessionRouter(cfg) {
  const router = Router();

  // visitorAuth 已作为全局中间件运行，此处 req.visitorId 已可用
  router.get('/', (req, res) => {
    const visitorId = req.visitorId;
    const agentId = agentRegistry.get(visitorId);

    res.json({
      // 不暴露完整 visitorId，前端只需知道它的存在
      visitorKey: visitorId.slice(0, 8), // 仅前 8 位，用于 UI 显示
      agentProvisioned: agentId !== null,
      totalAgents: agentRegistry.size(),
    });
  });

  return router;
}
