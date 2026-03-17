/**
 * 输入验证中间件
 * 针对 POST /api/chat 的请求体进行校验和清理
 *
 * 防护：
 * - 空消息 / 非字符串
 * - 超长消息（Prompt 注入攻击通常依赖大量文本）
 * - 控制字符和 null 字节（防止日志注入）
 */

/**
 * 工厂函数：创建输入验证中间件
 * @param {object} cfg - 配置对象（maxInputLength）
 * @returns {import('express').RequestHandler}
 */
export function createInputValidator(cfg) {
  return function inputValidator(req, res, next) {
    const { message } = req.body ?? {};

    // ── 类型检查 ──────────────────────────────────────────────────────────────
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Field "message" is required and must be a string.' });
    }

    // ── 清理：去除首尾空白 ────────────────────────────────────────────────────
    const trimmed = message.trim();

    if (trimmed.length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    // ── 长度限制 ──────────────────────────────────────────────────────────────
    if (trimmed.length > cfg.maxInputLength) {
      return res.status(400).json({
        error: `Message too long. Maximum ${cfg.maxInputLength} characters allowed.`,
        maxLength: cfg.maxInputLength,
      });
    }

    // ── 清理控制字符（保留换行符 \n 和制表符 \t，移除 null 字节等）─────────────
    // eslint-disable-next-line no-control-regex
    const cleaned = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'Message contains only invalid characters.' });
    }

    // 将清理后的消息写回，供下游路由使用
    req.body.message = cleaned;

    next();
  };
}
