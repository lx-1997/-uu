import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FeishuRuntimeConfig {
  enabled: boolean;
  connectionMode: "websocket" | "webhook";
  domain: "feishu" | "lark";
  dmPolicy: "pairing" | "allowlist" | "open";
  syncWithStudio: boolean;
  mirrorToStudioChat: boolean;
  ackOnReceive: boolean;
  ackOnRunning: boolean;
  ackStyle: "text" | "emoji" | "off";
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const CONFIG_FILE = path.join(CONFIG_DIR, "feishu-config.json");

const DEFAULT_CONFIG: FeishuRuntimeConfig = {
  enabled: true,
  connectionMode: "websocket",
  domain: (String(process.env.FEISHU_DOMAIN || "feishu").toLowerCase() === "lark" ? "lark" : "feishu"),
  dmPolicy: "pairing",
  syncWithStudio: true,
  mirrorToStudioChat: true,
  ackOnReceive: true,
  ackOnRunning: true,
  ackStyle: "text",
  appId: String(process.env.FEISHU_APP_ID || ""),
  appSecret: String(process.env.FEISHU_APP_SECRET || ""),
  verificationToken: String(process.env.FEISHU_VERIFICATION_TOKEN || ""),
  encryptKey: String(process.env.FEISHU_ENCRYPT_KEY || ""),
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export class FeishuConfigStore {
  getConfig(): FeishuRuntimeConfig {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<FeishuRuntimeConfig>;
      return {
        ...DEFAULT_CONFIG,
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
        connectionMode: parsed.connectionMode === "webhook" ? "webhook" : "websocket",
        domain: parsed.domain === "lark" ? "lark" : "feishu",
        dmPolicy: parsed.dmPolicy === "allowlist" || parsed.dmPolicy === "open" ? parsed.dmPolicy : "pairing",
        syncWithStudio: typeof parsed.syncWithStudio === "boolean" ? parsed.syncWithStudio : DEFAULT_CONFIG.syncWithStudio,
        mirrorToStudioChat: typeof parsed.mirrorToStudioChat === "boolean" ? parsed.mirrorToStudioChat : DEFAULT_CONFIG.mirrorToStudioChat,
        ackOnReceive: typeof parsed.ackOnReceive === "boolean" ? parsed.ackOnReceive : DEFAULT_CONFIG.ackOnReceive,
        ackOnRunning: typeof parsed.ackOnRunning === "boolean" ? parsed.ackOnRunning : DEFAULT_CONFIG.ackOnRunning,
        ackStyle: parsed.ackStyle === "emoji" || parsed.ackStyle === "off" ? parsed.ackStyle : "text",
        appId: String(parsed.appId ?? DEFAULT_CONFIG.appId),
        appSecret: String(parsed.appSecret ?? DEFAULT_CONFIG.appSecret),
        verificationToken: String(parsed.verificationToken ?? DEFAULT_CONFIG.verificationToken),
        encryptKey: String(parsed.encryptKey ?? DEFAULT_CONFIG.encryptKey),
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  saveConfig(patch: Partial<FeishuRuntimeConfig>): FeishuRuntimeConfig {
    const prev = this.getConfig();
    const next: FeishuRuntimeConfig = {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : prev.enabled,
      connectionMode: patch.connectionMode === "webhook" ? "webhook" : (patch.connectionMode === "websocket" ? "websocket" : prev.connectionMode),
      domain: patch.domain === "lark" ? "lark" : (patch.domain === "feishu" ? "feishu" : prev.domain),
      dmPolicy: patch.dmPolicy === "allowlist" || patch.dmPolicy === "open" || patch.dmPolicy === "pairing" ? patch.dmPolicy : prev.dmPolicy,
      syncWithStudio: typeof patch.syncWithStudio === "boolean" ? patch.syncWithStudio : prev.syncWithStudio,
      mirrorToStudioChat: typeof patch.mirrorToStudioChat === "boolean" ? patch.mirrorToStudioChat : prev.mirrorToStudioChat,
      ackOnReceive: typeof patch.ackOnReceive === "boolean" ? patch.ackOnReceive : prev.ackOnReceive,
      ackOnRunning: typeof patch.ackOnRunning === "boolean" ? patch.ackOnRunning : prev.ackOnRunning,
      ackStyle: patch.ackStyle === "emoji" || patch.ackStyle === "off" || patch.ackStyle === "text" ? patch.ackStyle : prev.ackStyle,
      appId: String(patch.appId ?? prev.appId).trim(),
      appSecret: String(patch.appSecret ?? prev.appSecret).trim(),
      verificationToken: String(patch.verificationToken ?? prev.verificationToken).trim(),
      encryptKey: String(patch.encryptKey ?? prev.encryptKey).trim(),
    };
    ensureDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }
}

