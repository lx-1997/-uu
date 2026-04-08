import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import iconv from "iconv-lite";
import { getApiKey, getBaseUrl, type ProviderConfig } from "../provider-setup.js";
import { transcribeLocalWhisperFromFile } from "../../local-whisper-stt.js";
import type { Tool } from "./types.js";

let unpdfExtractText: ((data: any, options: any) => Promise<{ text: string; totalPages: number }>) | null = null;
try {
  const unpdf = await import("unpdf");
  unpdfExtractText = unpdf.extractText as any;
} catch { /* unpdf not available */ }

let mammothExtractRawText: ((input: { buffer: Buffer }) => Promise<{ value: string }>) | null = null;
try {
  const mammoth = await import("mammoth");
  mammothExtractRawText = mammoth.extractRawText as any;
} catch { /* mammoth not available */ }

let JSZip: (new () => { loadAsync: (data: Buffer) => Promise<any>; file: (name: string) => any }) | null = null;
try {
  const mod = await import("jszip");
  JSZip = (mod.default ?? mod) as any;
} catch { /* jszip not available */ }

export interface ChatAttachmentInput {
  id: string;
  type: "image" | "file" | "audio" | "video";
  name: string;
  mimeType?: string;
  size?: number;
  contentBase64?: string;
  storedPath?: string;
  transcript?: string;
  textContent?: string;
  source?: "studio" | "feishu" | "weixin";
}

export interface SessionAttachment {
  id: string;
  type: "image" | "file" | "audio" | "video";
  name: string;
  mimeType?: string;
  size?: number;
  storedPath?: string;
  createdAt: number;
  transcript?: string;
  textContent?: string;
  source?: "studio" | "feishu" | "weixin";
}

export interface PreparedAttachmentState {
  allAttachments: SessionAttachment[];
  newAttachments: SessionAttachment[];
}

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACT_CHARS = 18_000;

const TEXT_LIKE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sh",
  ".log",
  ".xml",
  ".html",
  ".css",
  ".rst",
  ".tex",
  ".rtf",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".sql",
  ".r",
  ".lua",
  ".swift",
  ".kt",
  ".scala",
  ".dart",
  ".cmake",
  ".makefile",
  ".dockerfile",
  ".gitignore",
  ".env",
]);

const OFFICE_DOC_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);

const VISION_FALLBACK_BY_PROVIDER: Record<string, string> = {
  openai: "gpt-4o-mini",
  "openai-compatible": "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-flash",
  qwen: "qwen-vl-max-latest",
  bailian: "qwen-vl-max-latest",
  deepseek: "deepseek-chat",
  zhipu: "glm-4v-flash",
  moonshot: "moonshot-v1-128k",
  siliconflow: "Qwen/Qwen2.5-VL-72B-Instruct",
  volcengine: "doubao-1.5-vision-pro-32k",
  xai: "grok-2-vision-1212",
};

const VISION_HINT_PATTERNS = /vision|vl|4v|4o|grok-2|gemini|claude|glm-4v|doubao.*vision|qwen.*vl/i;

const visionCapabilityCache = new Map<string, boolean>();

/** Groq 等兼容网关常用；OpenAI 官服需用 gpt-4o-mini-transcribe / whisper-1 */
const ASR_WHISPER_LARGE_V3_TURBO = "whisper-large-v3-turbo";
const ASR_OPENAI_OFFICIAL = "gpt-4o-mini-transcribe";

const AUDIO_MODEL_BY_PROVIDER: Record<string, string> = {
  /** OpenAI 兼容：默认同 Groq 文档，首选 large v3 turbo */
  "openai-compatible": ASR_WHISPER_LARGE_V3_TURBO,
  groq: ASR_WHISPER_LARGE_V3_TURBO,
  qwen: "qwen3-asr-flash",
  bailian: "qwen3-asr-flash",
};

function resolveTranscriptionModel(cfg: ProviderConfig): string | undefined {
  if (cfg.provider === "openai") {
    try {
      const base = getBaseUrl(cfg).toLowerCase();
      if (base.includes("groq.com")) return ASR_WHISPER_LARGE_V3_TURBO;
    } catch {
      /* ignore */
    }
    return ASR_OPENAI_OFFICIAL;
  }
  return AUDIO_MODEL_BY_PROVIDER[cfg.provider];
}

