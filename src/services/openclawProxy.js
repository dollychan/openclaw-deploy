/**
 * OpenClaw Proxy - 将聊天请求代理到 OpenClaw /v1/responses，并实时 pipe SSE 流
 *
 * 关键特性：
 * - 使用 Node 原生 fetch（Node 25 内置），无需额外依赖
 * - AbortController 监听客户端断开，立即中止上游请求（节省 LLM token）
 * - 设置 X-Accel-Buffering: no，禁用 nginx 缓冲，确保实时流式输出
 * - 对上游错误返回 SSE error 事件而非直接断开连接
 */

/**
 * 将用户消息代理到 OpenClaw，并将 SSE 响应流转发给浏览器
 *
 * @param {object} params
 * @param {string} params.agentId     - OpenClaw Agent ID
 * @param {string} params.visitorId   - 访客 ID（用于会话键）
 * @param {string} params.message     - 用户消息文本
 * @param {object} params.cfg         - 配置对象（含 openclawBaseUrl, openclawToken）
 * @param {import('express').Request}  params.req - Express 请求对象（监听断开）
 * @param {import('express').Response} params.res - Express 响应对象（写入 SSE）
 */
export async function streamResponse({ agentId, visitorId, message, cfg, req, res }) {
  // ── 设置 SSE 响应头 ────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // 告知 nginx 禁用响应缓冲，确保每个 token 即时到达浏览器
  res.setHeader('X-Accel-Buffering', 'no');

  // ── AbortController：客户端断开时中止上游 fetch ────────────────────────────
  const controller = new AbortController();
  const onClientClose = () => {
    controller.abort();
    console.log(`[proxy] Client disconnected for visitor ${visitorId.slice(0, 12)}, aborting upstream.`);
  };
  req.on('close', onClientClose);

  try {
    // ── 构造请求到 OpenClaw /v1/responses ──────────────────────────────────
    const url = `${cfg.openclawBaseUrl}/v1/responses`;

    // 使用 agent:<agentId>:main 格式，确保请求路由到 visitor agent 自己的 workspace
    const sessionKey = `agent:${agentId}:main`;

    const body = JSON.stringify({
      model: `openclaw:${agentId}`,
      input: message,
      stream: true,
      user: sessionKey,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.openclawToken}`,
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': agentId,
        'x-openclaw-session-key': sessionKey,
      },
      body,
      signal: controller.signal,
    });

    // ── 处理上游错误 ────────────────────────────────────────────────────────
    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      console.error(`[proxy] OpenClaw returned ${response.status} for agent ${agentId}:`, errText);

      // 通过 SSE error 事件通知客户端
      const errMsg = response.status === 429
        ? 'Rate limit reached. Please wait a moment.'
        : response.status >= 500
          ? 'AI service temporarily unavailable. Please try again.'
          : `Request failed (${response.status})`;

      sendSSEError(res, errMsg);
      res.end();
      return;
    }

    // ── Pipe SSE 流：将上游响应的每个 chunk 直接转发给浏览器 ─────────────────
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    // 确保流结束信号被发送（OpenClaw 通常自己发送，但作为保险）
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      // 客户端主动断开，正常情况，不输出错误日志
      return;
    }

    console.error(`[proxy] Unexpected error for visitor ${visitorId.slice(0, 12)}:`, err.message);

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
    }

    if (!res.writableEnded) {
      sendSSEError(res, 'Connection error. Please try again.');
      res.end();
    }
  } finally {
    req.off('close', onClientClose);
  }
}

/**
 * 发送 SSE error 事件
 * @param {import('express').Response} res
 * @param {string} message
 */
function sendSSEError(res, message) {
  const data = JSON.stringify({ error: message });
  res.write(`event: error\ndata: ${data}\n\n`);
}
