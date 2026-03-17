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
      const { agentId, isNew } = await getOrProvisionAgent(visitorId, cfg);

      // ── 代理 SSE 流（新 Agent 需等待 OpenClaw 热重载）─────────────────────
      await streamResponseWithRetry({ agentId, visitorId, message, cfg, req, res, isNew });

    } catch (err) {
      console.error(`[chat] Error for visitor ${visitorId.slice(0, 12)}:`, err.message);

      // 若响应头还未发送，返回 JSON 错误
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process your message. Please try again.' });
      } else if (!res.writableEnded) {
        // SSE 已开始，发送 error 事件后关闭（不暴露内部错误详情）
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to process your message. Please try again.' })}\n\n`);
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
  // single 模式：直接使用固定 agent，每个访客创建独立 session
  if (cfg.agentMode === 'single') {
    return { agentId: cfg.singleAgentId, isNew: false };
  }

  // 快路径：已有 Agent，直接返回
  const existing = agentRegistry.get(visitorId);
  if (existing) return { agentId: existing, isNew: false };

  // 防并发：若已有进行中的 provision，等待它完成
  if (provisioningMap.has(visitorId)) {
    console.log(`[chat] Waiting for in-flight provision for visitor ${visitorId.slice(0, 12)}...`);
    const agentId = await provisioningMap.get(visitorId);
    return { agentId, isNew: true };
  }

  // 慢路径：启动新的 provision 流程
  const provisionPromise = provisionAgent(visitorId, cfg)
    .finally(() => {
      provisioningMap.delete(visitorId);
    });

  provisioningMap.set(visitorId, provisionPromise);

  const agentId = await provisionPromise;
  return { agentId, isNew: true };
}

/**
 * 新 Agent 首次使用时，OpenClaw 热重载可能需要 1-2 秒。
 * 若收到 404，自动重试，最多等待 10 秒。
 */
async function streamResponseWithRetry({ agentId, visitorId, message, cfg, req, res, isNew }) {
  if (!isNew) {
    return streamResponse({ agentId, visitorId, message, cfg, req, res });
  }

  const maxAttempts = 5;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 检查 agent 是否已就绪
    const ready = await checkAgentReady(agentId, cfg);
    if (ready) break;

    if (attempt === maxAttempts) {
      console.error(`[chat] Agent ${agentId} not ready after ${maxAttempts} attempts`);
      res.status(503).json({ error: 'Agent is starting up, please try again in a moment.' });
      return;
    }

    console.log(`[chat] Agent ${agentId} not ready yet, retrying in ${retryDelayMs}ms (attempt ${attempt}/${maxAttempts})...`);
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }

  return streamResponse({ agentId, visitorId, message, cfg, req, res });
}

/**
 * 通过健康检查确认 agent 已被 OpenClaw 加载
 */
async function checkAgentReady(agentId, cfg) {
  try {
    const res = await fetch(`${cfg.openclawBaseUrl}/v1/agents/${agentId}`, {
      headers: { 'Authorization': `Bearer ${cfg.openclawToken}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
