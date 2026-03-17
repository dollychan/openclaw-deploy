/**
 * POST /api/chat
 *
 * 核心路由：处理网页访客的聊天消息
 *
 * 流程：
 * 1. visitorAuth（已挂全局）→ 确认 visitorId
 * 2. rateLimiter → 限制访问频率
 * 3. inputValidator → 校验消息内容
 * 4. 查找或创建专属 Agent（防并发双重创建）
 * 5. 代理请求到 OpenClaw，流式返回响应
 *
 * 并发防重机制：
 * 同一访客的多个并发请求（如双击发送）会复用同一个 provision Promise，
 * 保证不会创建重复 Agent。
 */

import { Router } from 'express';
import * as agentRegistry from '../services/agentRegistry.js';
import { provisionAgent } from '../services/agentProvisioner.js';
import { streamResponse } from '../services/openclawProxy.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createInputValidator } from '../middleware/inputValidator.js';

/** @type {Map<string, Promise<string>>} visitorId → 进行中的 provision Promise */
const provisioningMap = new Map();

export function createChatRouter(cfg) {
  const router = Router();

  const rateLimiter = createRateLimiter(cfg);
  const inputValidator = createInputValidator(cfg);

  router.post('/', rateLimiter, inputValidator, async (req, res) => {
    const visitorId = req.visitorId;
    const { message } = req.body;

    try {
      // ── 获取或创建专属 Agent ───────────────────────────────────────────────
      const agentId = await getOrProvisionAgent(visitorId, cfg);

      // ── 代理 SSE 流 ────────────────────────────────────────────────────────
      await streamResponse({ agentId, visitorId, message, cfg, req, res });

    } catch (err) {
      console.error(`[chat] Error for visitor ${visitorId.slice(0, 12)}:`, err.message);

      // 若响应头还未发送，返回 JSON 错误
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process your message. Please try again.' });
      } else if (!res.writableEnded) {
        // SSE 已开始，发送 error 事件后关闭
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    }
  });

  return router;
}

/**
 * 获取或创建访客的专属 Agent ID
 * 利用 provisioningMap 防止同一访客的并发请求触发双重创建
 *
 * @param {string} visitorId
 * @param {object} cfg
 * @returns {Promise<string>} agentId
 */
async function getOrProvisionAgent(visitorId, cfg) {
  // 快路径：已有 Agent，直接返回
  const existing = agentRegistry.get(visitorId);
  if (existing) return existing;

  // 防并发：若已有进行中的 provision，等待它完成
  if (provisioningMap.has(visitorId)) {
    console.log(`[chat] Waiting for in-flight provision for visitor ${visitorId.slice(0, 12)}...`);
    return provisioningMap.get(visitorId);
  }

  // 慢路径：启动新的 provision 流程
  const provisionPromise = provisionAgent(visitorId, cfg)
    .finally(() => {
      // 无论成功或失败，清理 Map 中的 Promise
      provisioningMap.delete(visitorId);
    });

  provisioningMap.set(visitorId, provisionPromise);

  return provisionPromise;
}
