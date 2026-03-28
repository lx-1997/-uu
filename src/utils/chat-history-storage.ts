import type { ChatMessage } from '../app-types';

/** 与 useAIChatStore 一致，供历史面板与主对话共用 */
export const CHAT_HISTORY_LEGACY_KEY = 'rdk-chat-history';
const CHAT_HISTORY_KEY_PREFIX = 'rdk-chat-history:';
export const GLOBAL_CHAT_DEVICE_ID = '__global__';

const MAX_CHAT_MESSAGES_IN_MEMORY = 100;

export function toChatDeviceId(deviceId?: string | null) {
  const normalized = String(deviceId || '').trim();
  return normalized || GLOBAL_CHAT_DEVICE_ID;
}

export function chatHistoryStorageKey(deviceId: string) {
  return `${CHAT_HISTORY_KEY_PREFIX}${toChatDeviceId(deviceId)}`;
}

/** 从 localStorage 读取某设备（或全局）的持久化对话，与主对话加载逻辑一致 */
export function loadChatHistoryFromStorage(deviceId: string): ChatMessage[] {
  try {
    const specific = localStorage.getItem(chatHistoryStorageKey(deviceId));
    const legacy = !specific && toChatDeviceId(deviceId) === GLOBAL_CHAT_DEVICE_ID
      ? localStorage.getItem(CHAT_HISTORY_LEGACY_KEY)
      : null;
    const raw = specific ?? legacy;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return parsed
      .slice(-MAX_CHAT_MESSAGES_IN_MEMORY)
      .map(m => ({
        ...m,
        blocks: m.blocks?.filter(b => b.type !== 'confirm' && b.type !== 'progress'),
      }));
  } catch {
    return [];
  }
}

/** 列出 localStorage 中已有对话存档的设备 id（含 `__global__`） */
export function listStoredChatHistoryDeviceIds(): string[] {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CHAT_HISTORY_KEY_PREFIX)) continue;
      ids.add(k.slice(CHAT_HISTORY_KEY_PREFIX.length));
    }
    if (localStorage.getItem(CHAT_HISTORY_LEGACY_KEY)) {
      ids.add(GLOBAL_CHAT_DEVICE_ID);
    }
  } catch {
    /* ignore */
  }
  return [...ids].sort();
}
