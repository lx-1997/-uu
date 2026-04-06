/* ═══════════════════════════════════════════
   OpenClaw — Constants & Utilities
   ═══════════════════════════════════════════ */

import { sanitizeTerminalLineForDisplay } from '../../utils/strip-ansi';
import type { DeployJob, DeployStepName, DeployStepState } from './types';

/* ─── Provider Presets ─── */

export interface ProviderPreset {
  label: string;
  group: 'international' | 'china';
  baseUrl: string;
  api: string;
  models: string[];
  keyHint?: string;
  docUrl?: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  // International
  anthropic: { label: 'Anthropic', group: 'international', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic-messages', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'], keyHint: 'sk-ant-...' },
  openai: { label: 'OpenAI', group: 'international', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'], keyHint: 'sk-...' },
  google: { label: 'Google Gemini', group: 'international', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'openai-completions', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyHint: 'AIza...' },
  openrouter: { label: 'OpenRouter', group: 'international', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-pro'], keyHint: 'sk-or-...' },
  // China
  bailian: { label: '阿里百炼', group: 'china', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-235b-a22b'], keyHint: 'sk-...', docUrl: 'https://bailian.console.aliyun.com' },
  deepseek: { label: 'DeepSeek', group: 'china', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', models: ['deepseek-chat', 'deepseek-reasoner'], keyHint: 'sk-...' },
  siliconflow: { label: '硅基流动', group: 'china', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'], keyHint: 'sk-...' },
  zhipu: { label: '智谱 AI', group: 'china', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'], keyHint: '...' },
  moonshot: { label: 'Moonshot', group: 'china', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions', models: ['moonshot-v1-128k', 'moonshot-v1-32k'], keyHint: 'sk-...' },
  volcengine: { label: '火山引擎', group: 'china', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', models: ['doubao-1.5-pro-256k', 'doubao-1.5-lite-32k'], keyHint: '...' },
  baichuan: { label: '百川', group: 'china', baseUrl: 'https://api.baichuan-ai.com/v1', api: 'openai-completions', models: ['Baichuan4-Turbo', 'Baichuan4-Air'], keyHint: 'sk-...' },
  minimax: { label: 'MiniMax', group: 'china', baseUrl: 'https://api.minimax.chat/v1', api: 'openai-completions', models: ['MiniMax-Text-01', 'abab6.5s-chat'], keyHint: '...' },
  stepfun: { label: '阶跃星辰', group: 'china', baseUrl: 'https://api.stepfun.com/v1', api: 'openai-completions', models: ['step-2-16k', 'step-1-128k'], keyHint: '...' },
};

export const API_TYPE_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

export const DEPLOY_LOG_MAX_LINES = 2500;

/** 安装各步骤预估耗时（秒），用于进度条倒计时提示 */
export const DEPLOY_STEP_ESTIMATE_SECONDS: Record<string, number> = {
  check: 15,
  prepare: 30,
  install: 600,
  config: 20,
};

/* ─── Utility Functions ─── */

/** Studio provider id → deploy preset key */
export function mapStudioProviderToDeployPreset(provider: string): string {
  const p = String(provider || '').trim();
  if (p === 'qwen') return 'bailian';
  if (p === 'doubao') return 'volcengine';
  if (p === 'gemini') return 'google';
  return p;
}

/** 根据 modelGateway 推断 provider chip key */
export function inferPresetFromGateway(mg: { baseUrl?: string; modelId?: string }): string {
  const u = (mg.baseUrl || '').trim().toLowerCase();
  const mid = (mg.modelId || '').trim().toLowerCase();
  if (u) {
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      const pb = preset.baseUrl.trim().toLowerCase().replace(/\/$/, '');
      const un = u.replace(/\/$/, '');
      if (pb && (un === pb || un.startsWith(pb))) return key;
    }
    if (u.includes('ark.') && u.includes('volces.com')) return 'volcengine';
    if (u.includes('dashscope.aliyuncs.com')) return 'bailian';
  }
  if (mid.startsWith('doubao')) return 'volcengine';
  if (mid.startsWith('qwen')) return 'bailian';
  if (mid.startsWith('deepseek')) return 'deepseek';
  if (mid.startsWith('glm')) return 'zhipu';
  if (!u && !mid) return 'volcengine';
  return '';
}

export function sanitizeDeployLogLine(line: string): string {
  return sanitizeTerminalLineForDisplay(line)
    .replace(/^\uFEFF/, '')
    .replace(/\u200B/g, '');
}

/** 后端异常结束时 running → error 收敛 */
export function normalizeDeployStepsFromJob(job: DeployJob): DeployStepState[] {
  const stepOrder: DeployStepName[] = ['check', 'prepare', 'install', 'config'];
  const out = stepOrder.map((name) => job.steps?.[name] || 'pending');

  if (job.status !== 'error') return out;

  const mapped = out.map((s) => (s === 'running' ? 'error' : s));
  if (mapped.some((s) => s === 'error')) return mapped;

  if (mapped.every((s) => s === 'done')) {
    const next: DeployStepState[] = [...mapped];
    next[next.length - 1] = 'error';
    return next;
  }

  const firstNonDone = mapped.findIndex((s) => s !== 'done');
  if (firstNonDone >= 0) {
    const next: DeployStepState[] = [...mapped];
    next[firstNonDone] = 'error';
    return next;
  }

  return mapped;
}

/** npm / shell 输出行语义分类，用于终端风格着色 */
export function deployLogLineClass(line: string): string {
  const s = line.trim();
  if (!s) return 'blank';
  if (/npm ERR!/i.test(s)) return 'err';
  if (/npm WARN/i.test(s)) return 'warn';
  if (/^npm http (fetch|cache)/i.test(s)) {
    if (/\(cache hit\)/i.test(s) || /cache hit/i.test(s)) return 'cache';
    return 'http';
  }
  if (/^npm (info|notice)/i.test(s)) return 'info';
  if (/^(added|removed|changed)\s+\d+\s+packages?/i.test(s) || /^audited\s+\d+/i.test(s) || /vulnerabilit/i.test(s)) return 'summary';
  if (/^\+[\s@/]|^└|^├|^│/.test(s)) return 'tree';
  if (/\b(fatal|FATAL|error:)\b/i.test(s) && !/0 error/i.test(s)) return 'err';
  return 'default';
}

/** Material Symbols icon helper */
export function MI(name: string, cls?: string) {
  return (
    <span className={`material-symbols-outlined ${cls || ''}`}>{name}</span>
  );
}

/** sessionStorage key: 用户取消部署后阻止 Wi‑Fi 触发的自动安装 */
export const openclawWifiAutoUserBlockKey = (deviceId: string) => `oc-wifi-auto-user-block-${deviceId}`;
