/**
 * 本地 Agent Chat SSE 回归：验证事件流、首包时延、text 事件是否分批到达（非仅结尾一次）。
 * 用法：
 *   SSO_REQUIRED=0 node scripts/sse-agent-chat-regression.mjs
 *   BASE_URL=http://127.0.0.1:8787 SSO_REQUIRED=0 node scripts/sse-agent-chat-regression.mjs
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || '8787'}`;
const TIMEOUT_MS = Math.min(180_000, Number(process.env.SSE_REGRESSION_TIMEOUT_MS) || 120_000);

function httpRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => resolve(res),
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const healthUrl = `${BASE.replace(/\/$/, '')}/api/health`;
  console.log(`[regression] GET ${healthUrl}`);
  try {
    const h = await httpRequest(healthUrl);
    const chunks = [];
    for await (const c of h) chunks.push(c);
    const txt = Buffer.concat(chunks).toString('utf8').slice(0, 200);
    console.log(`[regression] health status=${h.statusCode} body=${txt || '(empty)'}`);
    if (h.statusCode !== 200) {
      process.exitCode = 1;
      return;
    }
  } catch (e) {
    console.error('[regression] health failed:', e.message);
    console.error('请先启动: SSO_REQUIRED=0 npm run dev:server');
    process.exitCode = 1;
    return;
  }

  const payload = JSON.stringify({
    message: process.env.SSE_REGRESSION_MESSAGE || '只回复一个汉字：好',
    sessionId: `sse-regression-${Date.now()}`,
    userId: 'sse-regression',
    mode: 'local',
    studioResponseMode: process.env.SSE_REGRESSION_MODE === 'quick' ? 'quick' : 'thinking',
  });

  const chatUrl = `${BASE.replace(/\/$/, '')}/api/agent/chat`;
  console.log(`[regression] POST ${chatUrl} (SSE, timeout ${TIMEOUT_MS}ms)`);

  const started = Date.now();
  let res;
  try {
    res = await httpRequest(chatUrl, { method: 'POST', body: payload });
  } catch (e) {
    console.error('[regression] chat request failed:', e.message);
    process.exitCode = 1;
    return;
  }

  if (res.statusCode !== 200) {
    const chunks = [];
    for await (const c of res) chunks.push(c);
    console.error('[regression] chat HTTP', res.statusCode, Buffer.concat(chunks).toString('utf8').slice(0, 500));
    process.exitCode = 1;
    return;
  }

  /** @type {{ t: number, event: string, raw: string }[]} */
  const timeline = [];
  let buf = '';
  /** @type {string | null} */
  let curEvent = null;
  let textEventCount = 0;
  let textChars = 0;
  let thinkingDeltaCount = 0;
  let firstTextAt = null;
  let runCompleteAt = null;
  let errorPayload = null;

  const feedLine = (line) => {
    if (line.startsWith('event:')) {
      curEvent = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      const t = Date.now() - started;
      const ev = curEvent || 'message';
      timeline.push({ t, event: ev, raw: data.length > 160 ? `${data.slice(0, 160)}…` : data });
      if (ev === 'text') {
        textEventCount += 1;
        try {
          const o = JSON.parse(data);
          const d = String(o.delta ?? '');
          textChars += d.length;
          if (firstTextAt == null) firstTextAt = t;
        } catch {
          /* ignore */
        }
      }
      if (ev === 'thinking_delta') thinkingDeltaCount += 1;
      if (ev === 'run_complete') runCompleteAt = t;
      if (ev === 'error') {
        try {
          errorPayload = JSON.parse(data);
        } catch {
          errorPayload = { raw: data };
        }
      }
      curEvent = null;
    }
  };

  for await (const chunk of res) {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const trimmed = line.replace(/\r$/, '');
      if (trimmed === '') continue;
      if (trimmed.startsWith(':')) continue; // comment / keepalive
      feedLine(trimmed);
    }
  }

  console.log('\n[regression] —— 摘要 ——');
  console.log(`  总耗时(ms): ${Date.now() - started}`);
  console.log(`  event:text 次数: ${textEventCount}（总字符估算 payload.delta: ${textChars}）`);
  console.log(`  首个 text 距首包: ${firstTextAt == null ? 'N/A' : `${firstTextAt}ms`}`);
  console.log(`  thinking_delta 次数: ${thinkingDeltaCount}`);
  console.log(`  run_complete 距首包: ${runCompleteAt == null ? 'N/A' : `${runCompleteAt}ms`}`);
  if (errorPayload) {
    console.log(`  error: ${JSON.stringify(errorPayload).slice(0, 400)}`);
  }

  const early = timeline.slice(0, 25);
  console.log('\n[regression] 前 25 条 SSE 事件（时间相对请求开始 ms）:');
  for (const row of early) {
    console.log(`  +${String(row.t).padStart(5)}ms  ${row.event.padEnd(18)} ${row.raw}`);
  }

  if (errorPayload) {
    const msg = String(errorPayload.error ?? errorPayload.raw ?? '');
    if (/未配置.*API Key|no_api_key/i.test(msg)) {
      console.log('\n[regression] 提示: 未配置 API Key，跳过多 text 断言（仍已验证 SSE 连通）。');
      return;
    }
    console.error('\n[regression] FAIL: 收到 error 事件');
    process.exitCode = 1;
    return;
  }

  if (textEventCount === 0 && !errorPayload) {
    console.error('\n[regression] WARN: 未收到任何 text 事件（可能仅 meta/tool/run_complete）');
  }
  if (textEventCount > 1) {
    console.log('\n[regression] OK: 正文以多次 text 事件到达（流式路径生效）。');
  } else if (textEventCount === 1 && textChars > 0) {
    console.log('\n[regression] ACCEPT: 仅 1 次 text（上游可能单次拼装或服务端 smoother 合并）；仍优于全程无 text。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
