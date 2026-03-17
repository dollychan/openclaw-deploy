/**
 * HMAC 签名与验证工具
 * 用于对 visitorId 进行签名，防止客户端伪造其他用户的身份
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SEPARATOR = '.';

/**
 * 对 visitorId 生成 HMAC-SHA256 签名
 * @param {string} visitorId  - 原始访客 ID（如 vis_xxxx-xxxx）
 * @param {string} secret     - HMAC 密钥（来自 HMAC_SECRET 环境变量）
 * @returns {string}          - 格式：visitorId.signature（hex）
 */
export function signVisitorId(visitorId, secret) {
  const sig = createHmac('sha256', secret)
    .update(visitorId)
    .digest('hex');
  return `${visitorId}${SEPARATOR}${sig}`;
}

/**
 * 验证已签名的 visitorId
 * 使用 timingSafeEqual 防止时序攻击
 * @param {string} signedId - 格式：visitorId.signature
 * @param {string} secret   - HMAC 密钥
 * @returns {{ valid: boolean, visitorId: string|null }}
 */
export function verifyVisitorId(signedId, secret) {
  if (!signedId || typeof signedId !== 'string') {
    return { valid: false, visitorId: null };
  }

  // 从末尾分离签名（visitorId 本身不含 '.'，但防御性地从最后一个点分割）
  const lastDot = signedId.lastIndexOf(SEPARATOR);
  if (lastDot === -1) {
    return { valid: false, visitorId: null };
  }

  const visitorId = signedId.slice(0, lastDot);
  const providedSig = signedId.slice(lastDot + 1);

  if (!visitorId || !providedSig) {
    return { valid: false, visitorId: null };
  }

  // 重新计算期望签名
  const expectedSig = createHmac('sha256', secret)
    .update(visitorId)
    .digest('hex');

  // 常量时间比较，防止时序攻击
  try {
    const providedBuf = Buffer.from(providedSig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    if (providedBuf.length !== expectedBuf.length) {
      return { valid: false, visitorId: null };
    }

    const isValid = timingSafeEqual(providedBuf, expectedBuf);
    return { valid: isValid, visitorId: isValid ? visitorId : null };
  } catch {
    return { valid: false, visitorId: null };
  }
}