/** 当前 Studio Provider 是否具备可用的云端语音转写链路（避免盲目请求 /audio/transcriptions 得到 404） */
export function isStudioProviderAsrSupported(cfg: ProviderConfig | null | undefined): boolean {
  if (!cfg?.apiKey?.trim()) return false;
  if (cfg.provider === "qwen" || cfg.provider === "bailian") return true;
  try {
    const base = getBaseUrl(cfg as ProviderConfig).toLowerCase();
    /** 火山方舟等「对话」OpenAI 兼容基座通常不提供 Whisper 类 /audio/transcriptions */
    if (/volces\.com|\.volcengine\.|ark\.cn-/i.test(base)) {
      return false;
    }
  } catch {
    /* ignore */
  }
  return Boolean(resolveTranscriptionModel(cfg as ProviderConfig));
}

function asrUpstreamErrorMessage(status: number, fallbackDetail: string): string {
  if (status === 404) {
    return (
      "云端语音接口返回 404：该 baseUrl 可能不提供 OpenAI 兼容的 /audio/transcriptions。" +
      "请配置本机 whisper：环境变量 RDK_STUDIO_WHISPER_CPP（whisper-cli）与 RDK_STUDIO_WHISPER_CPP_MODEL，并安装 ffmpeg；" +
      "或改用支持语音转写的兼容网关（OpenAI/ Groq 等）。"
    );
  }
  return fallbackDetail || `语音转写失败 (${status})`;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "attachment";
}

function sessionSafeKey(sessionId: string) {
  return sanitizeSegment(sessionId).slice(0, 120) || `session-${Date.now()}`;
}

function resolveAttachmentRoot(sessionId: string) {
  return path.join(os.homedir(), ".rdkstudio", "chat-attachments", sessionSafeKey(sessionId));
}

function manifestPath(sessionId: string) {
  return path.join(resolveAttachmentRoot(sessionId), "manifest.json");
}

function normalizeName(name: string, type: ChatAttachmentInput["type"]) {
  const trimmed = String(name || "").trim();
  if (trimmed) return trimmed;
  return `${type}-${Date.now()}`;
}

