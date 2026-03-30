/**
 * 技能注册表搜索与拉取 SKILL.md（默认 SkillHub 镜像，供 Skill 中心使用）。
 */
import type { Express, Request, Response } from 'express';
import { clawhubFetchSkillMarkdown, clawhubSearch } from './clawhub-registry.js';

const RATE_LIMIT_USER_MSG =
  '技能源访问频率受限（Rate limit），请等待约 1～2 分钟后重试，或减少连续切换技能。';

function mapClawhubError(msg: string): { http: number; error: string; message?: string } {
  if (msg === 'clawhub_rate_limited' || /rate\s*limit/i.test(msg)) {
    return { http: 429, error: 'clawhub_rate_limited', message: RATE_LIMIT_USER_MSG };
  }
  if (msg === 'invalid_skill_slug') {
    return { http: 400, error: msg };
  }
  if (msg.includes('404')) {
    return { http: 404, error: msg };
  }
  return { http: 502, error: msg };
}

export function registerClawhubRoutes(app: Express): void {
  app.get('/api/clawhub/search', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    try {
      const data = await clawhubSearch(q, limit);
      res.json({ ok: true, ...data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[clawhub] search failed:', msg);
      const m = mapClawhubError(msg);
      res.status(m.http).json({
        ok: false,
        error: m.error,
        ...(m.message ? { message: m.message } : {}),
      });
    }
  });

  app.get('/api/clawhub/skills/:slug/skill-md', async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? '').trim();
    const version = typeof req.query.version === 'string' ? req.query.version.trim() : undefined;
    try {
      const data = await clawhubFetchSkillMarkdown(slug, version);
      res.json({ ok: true, ...data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[clawhub] skill-md failed:', slug, msg);
      const m = mapClawhubError(msg);
      res.status(m.http).json({
        ok: false,
        error: m.error,
        ...(m.message ? { message: m.message } : {}),
      });
    }
  });
}
