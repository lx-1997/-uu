/**
 * @引用解析器 — 从用户消息中提取 @bot / @docs / @url / @reset 指令
 *
 * 语法：
 *   @bot <机器人名称>    — 切换到指定 RoboBot（加载人格+知识空间）
 *   @docs <知识空间名称> — 追加知识空间到当前对话
 *   @url <URL>          — 即时引用在线文档
 *   @reset              — 回到默认小地瓜
 *
 * 设计原则：
 * - 指令仅在消息开头或独立行中识别，避免误匹配正文中的 @ 符号
 * - 提取指令后返回清洗后的纯用户消息（去掉指令部分）
 * - @url 可以出现在消息任意位置
 */

export interface AtRefBot {
  type: "bot";
  name: string;
}

export interface AtRefDocs {
  type: "docs";
  name: string;
}

export interface AtRefUrl {
  type: "url";
  url: string;
}

export interface AtRefReset {
  type: "reset";
}

export type AtRef = AtRefBot | AtRefDocs | AtRefUrl | AtRefReset;

export interface ParsedAtRefs {
  /** 解析出的所有 @引用 */
  refs: AtRef[];
  /** 去掉 @指令后的纯用户消息 */
  cleanMessage: string;
  /** 是否包含 @bot 切换 */
  hasBot: boolean;
  /** 是否包含 @reset */
  hasReset: boolean;
  /** 提取出的 URL 列表 */
  urls: string[];
  /** 提取出的文档名称列表 */
  docNames: string[];
  /** 提取出的 bot 名称 */
  botName?: string;
}

// ---------------------------------------------------------------------------
//  正则模式
// ---------------------------------------------------------------------------

/**
 * @bot 匹配：@bot 后跟非空名称
 * 支持中英文名称和空格（用引号包裹时支持空格）
 */
const RE_AT_BOT = /^@bot\s+(?:"([^"]+)"|'([^']+)'|(\S+))/im;

/**
 * @docs 匹配
 */
const RE_AT_DOCS = /@docs\s+(?:"([^"]+)"|'([^']+)'|(\S+))/gi;

/**
 * @url 匹配：@url 后跟 URL
 */
const RE_AT_URL = /@url\s+(https?:\/\/\S+)/gi;

/**
 * @reset 匹配
 */
const RE_AT_RESET = /^@reset\b/im;

// ---------------------------------------------------------------------------
//  解析
// ---------------------------------------------------------------------------

export function parseAtRefs(message: string): ParsedAtRefs {
  const refs: AtRef[] = [];
  const urls: string[] = [];
  const docNames: string[] = [];
  let botName: string | undefined;
  let hasBot = false;
  let hasReset = false;

  let cleaned = message;

  // 1. 检测 @reset
  if (RE_AT_RESET.test(cleaned)) {
    refs.push({ type: "reset" });
    hasReset = true;
    cleaned = cleaned.replace(RE_AT_RESET, "").trim();
  }

  // 2. 检测 @bot（只取第一个）
  const botMatch = RE_AT_BOT.exec(cleaned);
  if (botMatch) {
    const name = (botMatch[1] ?? botMatch[2] ?? botMatch[3]).trim();
    if (name) {
      refs.push({ type: "bot", name });
      botName = name;
      hasBot = true;
      cleaned = cleaned.replace(botMatch[0], "").trim();
    }
  }

  // 3. 检测所有 @docs
  let docsMatch: RegExpExecArray | null;
  const docsRe = new RegExp(RE_AT_DOCS.source, RE_AT_DOCS.flags);
  while ((docsMatch = docsRe.exec(cleaned)) !== null) {
    const name = (docsMatch[1] ?? docsMatch[2] ?? docsMatch[3]).trim();
    if (name) {
      refs.push({ type: "docs", name });
      docNames.push(name);
    }
  }
  cleaned = cleaned.replace(new RegExp(RE_AT_DOCS.source, RE_AT_DOCS.flags), "").trim();

  // 4. 检测所有 @url
  let urlMatch: RegExpExecArray | null;
  const urlRe = new RegExp(RE_AT_URL.source, RE_AT_URL.flags);
  while ((urlMatch = urlRe.exec(cleaned)) !== null) {
    const url = urlMatch[1].trim();
    if (url) {
      refs.push({ type: "url", url });
      urls.push(url);
    }
  }
  cleaned = cleaned.replace(new RegExp(RE_AT_URL.source, RE_AT_URL.flags), "").trim();

  return {
    refs,
    cleanMessage: cleaned,
    hasBot,
    hasReset,
    urls,
    docNames,
    botName,
  };
}

/**
 * 判断消息是否包含任何 @引用
 */
export function hasAtRefs(message: string): boolean {
  return (
    RE_AT_RESET.test(message) ||
    RE_AT_BOT.test(message) ||
    new RegExp(RE_AT_DOCS.source, RE_AT_DOCS.flags).test(message) ||
    new RegExp(RE_AT_URL.source, RE_AT_URL.flags).test(message)
  );
}
