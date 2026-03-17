/**
 * 限流中间件
 * 按 visitorId 限制 POST /api/chat 的请求频率
 * 防止单个访客消耗过多 LLM 资源或进行 DoS 攻击
 *
 * 注意：visitorAuth 中间件必须在此之前运行（设置 req.visitorId）
 */

import rateLimit from 'express-rate-limit';

/**
 * 工厂函数：创建限流中间件
 * @param {object} cfg - 配置对象（windowMs, maxRequests）
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter(cfg) {
  return rateLimit({
    windowMs: cfg.rateLimitWindowMs,
    max: cfg.rateLimitMaxRequests,

    // 使用 visitorId 作为限流 key（而非 IP，支持多用户共享同一 IP 的场景）
    keyGenerator: (req) => req.visitorId ?? req.ip,

    // 超出限制时的响应
    handler: (req, res) => {
      console.warn(`[rateLimiter] Visitor ${(req.visitorId ?? 'unknown').slice(0, 12)} exceeded rate limit.`);
      res.status(429).json({
        error: 'Too many messages. Please wait a moment before sending again.',
        retryAfter: Math.ceil(cfg.rateLimitWindowMs / 1000),
      });
    },

    // 在响应头中暴露限流信息，方便前端展示
    standardHeaders: true,
    legacyHeaders: false,

    // 跳过成功响应的计数（只对收到的请求计数，不区分成功/失败）
    skipSuccessfulRequests: false,
  });
}
