export type DockMentionCapabilityId = 'flash';

export interface DockMentionCapability {
  id: DockMentionCapabilityId;
  labelZh: string;
  labelEn: string;
  keywords: string[];
}

/** Dock 输入框 @ 可调用的能力（可扩展更多 id） */
export const DOCK_MENTION_CAPABILITIES: DockMentionCapability[] = [
  {
    id: 'flash',
    labelZh: '烧写',
    labelEn: 'Image flash',
    keywords: ['烧写', '镜像', 'flash', 'imager', 'tf', 'sd', 'xburn', '固件'],
  },
];

/**
 * 解析输入末尾是否处于 @ 提及模式（`@` 后为当前查询片段，遇空白行前有效）。
 * 避免误判邮箱：`foo@bar` 不会触发。
 */
export function parseTrailingAtMention(value: string): { atIndex: number; query: string } | null {
  const lastAt = value.lastIndexOf('@');
  if (lastAt < 0) return null;
  if (lastAt > 0) {
    const prev = value[lastAt - 1];
    if (/[A-Za-z0-9._-]/.test(prev)) return null;
  }
  const after = value.slice(lastAt + 1);
  if (after.includes('\n')) return null;
  return { atIndex: lastAt, query: after };
}

export function filterMentionCapabilities(
  items: DockMentionCapability[],
  query: string,
  isEn: boolean,
): DockMentionCapability[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    const label = (isEn ? it.labelEn : it.labelZh).toLowerCase();
    if (label.includes(q)) return true;
    return it.keywords.some((k) => {
      const kl = k.toLowerCase();
      return kl.includes(q) || q.includes(kl);
    });
  });
}

/** 与 Flasher 跳转上下文约定（勿改 key，Flasher 已消费） */
export const FLASHER_MENTION_SESSION_KEY = 'rdk:flasher:mention-context';

export interface FlasherMentionContext {
  deviceKey: string;
  preferLocalImage: boolean;
}
