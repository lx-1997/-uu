/**
 * 从 RDK Studio 服务端直连厂商 HTTP API，验证 Base URL / Key / Model / 协议是否与网关无关。
 */

export function joinVendorApiUrl(baseUrl: string, segment: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const seg = segment.replace(/^\/+/, '');
  return `${base}/${seg}`;
}

function isAllowedVendorUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export type VendorModelPingBody = {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  api?: string;
};

export type VendorModelPingResult =
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      error: string;
      detail?: string;
      status?: number;
    };

function extractProviderErrorMessage(data: unknown, raw: string): string {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const err = o.error;
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
  }
  const t = raw.trim();
  return t ? t.slice(0, 400) : '未知错误';
}

function extractOpenAiAssistantText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  const choices = o.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const c0 = choices[0];
  if (!c0 || typeof c0 !== 'object') return '';
  const rec = c0 as Record<string, unknown>;
  const msg = rec.message;
  if (msg && typeof msg === 'object') {
    const content = (msg as Record<string, unknown>).content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      let out = '';
      for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
          out += (part as Record<string, unknown>).text as string;
        }
      }
      return out;
    }
  }
  if (typeof rec.text === 'string') return rec.text;
  return '';
}

function extractAnthropicAssistantText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const content = (data as Record<string, unknown>).content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') out += b.text;
    }
  }
  return out;
}

const PING_TIMEOUT_MS = 55_000;

export async function pingVendorModel(body: VendorModelPingBody): Promise<VendorModelPingResult> {
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
  const api = typeof body.api === 'string' ? body.api.trim() : 'openai-completions';

  if (!baseUrl || !apiKey || !modelId) {
    return { ok: false, error: 'MISSING_FIELDS', detail: '请填写 Base URL、模型 ID 与 API Key' };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PING_TIMEOUT_MS);

  try {
    if (api === 'anthropic-messages') {
      const url = joinVendorApiUrl(baseUrl, 'messages');
      if (!isAllowedVendorUrl(url)) {
        return { ok: false, error: 'INVALID_URL', detail: '仅支持 http(s) Base URL' };
      }
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Reply with one word: OK' }],
        }),
      });
      const latencyMs = Date.now() - t0;
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok) {
        return {
          ok: false,
          error: 'HTTP_ERROR',
          status: res.status,
          detail: extractProviderErrorMessage(data, text),
        };
      }
      const out = extractAnthropicAssistantText(data);
      if (!out.trim()) {
        return { ok: false, error: 'EMPTY_RESPONSE', detail: '响应中无 assistant 文本', status: res.status };
      }
      return { ok: true, latencyMs };
    }

    if (api !== 'openai-completions') {
      return { ok: false, error: 'UNKNOWN_API', detail: `不支持的协议: ${api}` };
    }

    const url = joinVendorApiUrl(baseUrl, 'chat/completions');
    if (!isAllowedVendorUrl(url)) {
      return { ok: false, error: 'INVALID_URL', detail: '仅支持 http(s) Base URL' };
    }
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with one word: OK' }],
        max_tokens: 32,
        temperature: 0.2,
        stream: false,
      }),
    });
    const latencyMs = Date.now() - t0;
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        error: 'HTTP_ERROR',
        status: res.status,
        detail: extractProviderErrorMessage(data, text),
      };
    }
    const out = extractOpenAiAssistantText(data);
    if (!out.trim()) {
      return { ok: false, error: 'EMPTY_RESPONSE', detail: '响应无有效文本（检查模型与兼容接口路径）', status: res.status };
    }
    return { ok: true, latencyMs };
  } catch (e: unknown) {
    const err = e as Error;
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'TIMEOUT', detail: `请求超过 ${PING_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: 'FETCH_FAILED', detail: err?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}
