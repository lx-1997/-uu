import QRCode from "qrcode";
import { Buffer } from "node:buffer";

/**
 * 微信 iLink `get_bot_qrcode` 的 `qrcode_img_content` 可能是：
 * - 栅格图 base64（PNG/JPEG 等）；
 * - 或 **要写进二维码的字符串**（常为 https:// / weixin:// 链接）——与 @tencent-weixin/openclaw-weixin 的
 *   `qrcode-terminal.generate(qrResponse.qrcode_img_content)` 一致，不能当「图片 URL」去 fetch。
 * 若把 `qrcode` 的 hex token 误当成唯一载荷生成二维码，微信扫一扫会只显示一串十六进制文本。
 */

function normalizeUnknownInput(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

/** 非微信 iLink 登录 token（误把 WiFi 配置串等当 qrcode 时不能用来生成二维码） */
function isSpuriousWeixinLoginToken(token: string): boolean {
  const t = String(token || "").trim();
  if (!t) return true;
  if (/^WIFI:/i.test(t)) return true;
  return false;
}

/** URL-safe base64 → 标准 base64，便于 Buffer 解码 */
function normalizeBase64Chunk(s: string): string {
  let t = s.replace(/\s/g, "");
  if (t.includes("-") || t.includes("_")) {
    t = t.replace(/-/g, "+").replace(/_/g, "/");
    const pad = t.length % 4;
    if (pad) t += "=".repeat(4 - pad);
  }
  return t;
}

/** 根据文件头选择 MIME，避免误标成 PNG 导致裂图 */
function dataUrlFromRawBase64(b64Raw: string): string | null {
  const compact = normalizeBase64Chunk(b64Raw);
  if (compact.length < 24) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
  try {
    const buf = Buffer.from(compact, "base64");
    if (buf.length < 4) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return `data:image/png;base64,${compact}`;
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return `data:image/jpeg;base64,${compact}`;
    }
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return `data:image/gif;base64,${compact}`;
    }
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
      return `data:image/webp;base64,${compact}`;
    }
    // 无法识别头时不要用假 PNG（会裂图），交给外层用 qrcode 字段生成二维码
    return null;
  } catch {
    return null;
  }
}

function isRasterImageMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  if (
    buf.length >= 12
    && buf[0] === 0x52
    && buf[1] === 0x49
    && buf[2] === 0x46
    && buf[3] === 0x46
    && buf[8] === 0x57
    && buf[9] === 0x45
    && buf[10] === 0x42
    && buf[11] === 0x50
  ) {
    return true;
  }
  return false;
}

async function bufferFromQrToken(token: string): Promise<{ buf: Buffer; mime: string }> {
  const dataUrl = await QRCode.toDataURL(token, { width: 280, margin: 2 });
  const m = dataUrl.match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/is);
  if (!m) throw new Error("ilink: 本地生成二维码失败");
  const b64 = normalizeBase64Chunk(m[2]);
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw new Error("ilink: 本地生成二维码为空");
  return { buf, mime: m[1] };
}


export async function resolveIlinkQrDisplayDataUrl(input: {
  qrcode: string;
  qrcodeImgContent: string;
}): Promise<string> {
  const imgRaw = normalizeUnknownInput(input.qrcodeImgContent);
  const token = String(input.qrcode || "").trim();

  if (imgRaw) {
    if (/^data:image\//i.test(imgRaw)) return imgRaw;
    /** 链接/自定义 scheme：编码进二维码本体，勿 fetch（页面常为 HTML，会导致误回退到 qrcode hex） */
    if (/^https?:\/\//i.test(imgRaw) || /^weixin:/i.test(imgRaw)) {
      return QRCode.toDataURL(imgRaw, { width: 280, margin: 2 });
    }
    const asData = dataUrlFromRawBase64(imgRaw);
    if (asData) return asData;
  }

  if (token && !isSpuriousWeixinLoginToken(token)) {
    return QRCode.toDataURL(token, { width: 280, margin: 2 });
  }

  if (token && isSpuriousWeixinLoginToken(token)) {
    throw new Error("ilink: qrcode 字段无效（疑似 WiFi 等非微信登录串），且无可用的 qrcode_img_content");
  }

  throw new Error("ilink: 缺少可用的二维码图片或 qrcode 字段");
}

/**
 * 将二维码解析为内存 Buffer + MIME，供短时 HTTP 预览路由返回（避免 SSE 塞超长 data URL）。
 */
export async function prepareWeChatQrPreviewBuffer(input: {
  qrcode: string;
  qrcodeImgContent: string;
}): Promise<{ buf: Buffer; mime: string }> {
  const token = String(input.qrcode || "").trim();
  const resolved = await resolveIlinkQrDisplayDataUrl(input);
  const m = resolved.match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/is);
  if (!m) {
    throw new Error("ilink: 无法将二维码解析为 data URL");
  }
  const b64 = normalizeBase64Chunk(m[2]);
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) {
    throw new Error("ilink: 二维码图片 base64 解码为空");
  }
  const out = { buf, mime: m[1] };
  if (!isRasterImageMagic(out.buf) && token && !isSpuriousWeixinLoginToken(token)) {
    return bufferFromQrToken(token);
  }
  if (!isRasterImageMagic(out.buf)) {
    throw new Error("ilink: 二维码图片数据无效");
  }
  return out;
}
