/**
 * 匿名/低敏感行为事件采集：页面停留、Tab 切换、自定义操作等。
 * 不落用户聊天正文；训练数据需单独合规与脱敏流程后再接入。
 */
import type { Express, Request, Response } from 'express';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { forwardAnalyticsCloudWebhook } from './analytics-cloud-forward.js';
import { decryptAnalyticsEnvelope, isEncryptedAnalyticsBody } from './analytics-payload-crypto.js';
import { getAnalyticsPayloadSecret } from './analytics-payload-secret.js';
import { getAnalyticsEventsFilePath, getAnalyticsEventsMirrorFilePath } from './storage.js';
import { formatConversationArchiveUserName, getSessionSsoUser } from './sso.js';
import { performDailyActiveInsert } from './supabase-daily-usage.js';

const MAX_BATCH = 80;

function ingestEnabled(): boolean {
  return process.env.ANALYTICS_INGEST_ENABLED !== '0';
}

export function registerAnalyticsRoutes(app: Express): void {
  app.post('/api/analytics/events', async (req: Request, res: Response) => {
    if (!ingestEnabled()) {
      res.status(204).end();
      return;
    }
    let body = req.body as {
      clientSessionId?: string;
      schema?: string;
      consent?: { trainingDataOptIn?: boolean; recordedAt?: number };
      events?: unknown[];
    };
    if (isEncryptedAnalyticsBody(body)) {
      const secret = getAnalyticsPayloadSecret();
      if (!secret) {
        res.status(400).json({ ok: false, error: 'payload_encrypted_but_server_secret_missing' });
        return;
      }
      try {
        const json = decryptAnalyticsEnvelope(body.iv, body.payload, secret);
        body = JSON.parse(json) as typeof body;
      } catch {
        res.status(400).json({ ok: false, error: 'payload_decrypt_failed' });
        return;
      }
    }
    const clientSessionId = String(body?.clientSessionId || '').slice(0, 64);
    const schema = String(body?.schema || 'rdk.studio.analytics.v1');
    const consentEnvelope = body?.consent && typeof body.consent === 'object'
      ? {
          trainingDataOptIn: body.consent.trainingDataOptIn === true,
          recordedAt: typeof body.consent.recordedAt === 'number' ? body.consent.recordedAt : undefined,
        }
      : undefined;
    const raw = body?.events;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ ok: false, error: 'events 必须为非空数组' });
      return;
    }
    if (raw.length > MAX_BATCH) {
      res.status(400).json({ ok: false, error: `events 单次最多 ${MAX_BATCH} 条` });
      return;
    }

    const receivedAt = Date.now();
    const ua = String(req.headers['user-agent'] || '').slice(0, 400);
    const lines: string[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const ev = raw[i];
      if (!ev || typeof ev !== 'object') continue;
      const row = {
        schema,
        receivedAt,
        clientSessionId: clientSessionId || undefined,
        consent: consentEnvelope,
        remoteIp: anonymizeIp(req.socket?.remoteAddress),
        userAgent: ua || undefined,
        event: ev as Record<string, unknown>,
      };
      lines.push(JSON.stringify(row));
    }
    if (lines.length === 0) {
      res.status(400).json({ ok: false, error: '无有效事件' });
      return;
    }

    const blob = `${lines.join('\n')}\n`;
    try {
      const file = getAnalyticsEventsFilePath();
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, blob, 'utf-8');
      const mirror = getAnalyticsEventsMirrorFilePath();
      if (mirror && mirror !== file) {
        await mkdir(path.dirname(mirror), { recursive: true });
        await appendFile(mirror, blob, 'utf-8');
      }
    } catch (err) {
      console.warn('[analytics] append failed:', err instanceof Error ? err.message : err);
      res.status(500).json({ ok: false, error: 'persist_failed' });
      return;
    }

    forwardAnalyticsCloudWebhook(body);

    res.json({ ok: true, accepted: lines.length });
  });

  /**
   * 打开 PV：每次请求插入一行。优先从 SSO Cookie 取用户，写入与对话归档一致的展示名；
   * 未启用/未登录 SSO 时允许 body.anonymousId（本地无门禁场景）。
   */
  app.post('/api/analytics/daily-active', async (req: Request, res: Response) => {
    const body = req.body as { anonymousId?: string; appVersion?: string };
    const appVersion = String(body?.appVersion || '').trim().slice(0, 48);
    const ssoUser = getSessionSsoUser(req);
    let usageKey: string;
    if (ssoUser) {
      const label = formatConversationArchiveUserName(ssoUser, undefined)?.trim();
      usageKey = (label || ssoUser.id).slice(0, 256);
    } else {
      const anonymousId = String(body?.anonymousId || '').trim().slice(0, 128);
      if (!anonymousId) {
        res.status(400).json({ ok: false, error: 'sso_session_or_anonymousId_required' });
        return;
      }
      usageKey = anonymousId;
    }
    const result = await performDailyActiveInsert(usageKey, appVersion);
    if (!result.ok) {
      res.status(500).json({ ok: false, error: result.error });
      return;
    }
    if (!result.persisted) {
      res.json({
        ok: true,
        persisted: false,
        reason: result.reason,
      });
      return;
    }
    res.json({
      ok: true,
      persisted: true,
    });
  });
}

function anonymizeIp(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const p = s.split('.');
    return `${p[0]}.${p[1]}.${p[2]}.0`;
  }
  if (s.includes(':')) return `${s.split(':').slice(0, 4).join(':')}::`;
  return s.slice(0, 32);
}
