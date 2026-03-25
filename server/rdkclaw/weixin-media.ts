import crypto from "node:crypto";
import { decode as silkDecode, isSilk } from "silk-wasm";
import type { WeixinApiClient, CdnMedia, WeixinMessageItem } from "./weixin-api-client.js";
import type { RDKClawAttachment } from "./types.js";

const SAMPLE_RATE = 24000;

function genId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export async function silkToWav(silkBuf: Buffer): Promise<Buffer> {
  const output = await silkDecode(silkBuf, SAMPLE_RATE);
  return pcmToWav(Buffer.from(output.data), SAMPLE_RATE);
}

export async function downloadVoiceAsWav(client: WeixinApiClient, cdnMedia: CdnMedia): Promise<Buffer> {
  const raw = await client.downloadMedia(cdnMedia);
  if (isSilk(raw)) {
    return silkToWav(raw);
  }
  return raw;
}

export async function downloadImageAsBuffer(client: WeixinApiClient, cdnMedia: CdnMedia): Promise<Buffer> {
  return client.downloadMedia(cdnMedia);
}

export async function extractAttachments(
  client: WeixinApiClient,
  items: WeixinMessageItem[] | undefined,
): Promise<{ text: string; attachments: RDKClawAttachment[] }> {
  if (!items) return { text: "", attachments: [] };

  const textParts: string[] = [];
  const attachments: RDKClawAttachment[] = [];

  for (const item of items) {
    switch (item.type) {
      case 1:
        if (item.text_item?.text) textParts.push(item.text_item.text);
        break;

      case 2: {
        const cdn = item.image_item?.cdn_media;
        if (cdn?.encrypt_query_param && cdn.aes_key) {
          try {
            const buf = await downloadImageAsBuffer(client, cdn);
            attachments.push({
              id: genId(),
              type: "image",
              name: `weixin-image-${Date.now()}.jpg`,
              mimeType: "image/jpeg",
              size: buf.length,
              contentBase64: buf.toString("base64"),
              source: "weixin",
            });
          } catch (err) {
            console.warn("[WeixinMedia] image download failed:", (err as Error).message);
            textParts.push("[图片-下载失败]");
          }
        } else {
          textParts.push("[图片]");
        }
        break;
      }

      case 3: {
        const cdn = item.voice_item?.cdn_media;
        if (cdn?.encrypt_query_param && cdn.aes_key) {
          try {
            const wav = await downloadVoiceAsWav(client, cdn);
            attachments.push({
              id: genId(),
              type: "audio",
              name: `weixin-voice-${Date.now()}.wav`,
              mimeType: "audio/wav",
              size: wav.length,
              contentBase64: wav.toString("base64"),
              source: "weixin",
            });
          } catch (err) {
            console.warn("[WeixinMedia] voice download failed:", (err as Error).message);
            textParts.push("[语音-下载失败]");
          }
        } else {
          textParts.push("[语音]");
        }
        break;
      }

      case 4: {
        const fileName = item.file_item?.file_name || "文件";
        const fileCdn = item.file_item?.cdn_media;
        if (fileCdn?.encrypt_query_param && fileCdn.aes_key) {
          try {
            const buf = await client.downloadMedia(fileCdn);
            const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
            const mime = ext === "pdf" ? "application/pdf"
              : ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : ext === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : ext === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
              : ext === "zip" ? "application/zip"
              : "application/octet-stream";
            attachments.push({
              id: genId(),
              type: "file",
              name: `weixin-file-${Date.now()}-${fileName}`,
              mimeType: mime,
              size: buf.length,
              contentBase64: buf.toString("base64"),
              source: "weixin",
            });
          } catch (err) {
            console.warn("[WeixinMedia] file download failed:", (err as Error).message);
            textParts.push(`[文件-下载失败] ${fileName}`);
          }
        } else {
          textParts.push(`[文件] ${fileName}`);
        }
        break;
      }

      case 5: {
        const videoCdn = item.video_item?.cdn_media;
        if (videoCdn?.encrypt_query_param && videoCdn.aes_key) {
          try {
            const buf = await client.downloadMedia(videoCdn);
            attachments.push({
              id: genId(),
              type: "video",
              name: `weixin-video-${Date.now()}.mp4`,
              mimeType: "video/mp4",
              size: buf.length,
              contentBase64: buf.toString("base64"),
              source: "weixin",
            });
          } catch (err) {
            console.warn("[WeixinMedia] video download failed:", (err as Error).message);
            textParts.push("[视频-下载失败]");
          }
        } else {
          textParts.push("[视频]");
        }
        break;
      }
    }
  }

  return { text: textParts.join(" ").trim(), attachments };
}
