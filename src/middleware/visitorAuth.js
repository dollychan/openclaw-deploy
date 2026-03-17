/**
 * Visitor Auth 中间件
 *
 * 职责：
 * 1. 读取 httpOnly 签名 cookie "visitor_id"
 * 2. 若不存在 → 生成新 visitorId，签名后写入 cookie，设置 req.visitorId
 * 3. 若存在 → 验证 HMAC 签名，合法则设置 req.visitorId，非法则返回 401
 *
 * 安全设计：
 * - httpOnly cookie：JS 无法读取，防止 XSS 窃取
 * - SameSite=Lax：防止跨站 POST CSRF，同时允许顶层导航携带 cookie（同域嵌入）
 * - HMAC 签名：防止客户端伪造其他访客的 ID
 * - timingSafeEqual 比较：防止时序攻击
 */

import { signVisitorId, verifyVisitorId } from '../utils/crypto.js';
import { generateVisitorId } from '../utils/idGen.js';

const COOKIE_NAME = 'visitor_id';

// Cookie 有效期：1 年（访客身份长期保留）
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * 工厂函数：创建 visitorAuth 中间件
 * @param {object} cfg - 配置对象（需要 hmacSecret）
 * @returns {import('express').RequestHandler}
 */
export function createVisitorAuth(cfg) {
  return function visitorAuth(req, res, next) {
    const cookieValue = req.cookies?.[COOKIE_NAME];

    if (cookieValue) {
      // ── 验证已有 cookie ────────────────────────────────────────────────────
      const { valid, visitorId } = verifyVisitorId(cookieValue, cfg.hmacSecret);

      if (!valid) {
        // 签名无效：可能是篡改或旧版 cookie，清除后重新创建
        res.clearCookie(COOKIE_NAME);
        return issueNewVisitor(req, res, next, cfg);
      }

      req.visitorId = visitorId;
      return next();
    }

    // ── 没有 cookie：新访客 ────────────────────────────────────────────────
    return issueNewVisitor(req, res, next, cfg);
  };
}

/**
 * 为新访客生成 ID 并设置签名 cookie
 */
function issueNewVisitor(req, res, next, cfg) {
  const visitorId = generateVisitorId();
  const signedId = signVisitorId(visitorId, cfg.hmacSecret);

  res.cookie(COOKIE_NAME, signedId, {
    httpOnly: true,
    // Lax：允许顶层导航时携带 cookie（同域嵌入场景正确选择）
    // Strict 会在用户从外部链接首次进入时丢失 cookie，导致身份重置
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE * 1000, // express 使用毫秒
    // 仅在生产环境（HTTPS）启用 secure
    secure: cfg.nodeEnv === 'production',
  });

  req.visitorId = visitorId;
  next();
}
