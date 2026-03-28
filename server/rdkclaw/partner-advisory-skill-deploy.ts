/**
 * 将内置技能 rdk-rdkclaw-partner-advisory 同步到板端 ~/.openclaw/workspace/skills/
 * — 若已存在且版本与校验一致则跳过；否则写入并校验 sha256。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Request, Response } from 'express';

export const PARTNER_ADVISORY_SKILL_ID = 'rdk-rdkclaw-partner-advisory';

export function readLocalPartnerAdvisorySkill(): { content: string; version: string; sha256: string } | null {
  const p = path.join(process.cwd(), 'skills', PARTNER_ADVISORY_SKILL_ID, 'SKILL.md');
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf8');
  const m = content.match(/^version:\s*([^\r\n]+)/m);
  const version = (m?.[1] || '').trim() || '0.0.0';
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return { content, version, sha256 };
}

type RunOnDevice = (
  request: Request,
  response: Response,
  id: string,
  commands: string[],
  options?: { timeoutMs?: number },
) => Promise<{ output: string; device?: unknown } | null>;

const ensureCache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function parseJsonLineFromSshOutput(text: string): Record<string, unknown> | null {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        /* continue */
      }
    }
  }
  const joined = lines.join('\n');
  const idx = joined.lastIndexOf('{');
  if (idx >= 0) {
    try {
      return JSON.parse(joined.slice(idx)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function remoteInspectPythonB64(): string {
  const sid = PARTNER_ADVISORY_SKILL_ID;
  const py = [
    'import json,os,re,hashlib',
    `p='/root/.openclaw/workspace/skills/${sid}/SKILL.md'`,
    "out={'exists':False,'version':None,'marker':False,'sha256':None}",
    'if os.path.isfile(p):',
    "    c=open(p,'r',encoding='utf-8',errors='ignore').read()",
    "    out['exists']=True",
    "    out['sha256']=hashlib.sha256(c.encode('utf-8')).hexdigest()",
    "    m=re.search(r'^version:\\\\s*([^\\\\r\\\\n]+)', c, re.M)",
    "    if m: out['version']=m.group(1).strip()",
    "    out['marker']='RDKClaw Partner Advisory' in c[:4000]",
    'print(json.dumps(out,ensure_ascii=False))',
  ].join('\n');
  return Buffer.from(py, 'utf8').toString('base64');
}

/**
 * POST /api/devices/:id/openclaw/ensure-partner-advisory-skill
 * 若 runOnDevice 返回 null，表示已向客户端发送错误，本函数不再写 response。
 */
export async function handleEnsurePartnerAdvisorySkill(
  runOnDevice: RunOnDevice,
  request: Request,
  response: Response,
  deviceId: string,
): Promise<void> {
  const local = readLocalPartnerAdvisorySkill();
  if (!local) {
    response.json({
      ok: false,
      action: 'error',
      reason: 'local_skill_missing',
      message: `本机未找到 skills/${PARTNER_ADVISORY_SKILL_ID}/SKILL.md`,
    });
    return;
  }

  const cacheKey = `${deviceId}:${local.version}:${local.sha256}`;
  const hit = ensureCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    response.json({ ok: true, cached: true, ...hit.body });
    return;
  }

  const inspectB64 = remoteInspectPythonB64();
  const inspectCmd = `bash -lc "echo '${inspectB64}' | base64 -d | python3"`;

  const first = await runOnDevice(request, response, deviceId, [inspectCmd], { timeoutMs: 45_000 });
  if (!first) return;

  const remote = parseJsonLineFromSshOutput(first.output);
  if (!remote) {
    response.json({
      ok: false,
      action: 'error',
      reason: 'remote_parse_failed',
      message: '无法解析板端技能检查输出',
      details: String(first.output || '').slice(0, 800),
    });
    return;
  }

  const exists = remote.exists === true;
  const version = typeof remote.version === 'string' ? remote.version : '';
  const marker = remote.marker === true;
  const remoteSha = typeof remote.sha256 === 'string' ? remote.sha256 : '';

  if (exists && version === local.version && marker && remoteSha === local.sha256) {
    const body = {
      action: 'skipped',
      version: local.version,
      verified: true,
      reason: 'already_synced',
      remoteSha256: remoteSha,
    };
    ensureCache.set(cacheKey, { at: Date.now(), body });
    response.json({ ok: true, ...body });
    return;
  }

  /* 版本不一致或缺文件或内容过期：覆盖部署 */
  const skillDir = `/root/.openclaw/workspace/skills/${PARTNER_ADVISORY_SKILL_ID}`;
  const contentB64 = Buffer.from(local.content, 'utf8').toString('base64');
  const writeCmd = `bash -lc "mkdir -p '${skillDir}' && echo '${contentB64}' | base64 -d > '${skillDir}/SKILL.md' && echo WRITE_OK"`;

  const second = await runOnDevice(request, response, deviceId, [writeCmd], { timeoutMs: 120_000 });
  if (!second) return;

  if (!String(second.output || '').trim().endsWith('WRITE_OK')) {
    response.json({
      ok: false,
      action: 'error',
      reason: 'write_failed',
      message: '写入板端 SKILL.md 未确认成功',
      details: String(second.output || '').slice(0, 1200),
    });
    return;
  }

  const third = await runOnDevice(request, response, deviceId, [inspectCmd], { timeoutMs: 45_000 });
  if (!third) return;

  const after = parseJsonLineFromSshOutput(third.output);
  const afterSha = typeof after?.sha256 === 'string' ? after.sha256 : '';
  const verified = after?.exists === true && afterSha === local.sha256 && after?.marker === true;

  const body = {
    action: 'deployed' as const,
    version: local.version,
    verified,
    remoteSha256: afterSha,
    previous: { exists, version, marker, remoteSha },
  };
  ensureCache.set(cacheKey, { at: Date.now(), body });
  response.json({ ok: true, ...body });
}
