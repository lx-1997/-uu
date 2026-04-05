import type { Tab } from '../app-types';

/**
 * 产品级开关：关闭时隐藏侧栏/轨道入口，并配合路由归一化避免误入对应 Tab。
 * 需要恢复「本地模型 / Ollama」时改为 true。
 */
export const STUDIO_SHOW_LOCAL_OLLAMA_NAV = false;

/**
 * 关闭时隐藏 AI 对话 Hub、底部 RDKClaw Dock，并禁止展开对话（含副屏 popout）。
 * 需要恢复「RDKClaw 对话」时改为 true。
 */
export const STUDIO_SHOW_AI_CHAT_DOCK = true;

/** 关闭时隐藏 Dock 麦克风按钮，且不发起录音 / 服务端语音转写（语音→文字）。文字对话与其它能力不受影响。 */
export const STUDIO_ENABLE_VOICE_TO_TEXT = false;

/**
 * 关闭时隐藏 AI 回复旁的「朗读」按钮，且不调用 `/api/agent/tts`（本机 edge-tts 在线合成，会联网并写临时缓存；无本地「模型」下载，但与朗读能力一并关闭）。
 * 需要恢复时改为 `true`。
 */
export const STUDIO_ENABLE_DOCK_TTS = false;

export function normalizeTabForFeatures(tab: Tab): Tab {
  if (!STUDIO_SHOW_LOCAL_OLLAMA_NAV && tab === 'local-models') return 'dashboard';
  /** 独立「AI 对话」页已移除；入口为 Dock / 轨道「会话」 */
  if (tab === 'ai-chat-hub') return 'dashboard';
  /** 旧独立「硬件监控」Tab 已并入总览（Dashboard）；旧会话/动作仍可能传 `hardware` */
  if (tab === 'hardware') return 'dashboard';
  return tab;
}
