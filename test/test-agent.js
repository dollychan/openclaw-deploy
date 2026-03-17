/**
 * 测试直接访问指定 OpenClaw agent
 * 用法：node test/test-agent.js [agentId]
 * 示例：node test/test-agent.js main
 */

import 'dotenv/config';

const agentId = process.argv[2] || 'main';
const message = process.argv[3] || '你好，请简单介绍一下你自己。';

const baseUrl = process.env.OPENCLAW_BASE_URL;
const token = process.env.OPENCLAW_TOKEN;

if (!baseUrl || !token) {
  console.error('缺少环境变量：OPENCLAW_BASE_URL 或 OPENCLAW_TOKEN');
  process.exit(1);
}

console.log(`测试 agent: ${agentId}`);
console.log(`发送消息: ${message}`);
console.log(`OpenClaw: ${baseUrl}`);
console.log('─'.repeat(40));

const sessionKey = `web:test-session-001`;

const response = await fetch(`${baseUrl}/v1/responses`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': agentId,
    'x-openclaw-session-key': sessionKey,
  },
  body: JSON.stringify({
    model: `openclaw:${agentId}`,
    input: message,
    stream: true,
    user: sessionKey,
  }),
});

console.log(`HTTP 状态: ${response.status} ${response.statusText}`);

if (!response.ok) {
  const err = await response.text();
  console.error('错误响应:', err);
  process.exit(1);
}

console.log('─'.repeat(40));
console.log('Agent 响应:');

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  // 解析 SSE 格式，提取 text 内容
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      // 兼容不同的 SSE 数据格式
      const text = json.delta?.text || json.text || json.content || '';
      if (text) process.stdout.write(text);
    } catch {
      // 忽略非 JSON 行
    }
  }
}

console.log('\n' + '─'.repeat(40));
console.log('测试完成');
