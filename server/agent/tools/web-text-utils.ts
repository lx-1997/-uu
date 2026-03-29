/**
 * 网页正文抽取与 URL 规范化（web_fetch / web_browser_fetch 共用）
 */

export function decodeEntities(input: string) {
  let s = input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
  s = s.replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => {
    const cp = parseInt(h, 16);
    return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : _;
  });
  s = s.replace(/&#(\d{1,7});/g, (_, d) => {
    const cp = parseInt(d, 10);
    return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : _;
  });
  return s;
}

export function stripHtml(html: string) {
  const withoutScript = html
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = withoutScript.replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[...内容已截断，总长度 ${text.length} 字符]`;
}

export function normalizeUrl(raw: string) {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("URL 仅支持 http/https 协议");
  }
  const url = new URL(value);
  return url.toString();
}
