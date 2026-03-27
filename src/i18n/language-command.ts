/**
 * 识别「仅用于切换界面语言」的整句输入（不发给模型）。
 */
export function parseUiLanguageCommand(raw: string): 'zh-CN' | 'en' | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const low = s.toLowerCase();

  if (
    /^(中文界面|切换到中文|切换中文|用中文|界面中文|简体中文|简体中文版)$/.test(s) ||
    /^(\/lang\s+zh(-cn)?|language\s+chinese|switch\s+to\s+chinese|use\s+chinese)$/i.test(low)
  ) {
    return 'zh-CN';
  }

  if (
    /^(英文界面|切换到英文|切换英文|用英文|界面英文|英语界面)$/.test(s) ||
    /^(\/lang\s+en|language\s+english|switch\s+to\s+english|use\s+english|english\s+ui)$/i.test(low)
  ) {
    return 'en';
  }

  return null;
}