function isTextLikeAttachment(name: string, mimeType?: string) {
  if (mimeType?.startsWith("text/")) return true;
  if (mimeType && [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/typescript",
  ].includes(mimeType)) {
    return true;
  }
  return TEXT_LIKE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function normalizeText(raw: string) {
  return raw.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}

function truncateText(value: string, max = MAX_EXTRACT_CHARS) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[...已截断，共 ${value.length} 字符]`;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  if (!unpdfExtractText) return "";
  try {
    const result = await unpdfExtractText(new Uint8Array(buffer), { mergePages: true });
    const text = normalizeText(String(result.text));
    if (!text) return "";
    return truncateText(text, 50_000);
  } catch {
    return "";
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  if (!mammothExtractRawText) return "";
  try {
    const result = await mammothExtractRawText({ buffer });
    const text = normalizeText(String(result.value));
    return text ? truncateText(text, 50_000) : "";
  } catch {
    return "";
  }
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  if (!JSZip) return "";
  try {
    const zip = await new JSZip!().loadAsync(buffer);
    const slideTexts: string[] = [];
    const slideFiles = Object.keys((zip as any).files)
      .filter((name: string) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort();
    for (const slideName of slideFiles) {
      const xml = await (zip as any).files[slideName].async("string");
      const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map((m: any) => m[1]);
      if (texts.length > 0) {
        const slideNum = slideName.match(/slide(\d+)/)?.[1] || "?";
        slideTexts.push(`--- Slide ${slideNum} ---\n${texts.join(" ")}`);
      }
    }
    const text = normalizeText(slideTexts.join("\n\n"));
    return text ? truncateText(text, 50_000) : "";
  } catch {
    return "";
  }
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  if (!JSZip) return "";
  try {
    const zip = await new JSZip!().loadAsync(buffer);
    const sharedStringsFile = (zip as any).files["xl/sharedStrings.xml"];
    const sharedStrings: string[] = [];
    if (sharedStringsFile) {
      const xml = await sharedStringsFile.async("string");
      const matches = Array.from(xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g));
      for (const m of matches) sharedStrings.push((m as any)[1]);
    }
    const sheetFiles = Object.keys((zip as any).files)
      .filter((name: string) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort();
    const sheetTexts: string[] = [];
    for (const sheetName of sheetFiles) {
      const xml = await (zip as any).files[sheetName].async("string");
      const rows = Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g));
      const rowTexts: string[] = [];
      for (const row of rows) {
        const cells = Array.from((row as any)[1].matchAll(/<c[^>]*(?:t="s"[^>]*)?>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>|<c[^>]*?>[\s\S]*?<v>([^<]*)<\/v>[\s\S]*?<\/c>/g));
        const cellValues: string[] = [];
        for (const cell of cells) {
          const sharedIdx = (cell as any)[1];
          const rawVal = (cell as any)[2];
          if (sharedIdx !== undefined && sharedStrings[Number(sharedIdx)]) {
            cellValues.push(sharedStrings[Number(sharedIdx)]);
          } else if (rawVal !== undefined) {
            cellValues.push(rawVal);
          }
        }
        if (cellValues.length > 0) rowTexts.push(cellValues.join("\t"));
      }
      if (rowTexts.length > 0) {
        const sheetNum = sheetName.match(/sheet(\d+)/)?.[1] || "?";
        sheetTexts.push(`--- Sheet ${sheetNum} ---\n${rowTexts.join("\n")}`);
      }
    }
    const text = normalizeText(sheetTexts.join("\n\n"));
    return text ? truncateText(text, 50_000) : "";
  } catch {
    return "";
  }
}

function isPdfAttachment(name: string, mimeType?: string): boolean {
  if (mimeType === "application/pdf") return true;
  return path.extname(name).toLowerCase() === ".pdf";
}

function isDocxAttachment(name: string, mimeType?: string): boolean {
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return path.extname(name).toLowerCase() === ".docx";
}

function isPptxAttachment(name: string, mimeType?: string): boolean {
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return true;
  return path.extname(name).toLowerCase() === ".pptx";
}

function isXlsxAttachment(name: string, mimeType?: string): boolean {
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return true;
  return path.extname(name).toLowerCase() === ".xlsx";
}

function isOfficeDocAttachment(name: string, mimeType?: string): boolean {
  return isDocxAttachment(name, mimeType) || isPptxAttachment(name, mimeType) || isXlsxAttachment(name, mimeType);
}

/** 粗略统计中日韩统一表意文字与 CJK 标点，用于 UTF-8 vs GB18030 择优 */
function cjkTextScore(s: string): number {
  let score = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) score += 3;
    else if (c >= 0x3400 && c <= 0x4dbf) score += 2;
    else if ((c >= 0xf900 && c <= 0xfaff) || (c >= 0x3000 && c <= 0x303f)) score += 1;
  }
  return score;
}

/**
 * 纯文本字节 → 字符串：支持 UTF-8（含 BOM）、UTF-16 LE/BE（含 BOM）、GB18030（兼容 Windows 记事本「ANSI」/GBK 保存的中文 .txt）。
 * 仅用于文本类附件；乱码多因误用 UTF-8 解码 GBK 字节。
 */
export function decodePlainTextAttachmentBuffer(buffer: Buffer): string {
  if (buffer.length === 0) return "";

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return pickUtf8OrGb18030(buffer.subarray(3));
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const b = buffer.subarray(2);
    const evenLen = b.length & ~1;
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped[i] = b[i + 1]!;
      swapped[i + 1] = b[i]!;
    }
    return swapped.toString("utf16le");
  }

  return pickUtf8OrGb18030(buffer);
}

function pickUtf8OrGb18030(body: Buffer): string {
  const utf8 = body.toString("utf8");
  const replacementCount = utf8.split("\uFFFD").length - 1;
  let gb: string;
  try {
    gb = iconv.decode(body, "gb18030");
  } catch {
    return utf8;
  }
  const su = cjkTextScore(utf8);
  const sg = cjkTextScore(gb);

  if (replacementCount > 0) {
    return sg >= su ? gb : utf8;
  }

  if (su >= 24 && su >= sg) {
    return utf8;
  }
  if (sg > su + 8 && sg >= 12) {
    return gb;
  }
  return utf8;
}

function readTextFromBuffer(buffer: Buffer, name: string, mimeType?: string): string {
  if (!isTextLikeAttachment(name, mimeType) || buffer.length > MAX_TEXT_ATTACHMENT_BYTES) return "";
  try {
    return truncateText(normalizeText(decodePlainTextAttachmentBuffer(buffer)));
  } catch {
    return "";
  }
}

async function readTextFromBufferAsync(buffer: Buffer, name: string, mimeType?: string): Promise<string> {
  if (isPdfAttachment(name, mimeType)) {
    return extractPdfText(buffer);
  }
  if (isDocxAttachment(name, mimeType)) {
    return extractDocxText(buffer);
  }
  if (isPptxAttachment(name, mimeType)) {
    return extractPptxText(buffer);
  }
  if (isXlsxAttachment(name, mimeType)) {
    return extractXlsxText(buffer);
  }
  return readTextFromBuffer(buffer, name, mimeType);
}

async function readManifest(sessionId: string): Promise<SessionAttachment[]> {
  try {
    const raw = await fs.readFile(manifestPath(sessionId), "utf-8");
    const parsed = JSON.parse(raw) as SessionAttachment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(sessionId: string, items: SessionAttachment[]) {
  const root = resolveAttachmentRoot(sessionId);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(manifestPath(sessionId), JSON.stringify(items, null, 2), "utf-8");
}

function findAttachment(items: SessionAttachment[], attachmentId: string) {
  return items.find((item) => item.id === attachmentId);
}

function buildDataUrl(mimeType: string | undefined, contentBase64: string) {
  return `data:${mimeType || "application/octet-stream"};base64,${contentBase64}`;
}

function flattenVisionReply(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: string }).text || "");
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

async function tryVisionRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  question: string,
): Promise<{ ok: boolean; text: string; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: imageDataUrl, detail: "auto" } },
          ],
        }],
        temperature: 0.2,
        max_tokens: 900,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, text: "", error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const reply = flattenVisionReply(json.choices?.[0]?.message?.content);
    if (reply) {
      visionCapabilityCache.set(`${baseUrl}::${model}`, true);
      return { ok: true, text: reply };
    }
    return { ok: false, text: "", error: "empty reply" };
  } catch (err: any) {
    return { ok: false, text: "", error: err.message };
  }
}

async function describeImageViaProvider(
  attachment: SessionAttachment,
  providerConfig: ProviderConfig,
  question?: string,
): Promise<string> {
  if (!attachment.storedPath) {
    throw new Error("图片附件尚未落盘，无法分析");
  }
  const apiKey = getApiKey(providerConfig);
  if (!apiKey) {
    throw new Error("当前未配置可用的 AI Provider API Key");
  }
  const buffer = await fs.readFile(attachment.storedPath);
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("图片过大，请压缩到 12MB 以内后重试");
  }
  const baseUrl = getBaseUrl(providerConfig).replace(/\/+$/, "");
  const imageDataUrl = buildDataUrl(attachment.mimeType, buffer.toString("base64"));
  const prompt = question?.trim() || "请详细描述这张图片中的关键信息、文字内容、界面元素，以及和 RDK 设备/开发相关的线索。";

  const currentModel = providerConfig.model || "";
  const cacheKey = `${baseUrl}::${currentModel}`;
  const modelsToTry: string[] = [];

  if (visionCapabilityCache.get(cacheKey) !== false && currentModel) {
    modelsToTry.push(currentModel);
  }
  if (VISION_HINT_PATTERNS.test(currentModel)) {
    // already added above
  } else {
    const fallback = VISION_FALLBACK_BY_PROVIDER[providerConfig.provider];
    if (fallback && fallback !== currentModel) modelsToTry.push(fallback);
  }
  if (modelsToTry.length === 0) modelsToTry.push(currentModel || "gpt-4o-mini");

  const errors: string[] = [];
  for (const model of modelsToTry) {
    const result = await tryVisionRequest(baseUrl, apiKey, model, imageDataUrl, prompt);
    if (result.ok) {
      if (model === currentModel) console.log(`[Vision] 当前模型 ${model} 支持视觉`);
      else console.log(`[Vision] 回退到 ${model} 成功`);
      return result.text;
    }
    visionCapabilityCache.set(`${baseUrl}::${model}`, false);
    errors.push(`${model}: ${result.error}`);
  }

  throw new Error(
    `图片分析失败：当前本地模型不支持图像理解（已尝试: ${modelsToTry.join(', ')}）。` +
    `你可以：1) 如果已连接设备，将图片上传到设备后委派 OpenClaw 处理（OpenClaw 的模型可能支持视觉）；` +
    `2) 在设置中切换到支持视觉的模型（如 GPT-4o、Claude Sonnet、Gemini、通义千问VL）。` +
    `\n错误详情: ${errors.join('; ')}`,
  );
}

/** 本地 whisper.cpp / WhisperDesktop 优先，失败或未配置时再走云端 ASR */
async function transcribeWithLocalWhisperOrProvider(
  attachment: SessionAttachment,
  providerConfig: ProviderConfig,
): Promise<string> {
  if (attachment.storedPath) {
    try {
      const local = await transcribeLocalWhisperFromFile(attachment.storedPath);
      if (local) {
        const text = normalizeText(local);
        if (!text) {
          throw new Error("Whisper 输出归一化后为空");
        }
        attachment.transcript = text;
        return text;
      }
    } catch (e) {
      console.warn("[Attachment] 本地 Whisper 转写失败，尝试云端 Provider", e);
    }
  }
  return transcribeAudioViaProvider(attachment, providerConfig);
}

async function transcribeAudioViaProvider(
  attachment: SessionAttachment,
  providerConfig: ProviderConfig,
): Promise<string> {
  if (!attachment.storedPath) {
    throw new Error("音频附件尚未落盘，无法转写");
  }
  const apiKey = getApiKey(providerConfig);
  if (!apiKey) {
    throw new Error("当前未配置可用的 AI Provider API Key");
  }
  const buffer = await fs.readFile(attachment.storedPath);
  if (providerConfig.provider === "qwen") {
    const resolvedBaseUrl = getBaseUrl(providerConfig).replace(/\/+$/, "");
    const baseUrl = /compatible-mode\/v1$/i.test(resolvedBaseUrl)
      ? resolvedBaseUrl
      : /dashscope-intl\.aliyuncs\.com/i.test(resolvedBaseUrl)
        ? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3-asr-flash",
        messages: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text: "请将语音准确转写为简体中文，保留英文术语、命令、文件路径和产品名，不要补充解释。",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: buildDataUrl(attachment.mimeType || "audio/webm", buffer.toString("base64")),
                },
              },
            ],
          },
        ],
        stream: false,
        temperature: 0,
        asr_options: {
          language: "zh",
          enable_itn: false,
        },
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    if (!res.ok) {
      throw new Error(
        payload.error?.message || asrUpstreamErrorMessage(res.status, `语音转写失败 (${res.status})`),
      );
    }
    const text = normalizeText(flattenVisionReply(payload.choices?.[0]?.message?.content));
    if (!text) {
      throw new Error("语音转写返回为空");
    }
    attachment.transcript = text;
    return text;
  }

  const model = resolveTranscriptionModel(providerConfig);
  if (!model) {
    throw new Error("当前 Provider 未配置可用的语音转写模型");
  }
  const baseUrl = getBaseUrl(providerConfig).replace(/\/+$/, "");
  const form = new FormData();
  form.append("model", model);
  form.append("language", "zh");
  form.append("response_format", "json");
  form.append("file", new Blob([buffer], { type: attachment.mimeType || "audio/webm" }), attachment.name);

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const payload = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      payload.error?.message || asrUpstreamErrorMessage(res.status, `语音转写失败 (${res.status})`),
    );
  }
  const text = normalizeText(String(payload.text || ""));
  if (!text) {
    throw new Error("语音转写返回为空");
  }
  attachment.transcript = text;
  return text;
}

/** 临时落盘后：优先本地 whisper.cpp / WhisperDesktop，否则 Studio Provider 云端转写（Dock 停录后出字） */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  name: string,
  mimeType: string | undefined,
  providerConfig: ProviderConfig | null,
): Promise<string> {
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`音频过大，请控制在 ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB 以内`);
  }
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rdk-stt-"));
  const safeFilename = sanitizeSegment(name) || "voice.webm";
  const tmpPath = path.join(tmpRoot, safeFilename);
  await fs.writeFile(tmpPath, buffer);
  const attachment: SessionAttachment = {
    id: `stt-${Date.now()}`,
    type: "audio",
    name: normalizeName(name, "audio"),
    mimeType,
    size: buffer.length,
    storedPath: tmpPath,
    createdAt: Date.now(),
  };
  try {
    try {
      const local = await transcribeLocalWhisperFromFile(tmpPath);
      if (local) {
        const text = normalizeText(local);
        if (!text) {
          throw new Error("Whisper 输出归一化后为空");
        }
        attachment.transcript = text;
        return text;
      }
    } catch (e) {
      console.warn("[transcribeAudioBuffer] 本地 Whisper 失败，尝试云端 Provider", e);
    }
    if (!providerConfig) {
      throw new Error(
        "未配置本地 whisper（RDK_STUDIO_WHISPER_CPP + 模型）或 Whisper Desktop（RDK_STUDIO_WHISPER_MAIN），且未配置 Studio AI Provider，无法转写",
      );
    }
    if (!isStudioProviderAsrSupported(providerConfig)) {
      throw new Error(
        "本机 whisper 未成功完成转写，且当前 Studio 对话渠道（如部分豆包路由）不提供语音转写 API。" +
          "请配置本机 whisper.cpp：设置 RDK_STUDIO_WHISPER_CPP 为 whisper-cli 路径、RDK_STUDIO_WHISPER_CPP_MODEL 为 ggml 模型，并安装 ffmpeg；无需外网。",
      );
    }
    return await transcribeAudioViaProvider(attachment, providerConfig);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function prepareSessionAttachments(
  sessionId: string,
  attachments: ChatAttachmentInput[] | undefined,
): Promise<PreparedAttachmentState> {
  const existing = await readManifest(sessionId);
  if (!attachments || attachments.length === 0) {
    return { allAttachments: existing, newAttachments: [] };
  }

  const root = resolveAttachmentRoot(sessionId);
  await fs.mkdir(root, { recursive: true });

  const next = [...existing];
  const newAttachments: SessionAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment?.id) continue;
    if (findAttachment(next, attachment.id)) continue;
    const name = normalizeName(attachment.name, attachment.type);
    const candidate: SessionAttachment = {
      id: attachment.id,
      type: attachment.type,
      name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: Date.now(),
      transcript: attachment.transcript?.trim() || undefined,
      textContent: attachment.textContent?.trim() || undefined,
      source: attachment.source,
    };

    if (attachment.storedPath) {
      candidate.storedPath = attachment.storedPath;
      if (!candidate.textContent && candidate.type !== "video") {
        try {
          const buffer = await fs.readFile(attachment.storedPath);
          const extracted = await readTextFromBufferAsync(buffer, name, attachment.mimeType);
          candidate.textContent = extracted || undefined;
        } catch { /* file read failed, skip text extraction */ }
      }
    } else if (attachment.contentBase64) {
      const buffer = Buffer.from(attachment.contentBase64, "base64");
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`附件 ${name} 过大，请控制在 ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB 以内`);
      }
      const fileName = `${Date.now()}-${sanitizeSegment(name)}`;
      const storedPath = path.join(root, fileName);
      await fs.writeFile(storedPath, buffer);
      candidate.storedPath = storedPath;
      if (!candidate.textContent) {
        const extracted = await readTextFromBufferAsync(buffer, name, attachment.mimeType);
        candidate.textContent = extracted || undefined;
      }
    }

    next.push(candidate);
    newAttachments.push(candidate);
  }

  await writeManifest(sessionId, next);
  return { allAttachments: next, newAttachments };
}

export function buildAttachmentPrompt(newAttachments: SessionAttachment[]): string {
  if (newAttachments.length === 0) return "";
  const lines = newAttachments.map((attachment) => {
    const parts = [
      `[${attachment.id}]`,
      `${attachment.type}`,
      attachment.name,
      attachment.mimeType ? `mime=${attachment.mimeType}` : "",
      typeof attachment.size === "number" ? `size=${attachment.size}B` : "",
    ].filter(Boolean);
    const extras: string[] = [];
    if (attachment.transcript) {
      extras.push(`转写: ${truncateText(attachment.transcript, 160)}`);
    }
    if (attachment.textContent && attachment.type !== "audio") {
      extras.push(`文本摘录: ${truncateText(attachment.textContent, 220)}`);
    }
    if (attachment.type === "image") {
      extras.push("请先调用 attachment_describe_image 分析此图片；如果本地模型不支持视觉且已连接设备，可将图片上传到设备后让 OpenClaw 尝试");
    }
    if (attachment.type === "audio" && !attachment.transcript) {
      extras.push("当前未附带转写，可先调用 attachment_get_audio_transcript 查看是否已有转写");
    }
    return `- ${parts.join(" | ")}${extras.length ? `\n  ${extras.join("\n  ")}` : ""}`;
  });

  const hasImages = newAttachments.some((a: SessionAttachment) => a.type === "image");
  const hasPdf = newAttachments.some((a: SessionAttachment) => isPdfAttachment(a.name, a.mimeType));
  const hasOfficeDoc = newAttachments.some((a: SessionAttachment) => isOfficeDocAttachment(a.name, a.mimeType));
  const footer = [
    "可用工具：attachment_list / attachment_read / attachment_describe_image / attachment_get_audio_transcript。",
    hasImages ? "注意：用户上传了图片，你必须先调用 attachment_describe_image 理解图片内容后再回复。" : "",
    hasPdf ? "注意：PDF 内容已自动提取，可通过 attachment_read 读取完整文本。" : "",
    hasOfficeDoc ? "注意：Office 文档（Word/PPT/Excel）内容已自动提取文本，可通过 attachment_read 读取。" : "",
  ].filter(Boolean).join("\n");

  return [
    "以下是本条消息新上传的附件：",
    ...lines,
    footer,
  ].join("\n");
}

export async function ensureAudioAttachmentTranscripts(
  sessionId: string,
  attachments: SessionAttachment[],
  providerConfig: ProviderConfig,
  attachmentIds?: string[],
): Promise<void> {
  if (attachments.length === 0) return;
  const allowedIds = attachmentIds && attachmentIds.length > 0 ? new Set(attachmentIds) : null;
  let changed = false;
  for (const attachment of attachments) {
    if (attachment.type !== "audio" || attachment.transcript || !attachment.storedPath) continue;
    if (allowedIds && !allowedIds.has(attachment.id)) continue;
    try {
      await transcribeWithLocalWhisperOrProvider(attachment, providerConfig);
      changed = true;
    } catch {
      // 语音转写失败时保持静默降级，由 attachment_get_audio_transcript 工具继续兜底
    }
  }
  if (changed) {
    await writeManifest(sessionId, attachments);
  }
}

const DOWNLOADABLE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const DOWNLOADABLE_VIDEO_EXTS = new Set([".mp4", ".webm", ".avi", ".mov", ".mkv"]);

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".mp4": "video/mp4", ".webm": "video/webm", ".avi": "video/x-msvideo",
    ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  };
  return map[ext] || "application/octet-stream";
}

export async function registerToolDownloadedAttachment(
  sessionId: string,
  allAttachments: SessionAttachment[],
  info: { localPath: string; fileName: string; bytes?: number },
): Promise<SessionAttachment | null> {
  const ext = path.extname(info.fileName).toLowerCase();
  let type: SessionAttachment["type"];
  if (DOWNLOADABLE_IMAGE_EXTS.has(ext)) {
    type = "image";
  } else if (DOWNLOADABLE_VIDEO_EXTS.has(ext)) {
    type = "video";
  } else {
    return null;
  }
  const existing = allAttachments.find((a) => a.storedPath === info.localPath);
  if (existing) return existing;
  const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attachment: SessionAttachment = {
    id,
    type,
    name: info.fileName,
    mimeType: mimeFromExt(ext),
    size: info.bytes,
    storedPath: info.localPath,
    createdAt: Date.now(),
    source: "studio",
  };
  allAttachments.push(attachment);
  await writeManifest(sessionId, allAttachments);
  console.log(`[Attachment] 自动注册设备下载${type === "image" ? "图片" : "视频"}: ${info.fileName} (id=${id})`);
  return attachment;
}

export function createAttachmentTools(
  attachments: SessionAttachment[],
  providerConfig: ProviderConfig,
  sessionId?: string,
): Tool[] {
  if (attachments.length === 0) return [];

  const listTool: Tool<{ type?: string }> = {
    name: "attachment_list",
    description: "列出当前会话可用的附件。处理图片、文件、音频前先用它确认附件 ID、类型和可读信息。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "可选过滤：image/file/audio/video" },
      },
    },
    async execute(input) {
      const expectedType = String(input.type || "").trim();
      const rows = attachments
        .filter((attachment) => !expectedType || attachment.type === expectedType)
        .map((attachment) => {
          const flags = [
            attachment.textContent ? "text" : "",
            attachment.transcript ? "transcript" : "",
            attachment.storedPath ? "stored" : "",
          ].filter(Boolean);
          return `${attachment.id} | ${attachment.type} | ${attachment.name}${flags.length ? ` | ${flags.join(",")}` : ""}`;
        });
      return rows.length > 0 ? rows.join("\n") : "当前没有匹配的附件。";
    },
  };

  const readTool: Tool<{ attachmentId: string; maxChars?: number }> = {
    name: "attachment_read",
    description:
      "读取文本类附件或已转写的语音内容。适合代码、日志、配置、Markdown、CSV 等文本附件。服务端会自动识别 UTF-8（含 BOM）/UTF-16/GB18030（兼容 Windows 记事本 GBK 保存的中文 txt），避免乱码。",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: { type: "string", description: "attachment_list 返回的附件 ID" },
        maxChars: { type: "number", description: "最多返回字符数，默认 8000" },
      },
      required: ["attachmentId"],
    },
    async execute(input) {
      const attachment = findAttachment(attachments, String(input.attachmentId || ""));
      if (!attachment) throw new Error("附件不存在");
      const maxChars = Math.max(500, Math.min(30_000, Number(input.maxChars || 8_000)));
      if (attachment.transcript) {
        return truncateText(`语音转写 (${attachment.name}):\n${attachment.transcript}`, maxChars);
      }
      if (attachment.textContent) {
        return truncateText(`附件内容 (${attachment.name}):\n${attachment.textContent}`, maxChars);
      }
      if (!attachment.storedPath) {
        throw new Error("该附件当前没有可读取的文本内容");
      }
      const buffer = await fs.readFile(attachment.storedPath);
      const text = await readTextFromBufferAsync(buffer, attachment.name, attachment.mimeType);
      if (!text) {
        throw new Error("该附件不是可直接读取的文本文件，请改用其它工具或结合上下文处理");
      }
      return truncateText(`附件内容 (${attachment.name}):\n${text}`, maxChars);
    },
  };

  const describeImageTool: Tool<{ attachmentId: string; question?: string }> = {
    name: "attachment_describe_image",
    description: "分析图片附件内容，识别界面、文字、图表、截图、照片中的关键信息。",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: { type: "string", description: "图片附件 ID" },
        question: { type: "string", description: "可选，告诉模型重点关注什么" },
      },
      required: ["attachmentId"],
    },
    async execute(input) {
      const attachment = findAttachment(attachments, String(input.attachmentId || ""));
      if (!attachment) throw new Error("附件不存在");
      if (attachment.type !== "image") {
        throw new Error("该附件不是图片，不能用 attachment_describe_image");
      }
      const description = await describeImageViaProvider(attachment, providerConfig, input.question);
      return `图片分析 (${attachment.name}):\n${description}`;
    },
  };

  const audioTranscriptTool: Tool<{ attachmentId: string }> = {
    name: "attachment_get_audio_transcript",
    description: "读取音频附件的现有转写结果。适用于浏览器录音、飞书语音等场景。",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: { type: "string", description: "音频附件 ID" },
      },
      required: ["attachmentId"],
    },
    async execute(input) {
      const attachment = findAttachment(attachments, String(input.attachmentId || ""));
      if (!attachment) throw new Error("附件不存在");
      if (attachment.type !== "audio") {
        throw new Error("该附件不是音频，不能读取语音转写");
      }
      if (!attachment.transcript) {
        try {
          attachment.transcript = await transcribeWithLocalWhisperOrProvider(attachment, providerConfig);
          if (sessionId) {
            await writeManifest(sessionId, attachments);
          }
        } catch (error) {
          return `音频附件 ${attachment.name} 当前没有可用转写。${error instanceof Error ? error.message : "转写失败"}。若来自 Studio 浏览器录音，请确认浏览器支持语音识别。`;
        }
      }
      return `音频转写 (${attachment.name}):\n${attachment.transcript}`;
    },
  };

  return [listTool, readTool, describeImageTool, audioTranscriptTool];
}
