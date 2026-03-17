/**
 * ID 生成工具
 * - visitorId: 标识网页访客身份
 * - agentId:   标识 OpenClaw Agent 实例
 */

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';

/**
 * 生成访客 ID
 * 格式：vis_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * @returns {string}
 */
export function generateVisitorId() {
  return `vis_${uuidv4()}`;
}

/**
 * 生成 Agent ID
 * 格式：web-visitor-xxxxxxxxxxxxxxxx（16位随机 hex，64位熵，碰撞概率可忽略）
 * @param {string} prefix - Agent ID 前缀，来自配置（默认 "web-visitor-"）
 * @returns {string}
 */
export function generateAgentId(prefix = 'web-visitor-') {
  const hex = randomBytes(8).toString('hex');
  return `${prefix}${hex}`;
}
