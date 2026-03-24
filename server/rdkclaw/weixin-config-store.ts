import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WeixinRuntimeConfig {
  enabled: boolean;
  syncWithStudio: boolean;
  mirrorToStudioChat: boolean;
  ackOnReceive: boolean;
  ackStyle: "text" | "emoji" | "off";
}

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const CONFIG_FILE = path.join(CONFIG_DIR, "weixin-config.json");

const DEFAULT_CONFIG: WeixinRuntimeConfig = {
  enabled: true,
  syncWithStudio: true,
  mirrorToStudioChat: true,
  ackOnReceive: true,
  ackStyle: "text",
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export class WeixinConfigStore {
  getConfig(): WeixinRuntimeConfig {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<WeixinRuntimeConfig>;
      return {
        ...DEFAULT_CONFIG,
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
        syncWithStudio: typeof parsed.syncWithStudio === "boolean" ? parsed.syncWithStudio : DEFAULT_CONFIG.syncWithStudio,
        mirrorToStudioChat: typeof parsed.mirrorToStudioChat === "boolean" ? parsed.mirrorToStudioChat : DEFAULT_CONFIG.mirrorToStudioChat,
        ackOnReceive: typeof parsed.ackOnReceive === "boolean" ? parsed.ackOnReceive : DEFAULT_CONFIG.ackOnReceive,
        ackStyle: parsed.ackStyle === "emoji" || parsed.ackStyle === "off" ? parsed.ackStyle : "text",
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  saveConfig(patch: Partial<WeixinRuntimeConfig>): WeixinRuntimeConfig {
    const prev = this.getConfig();
    const next: WeixinRuntimeConfig = {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : prev.enabled,
      syncWithStudio: typeof patch.syncWithStudio === "boolean" ? patch.syncWithStudio : prev.syncWithStudio,
      mirrorToStudioChat: typeof patch.mirrorToStudioChat === "boolean" ? patch.mirrorToStudioChat : prev.mirrorToStudioChat,
      ackOnReceive: typeof patch.ackOnReceive === "boolean" ? patch.ackOnReceive : prev.ackOnReceive,
      ackStyle: patch.ackStyle === "emoji" || patch.ackStyle === "off" || patch.ackStyle === "text" ? patch.ackStyle : prev.ackStyle,
    };
    ensureDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }
}
