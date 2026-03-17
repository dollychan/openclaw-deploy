/**
 * 探测 OpenClaw API 可用接口
 * 用法：node test/test-openclaw-api.js
 */

import 'dotenv/config';

const baseUrl = process.env.OPENCLAW_BASE_URL;
const token = process.env.OPENCLAW_TOKEN;

const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function probe(method, path, body) {
  try {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    console.log(`${method} ${url} → ${res.status}`);
    if (res.status !== 404) console.log('  ', JSON.stringify(parsed).slice(0, 200));
  } catch (e) {
    console.log(`${method} ${path} → ERROR: ${e.message}`);
  }
}

const ports = [18789, 18791, 18792];

for (const port of ports) {
  const url = `http://localhost:${port}`;
  console.log(`\n── 端口 ${port} ──`);
  await probe('GET',  `${url}/`);
  await probe('GET',  `${url}/health`);
  await probe('POST', `${url}/v1/responses`, { model: 'openclaw:main', input: 'hi', stream: false });
  await probe('POST', `${url}/v1/chat/completions`, { model: 'main', messages: [{ role: 'user', content: 'hi' }] });
  await probe('GET',  `${url}/v1/agents`);
  await probe('GET',  `${url}/api/agents`);
}
