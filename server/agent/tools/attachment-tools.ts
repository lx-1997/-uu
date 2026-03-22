import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getApiKey, getBaseUrl, type ProviderConfig } from "../provider-setup.js";
import type { Tool } from "./types.js";

export interface ChatAttachmentInput {
  id: string;
  type: "image" | "file" | "audio" | "video";
  name: string;
  mimeType?: string;
  size?: number;
  contentBase64?: string;
  transcript?: string;
  textContent?: string;
  source?: "studio" | "feishu";
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
  source?: "studio" | "feishu";
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
]);

const VISION_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: "gpt-4o-mini",
  "openai-compatible": "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  qwen: "qwen-vl-max-latest",
  zhipu: "glm-4v-flash",
  xai: "grok-2-vision-1212",
};

const AUDIO_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: "gpt-4o-mini-transcribe",
  "openai-compatible": "gpt-4o-mini-transcribe",
  groq: "whisper-large-v3-turbo",
};

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

function readTextFromBuffer(buffer: Buffer, name: string, mimeType?: string) {
  if (!isTextLikeAttachment(name, mimeType) || buffer.length > MAX_TEXT_ATTACHMENT_BYTES) return "";
  try {
    return truncateText(normalizeText(buffer.toString("utf-8")));
  } catch {
    return "";
  }
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

function resolveVisionModel(config: ProviderConfig) {
  if (config.model && /vision|vl|4v|4o|grok-2/i.test(config.model)) {
    return config.model;
  }
  return VISION_MODEL_BY_PROVIDER[config.provider] || config.model || "gpt-4o-mini";
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
  const model = resolveVisionModel(providerConfig);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: question?.trim() || "请详细描述这张图片中的关键信息、文字内容、界面元素，以及和 RDK 设备/开发相关的线索。",
            },
            {
              type: "image_url",
              image_url: {
                url: buildDataUrl(attachment.mimeType, buffer.toString("base64")),
                detail: "auto",
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 900,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (!res.ok) {
    throw new Error(payload.error?.message || `视觉分析失败 (${res.status})`);
  }
  const text = flattenVisionReply(payload.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error("视觉分析返回为空");
  }
  return text;
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
      throw new Error(payload.error?.message || `语音转写失败 (${res.status})`);
    }
    const text = normalizeText(flattenVisionReply(payload.choices?.[0]?.message?.content));
    if (!text) {
      throw new Error("语音转写返回为空");
    }
    attachment.transcript = text;
    return text;
  }

  const model = AUDIO_MODEL_BY_PROVIDER[providerConfig.provider];
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
    throw new Error(payload.error?.message || `语音转写失败 (${res.status})`);
  }
  const text = normalizeText(String(payload.text || ""));
  if (!text) {
    throw new Error("语音转写返回为空");
  }
  attachment.transcript = text;
  return text;
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

    if (attachment.contentBase64) {
      const buffer = Buffer.from(attachment.contentBase64, "base64");
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`附件 ${name} 过大，请控制在 ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB 以内`);
      }
      const fileName = `${Date.now()}-${sanitizeSegment(name)}`;
      const storedPath = path.join(root, fileName);
      await fs.writeFile(storedPath, buffer);
      candidate.storedPath = storedPath;
      if (!candidate.textContent) {
        candidate.textContent = readTextFromBuffer(buffer, name, attachment.mimeType) || undefined;
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
      extras.push("如需理解图片内容，请调用 attachment_describe_image");
    }
    if (attachment.type === "audio" && !attachment.transcript) {
      extras.push("当前未附带转写，可先调用 attachment_get_audio_transcript 查看是否已有转写");
    }
    return `- ${parts.join(" | ")}${extras.length ? `\n  ${extras.join("\n  ")}` : ""}`;
  });

  return [
    "以下是本条消息新上传的附件：",
    ...lines,
    "可用工具：attachment_list / attachment_read / attachment_describe_image / attachment_get_audio_transcript。",
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
      await transcribeAudioViaProvider(attachment, providerConfig);
      changed = true;
    } catch {
      // 语音转写失败时保持静默降级，由 attachment_get_audio_transcript 工具继续兜底
    }
  }
  if (changed) {
    await writeManifest(sessionId, attachments);
  }
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
    description: "读取文本类附件或已转写的语音内容。适合代码、日志、配置、Markdown、CSV 等文本附件。",
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
      const text = readTextFromBuffer(buffer, attachment.name, attachment.mimeType);
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
          attachment.transcript = await transcribeAudioViaProvider(attachment, providerConfig);
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
