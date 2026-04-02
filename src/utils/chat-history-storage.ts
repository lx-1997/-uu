import type { ChatMessage } from '../app-types';
import { getRdkEmbedPanel } from './embed-mode';

/** 与 useAIChatStore 一致，供历史面板与主对话共用 */
export const CHAT_HISTORY_LEGACY_KEY = 'rdk-chat-history';
const CHAT_HISTORY_KEY_PREFIX = 'rdk-chat-history:';
export const GLOBAL_CHAT_DEVICE_ID = '__global__';

const MAX_CHAT_MESSAGES_IN_MEMORY = 100;

/** Studio 会话 id：主窗口可镜像到 localStorage；副屏仅 sessionStorage，实现每窗口独立会话 */
export const CHAT_STUDIO_SESSION_ID_PREFIX = 'rdk:chat:session-id:';

export function toChatDeviceId(deviceId?: string | null) {
  const normalized = String(deviceId || '').trim();
  return normalized || GLOBAL_CHAT_DEVICE_ID;
}

export function chatSessionStorageKey(deviceId: string) {
  return `${CHAT_STUDIO_SESSION_ID_PREFIX}${toChatDeviceId(deviceId)}`;
}

/**
 * 每个浏览器顶级窗口独立的 Studio 会话 id（sessionStorage）。
 * 主窗口首次会从 localStorage 迁移旧 id，避免升级丢线程；embed 副屏永不读该迁移，保证新窗口新对话。
 */
export function getOrCreateStudioChatSessionId(deviceId: string): string {
  const key = chatSessionStorageKey(deviceId);
  const isEmbed = typeof window !== 'undefined' && getRdkEmbedPanel() != null;
  try {
    const fromSession = sessionStorage.getItem(key)?.trim();
    if (fromSession) return fromSession;

    if (!isEmbed) {
      const fromLocal = localStorage.getItem(key)?.trim();
      if (fromLocal) {
        sessionStorage.setItem(key, fromLocal);
        return fromLocal;
      }
    }

    const created = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(key, created);
    if (!isEmbed) {
      try {
        localStorage.setItem(key, created);
      } catch {
        /* ignore */
      }
    }
    return created;
  } catch {
    return `ui-${Date.now()}`;
  }
}

export function persistStudioChatSessionId(deviceId: string, sessionId: string): void {
  const next = String(sessionId || '').trim();
  if (!next) return;
  const key = chatSessionStorageKey(deviceId);
  try {
    sessionStorage.setItem(key, next);
    if (typeof window !== 'undefined' && getRdkEmbedPanel() == null) {
      localStorage.setItem(key, next);
    }
  } catch {
    /* ignore */
  }
}

/** 升级前「每设备单文件」存档键（已无会话后缀） */
export function chatHistoryLegacyDeviceKey(deviceId: string) {
  return `${CHAT_HISTORY_KEY_PREFIX}${toChatDeviceId(deviceId)}`;
}

/** 当前 Studio 对话线程的 localStorage 键（设备 + 会话 id） */
export function chatHistoryStorageKey(deviceId: string, studioSessionId: string) {
  const dev = toChatDeviceId(deviceId);
  const sid = String(studioSessionId || '').trim() || '_na';
  return `${CHAT_HISTORY_KEY_PREFIX}${dev}:${sid}`;
}

export function loadChatHistoryFromStorage(deviceId: string, studioSessionId: string): ChatMessage[] {
  const newKey = chatHistoryStorageKey(deviceId, studioSessionId);
  const isEmbed = typeof window !== 'undefined' && getRdkEmbedPanel() != null;
  try {
    let raw = localStorage.getItem(newKey);
    if (!raw && !isEmbed) {
      const legacyKey = chatHistoryLegacyDeviceKey(deviceId);
      const legacy =
        localStorage.getItem(legacyKey) ??
        (toChatDeviceId(deviceId) === GLOBAL_CHAT_DEVICE_ID ? localStorage.getItem(CHAT_HISTORY_LEGACY_KEY) : null);
      if (legacy) {
        try {
          localStorage.setItem(newKey, legacy);
          localStorage.removeItem(legacyKey);
          if (toChatDeviceId(deviceId) === GLOBAL_CHAT_DEVICE_ID) {
            localStorage.removeItem(CHAT_HISTORY_LEGACY_KEY);
          }
        } catch {
          /* still return migrated content below */
        }
        raw = legacy;
      }
    }
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

/** 历史弹窗：合并某设备下所有已持久化会话分片 */
export function loadAnyChatHistoryForDevice(deviceId: string): ChatMessage[] {
  const dev = toChatDeviceId(deviceId);
  const basePrefix = `${CHAT_HISTORY_KEY_PREFIX}${dev}`;
  const map = new Map<number, ChatMessage>();
  const parseAndMerge = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as ChatMessage[];
      for (const m of parsed) map.set(m.id, m);
    } catch {
      /* skip */
    }
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === CHAT_HISTORY_LEGACY_KEY && dev === GLOBAL_CHAT_DEVICE_ID) {
        const raw = localStorage.getItem(k);
        if (raw) parseAndMerge(raw);
        continue;
      }
      if (k === basePrefix || k.startsWith(`${basePrefix}:`)) {
        const raw = localStorage.getItem(k);
        if (raw) parseAndMerge(raw);
      }
    }
  } catch {
    /* ignore */
  }
  return Array.from(map.values())
    .sort((x, y) => x.id - y.id)
    .slice(-MAX_CHAT_MESSAGES_IN_MEMORY)
    .map(m => ({
      ...m,
      blocks: m.blocks?.filter(b => b.type !== 'confirm' && b.type !== 'progress'),
    }));
}

/** 列出 localStorage 中已有对话存档的设备 id（含 `__global__`） */
export function listStoredChatHistoryDeviceIds(): string[] {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CHAT_HISTORY_KEY_PREFIX)) continue;
      if (k === CHAT_HISTORY_LEGACY_KEY) continue;
      const rest = k.slice(CHAT_HISTORY_KEY_PREFIX.length);
      const firstColon = rest.indexOf(':');
      const devicePart = firstColon === -1 ? rest : rest.slice(0, firstColon);
      if (devicePart) ids.add(devicePart);
    }
    if (localStorage.getItem(CHAT_HISTORY_LEGACY_KEY)) {
      ids.add(GLOBAL_CHAT_DEVICE_ID);
    }
  } catch {
    /* ignore */
  }
  return [...ids].sort();
}
