/**
 * 检测「用户只想打开/浏览网页」类意图，用于注入路由提示与 find_skills 遥测。
 * 保守匹配：宁可少触发，避免把复杂任务误判成纯开网页。
 */

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]]+|\bwww\.[a-z0-9][-a-z0-9.]*\.[a-z]{2,}\b|\b[a-z0-9][-a-z0-9]*\.(com|cn|net|org|io|cc|ai)\b/i;

const OPEN_VERB_RE = /打开|开一下|访问|浏览|看下|看一下|瞧瞧|进入|跳转|开个|帮我开|在浏览器/i;

const WEB_NOUN_RE = /网页|网站|链接|网址|url|主页|搜索引擎/i;

/** 知名站点单说名也常表示打开网页 */
const KNOWN_SITE_RE = /打开\s*(百度|谷歌|必应|淘宝|京东|github|bilibili|哔哩)/i;

/**
 * 用户整段消息是否更像「打开网页」而非板端/工作区任务。
 */
export function detectOpenWebUserIntent(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length > 800) return false;
  if (URL_IN_TEXT_RE.test(t)) return true;
  if (KNOWN_SITE_RE.test(t)) return true;
  if (OPEN_VERB_RE.test(t) && WEB_NOUN_RE.test(t)) return true;
  if (OPEN_VERB_RE.test(t) && URL_IN_TEXT_RE.test(t)) return true;
  return false;
}

/**
 * find_skills 的 query 是否像误把「开网页」当成技能检索（仅用于日志，不阻断）。
 */
export function findSkillsQueryLooksLikeOpenWebDistractor(query: string): boolean {
  const q = String(query || '').trim();
  if (!q || q.length > 200) return false;
  if (URL_IN_TEXT_RE.test(q)) return true;
  if (/打开.*网页|网页.*打开|开个?浏览器|浏览器.*打开|open\s*url|browse\s*web|导航到|visit\s*http/i.test(q)) return true;
  if (/^浏览器$/i.test(q.trim())) return true;
  return false;
}

/** 写入 system 提示的动态段：紧贴本轮用户输入 */
export function buildOpenWebRouteHintBlock(): string {
  return [
    '## 本轮用户消息 · 打开网页（路由）',
    '检测到用户**主要诉求为打开/浏览网页或已给出 URL**。本回合应 **直接 `studio_open_url`**，协议仅限 http(s)；若只给了域名请补全 `https://`。',
    '**不要**为此调用 `find_skills` / `skillhub_search` / `sessions_spawn`；**不要**检索或安装「浏览器」类 Skill。需要登录后再把正文交给 Agent 时用 `studio_embedded_browser_capture`。',
  ].join('\n');
}
