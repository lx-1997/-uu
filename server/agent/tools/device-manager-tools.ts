import type { Tool, ToolContext } from "./types.js";
import type { Device } from "../../../shared/types.js";
import { readDevices, writeDevices, serializedWriteDevices } from "../../storage.js";
import { setDevicePasswordCache, deleteDevicePasswordCache } from "../../device-password-cache.js";
import { buildSshPasswordCandidatesForDevice } from "../../device-ssh-credentials.js";
import { verifySshConnection } from "../../ssh.js";
import { v4 as uuid } from "uuid";
import * as net from "node:net";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import { getAgentMediaDownloadDir } from "../../local-files-roots.js";
import { DEFAULT_SSH_PASSWORD, DEFAULT_SSH_USERNAME } from "../../constants.js";

const DEFAULT_SSH_USER = DEFAULT_SSH_USERNAME;
const SCAN_PORT = 22;
const SCAN_TIMEOUT_MS = 1500;

/** 与 `/api/devices/:id/ping` 一致：短握手超时，避免关机设备拖死列表 */
const DEVICE_LIST_SSH_PROBE_MS = 8_000;

async function probeSshReachable(device: Device): Promise<"reachable" | "unreachable" | "no_credentials"> {
  const candidates = buildSshPasswordCandidatesForDevice(device);
  if (candidates.length === 0) return "no_credentials";
  for (const password of candidates) {
    try {
      await verifySshConnection(
        {
          host: device.host,
          port: device.port ?? 22,
          username: device.username,
          password,
        },
        { readyTimeoutMs: DEVICE_LIST_SSH_PROBE_MS },
      );
      setDevicePasswordCache(device.host, device.username, device.port ?? 22, password);
      return "reachable";
    } catch {
      /* try next */
    }
  }
  return "unreachable";
}

function getLocalSubnets(): string[] {
  const nets = networkInterfaces();
  const subnets: string[] = [];
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const parts = iface.address.split(".");
        subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
  }
  return [...new Set(subnets)];
}

function scanHost(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket
      .once("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      })
      .once("error", () => {
        clearTimeout(timer);
        resolve(false);
      })
      .connect(port, ip);
  });
}

export const deviceListTool: Tool<Record<string, never>> = {
  name: "device_list_all",
  description:
    "列出 RDK Studio 中所有已添加的设备。**会对每台设备做一次快速 SSH 握手探测**（与侧栏「在线」逻辑一致），并同时给出库内记录状态。" +
    "库内 `connected` 只表示曾成功保存凭据，**不等于**当前网络一定能执行 device_exec；若探测为不可达，应先让用户在设备管理中重新连接或检查网络。无需参数。",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    const devices = await readDevices();
    if (devices.length === 0) {
      return "当前没有已添加的设备。可以用 device_scan_network 扫描局域网，或用 device_connect_ssh 直接连接。";
    }
    const lines: string[] = [];
    for (const d of devices) {
      const live = await probeSshReachable(d as Device);
      const liveLabel =
        live === "reachable"
          ? "当前SSH:可达"
          : live === "unreachable"
            ? "当前SSH:不可达（无法握手/认证，device_exec 可能无输出）"
            : "当前SSH:无可用凭据";
      const checked = (d as Device).lastCheckedAt ? ` 上次验证: ${(d as Device).lastCheckedAt}` : "";
      lines.push(
        `• ${d.host}:${d.port ?? 22} (${d.username}) — 库内:${d.status} | ${liveLabel}${checked} [id: ${d.id}]`,
      );
    }
    const footer =
      "\n\n说明：`库内:connected` 来自上次成功保存的凭据；「当前SSH」为本轮探测结果。" +
      "若侧栏已显示离线但此处库内仍为 connected，属正常现象——请以「当前SSH」为准安排 device_exec，或让用户重新连接设备。";
    return `已添加 ${devices.length} 台设备:\n${lines.join("\n")}${footer}`;
  },
};

export const deviceScanTool: Tool<{ subnet?: string }> = {
  name: "device_scan_network",
  description: "扫描局域网中开放 SSH(22) 端口的设备，通常是 RDK 开发者套件。可选指定子网前缀（如 192.168.1），不填则自动检测本机子网。",
  inputSchema: {
    type: "object",
    properties: {
      subnet: { type: "string", description: "子网前缀，如 192.168.1（可选）" },
    },
  },
  async execute(input) {
    const subnets = input.subnet ? [input.subnet] : getLocalSubnets();
    if (subnets.length === 0) {
      return "未检测到本机局域网接口，无法扫描。请手动提供设备 IP。";
    }

    const allIps: string[] = [];
    for (const subnet of subnets) {
      for (let i = 1; i <= 254; i++) {
        allIps.push(`${subnet}.${i}`);
      }
    }

    const BATCH = 50;
    const found: string[] = [];
    for (let i = 0; i < allIps.length; i += BATCH) {
      const batch = allIps.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (ip) => ({ ip, open: await scanHost(ip, SCAN_PORT, SCAN_TIMEOUT_MS) })),
      );
      for (const r of results) {
        if (r.open) found.push(r.ip);
      }
    }

    if (found.length === 0) {
      return `扫描了 ${subnets.join(", ")} 子网（${allIps.length} 个地址），未发现开放 SSH 端口的设备。请确认设备已开机并接入同一网络。`;
    }

    const existing = await readDevices();
    const existingHosts = new Set(existing.map((d) => d.host));
    const lines = found.map((ip) => {
      const tag = existingHosts.has(ip) ? " (已添加)" : " (新发现)";
      return `• ${ip}${tag}`;
    });

    return `发现 ${found.length} 台设备:\n${lines.join("\n")}\n\n可用 device_connect_ssh 连接；用户名默认 root；未传 password 时会依次尝试环境变量 RDK_SSH_PASSWORD（若设置）与默认口令 root。`;
  },
};

export const deviceConnectTool: Tool<{
  host: string;
  username?: string;
  password?: string;
  port?: number;
}> = {
  name: "device_connect_ssh",
  description:
    "通过 SSH 连接一台新的 RDK 设备并添加到 Studio。必填 host；username 默认 root。password 与设备一致；若省略 password，则依次尝试 RDK_SSH_PASSWORD（若设置）与默认口令 root（产品默认）。连接成功后会刷新本会话的套件端工具列表。",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "设备 IP 地址，如 192.168.1.100" },
      username: { type: "string", description: "SSH 用户名（默认 root）" },
      password: { type: "string", description: "SSH 密码（与设备一致；省略时先 RDK_SSH_PASSWORD 再默认 root）" },
      port: { type: "number", description: "SSH 端口（默认 22）" },
    },
    required: ["host"],
  },
  async execute(input, ctx: ToolContext) {
    const host = input.host.trim();
    const port = input.port ?? 22;
    const username = input.username?.trim() || DEFAULT_SSH_USER;
    const envPwd = process.env.RDK_SSH_PASSWORD?.trim() || "";
    let passwords: string[];
    if (input.password?.trim()) {
      passwords = [input.password.trim()];
    } else {
      passwords = [];
      if (envPwd) passwords.push(envPwd);
      if (!passwords.includes(DEFAULT_SSH_PASSWORD)) passwords.push(DEFAULT_SSH_PASSWORD);
    }

    let connectedPassword = "";
    let lastError = "";

    for (const pwd of passwords) {
      try {
        await verifySshConnection({ host, port, username, password: pwd });
        connectedPassword = pwd;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!connectedPassword) {
      return `SSH 连接失败: ${lastError}\n请检查 IP、端口、用户名与密码是否与设备一致。`;
    }

    let device: {
      id: string;
      host: string;
      port: number;
      username: string;
      password: string;
      status: "connected";
      lastCheckedAt: string;
    };
    await serializedWriteDevices(async () => {
      const devices = await readDevices();
      const now = new Date().toISOString();
      const existingId = devices.find(
        (d) => d.host === host && (d.port ?? 22) === port && d.username === username,
      )?.id;

      device = {
        id: existingId ?? uuid(),
        host,
        port,
        username,
        password: connectedPassword,
        status: "connected",
        lastCheckedAt: now,
      };

      const nextDevices = [
        device,
        ...devices.filter(
          (d) => !(d.host === host && (d.port ?? 22) === port && d.username === username),
        ),
      ];
      await writeDevices(nextDevices);
    });
    setDevicePasswordCache(host, username, port, connectedPassword);
    ctx.onStudioDeviceBound?.(device!.id);

    return `设备连接成功!\n• IP: ${host}:${port}\n• 用户: ${username}\n• 设备ID: ${device!.id}\n• 状态: connected\n\n说明：已保存凭据并尝试刷新本会话工具列表（含套件端工具）。若模型仍看不到 device_exec，请再发一条短消息。`;
  },
};

export const deviceRemoveTool: Tool<{ deviceId?: string; host?: string }> = {
  name: "device_remove",
  description: "移除一台已添加的设备。可以通过设备 ID 或 IP 地址指定。",
  inputSchema: {
    type: "object",
    properties: {
      deviceId: { type: "string", description: "设备 ID" },
      host: { type: "string", description: "设备 IP 地址" },
    },
  },
  async execute(input, ctx: ToolContext) {
    if (!input.deviceId && !input.host) {
      return "请提供 deviceId 或 host 来指定要移除的设备。";
    }
    const devices = await readDevices();
    const target = input.deviceId
      ? devices.find((d) => d.id === input.deviceId)
      : devices.find((d) => d.host === input.host);

    if (!target) {
      return `未找到设备 ${input.deviceId || input.host}`;
    }

    const removedId = target.id;
    deleteDevicePasswordCache(target.host, target.username, target.port ?? 22);
    await serializedWriteDevices(async () => {
      const fresh = await readDevices();
      const t = fresh.find((d) => d.id === removedId);
      if (!t) return;
      await writeDevices(fresh.filter((d) => d.id !== removedId));
    });
    ctx.onStudioDeviceRemoved?.(removedId);
    return `已移除设备 ${target.host}:${target.port ?? 22} (${target.username}) [id: ${target.id}]`;
  },
};

export const deviceQuickConnectQrTool: Tool<{ label?: string }> = {
  name: "device_quick_connect_qr",
  description:
    "生成一个快速连接设备的二维码。扫码后打开一个简易页面，在设备旁边的人可以输入设备 IP 即可完成连接。适合远程协助场景。",
  inputSchema: {
    type: "object",
    properties: {
      label: { type: "string", description: "标签说明（可选）" },
    },
  },
  async execute(_input, ctx) {
    const port = process.env.PORT || "23456";
    const ips = getLocalSubnets().map((s) => s.replace(/\.\d+$/, ""));
    let studioHost = process.env.RDK_STUDIO_HOST || "";

    if (!studioHost) {
      const nets = networkInterfaces();
      for (const ifaces of Object.values(nets)) {
        for (const iface of ifaces ?? []) {
          if (iface.family === "IPv4" && !iface.internal) {
            studioHost = iface.address;
            break;
          }
        }
        if (studioHost) break;
      }
    }

    const url = `http://${studioHost}:${port}/quick-connect`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });

    const downloadsDir = getAgentMediaDownloadDir();
    const fileName = `quick-connect-qr-${Date.now()}.png`;
    const filePath = `${downloadsDir}/${fileName}`;

    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const { promises: fsP } = await import("node:fs");
    await fsP.mkdir(downloadsDir, { recursive: true });
    await fsP.writeFile(filePath, Buffer.from(base64Data, "base64"));

    return JSON.stringify({
      __type: "image_download",
      localPath: filePath,
      bytes: Buffer.from(base64Data, "base64").length,
      imageUrl: `/api/local-files/${encodeURIComponent(fileName)}`,
      fileName,
      quickConnectUrl: url,
    });
  },
};

export const weixinBindQrTool: Tool<Record<string, never>> = {
  name: "weixin_bind_qrcode",
  description:
    "生成微信 ClawBot 绑定二维码。用户扫码后即可将个人微信与 RDK Studio 绑定，之后可通过微信与 AI 对话。二维码有效期约 5 分钟。",
  inputSchema: { type: "object", properties: {} },
  async execute(_input, ctx) {
    const port = process.env.PORT || "23456";
    const res = await fetch(`http://127.0.0.1:${port}/api/rdkclaw/weixin/bind-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await res.json()) as { ok?: boolean; qrDataUrl?: string; error?: string };
    if (!data.ok || !data.qrDataUrl) {
      return `获取微信绑定二维码失败: ${data.error || "未知错误"}`;
    }

    const qrRef = data.qrDataUrl.trim();
    let imageBuf: Buffer;
    if (/^https?:\/\//i.test(qrRef)) {
      const imgRes = await fetch(qrRef);
      if (!imgRes.ok) {
        return `拉取微信二维码图片失败: HTTP ${imgRes.status}`;
      }
      imageBuf = Buffer.from(await imgRes.arrayBuffer());
    } else {
      const path = qrRef.startsWith("/") ? qrRef : `/${qrRef}`;
      const imgRes = await fetch(`http://127.0.0.1:${port}${path}`);
      if (!imgRes.ok) {
        return `拉取微信二维码图片失败: HTTP ${imgRes.status}`;
      }
      imageBuf = Buffer.from(await imgRes.arrayBuffer());
    }

    const downloadsDir = getAgentMediaDownloadDir();
    const fileName = `weixin-bind-qr-${Date.now()}.png`;
    const filePath = `${downloadsDir}/${fileName}`;

    const { promises: fsP } = await import("node:fs");
    await fsP.mkdir(downloadsDir, { recursive: true });
    await fsP.writeFile(filePath, imageBuf);

    return JSON.stringify({
      __type: "image_download",
      localPath: filePath,
      bytes: imageBuf.length,
      imageUrl: `/api/local-files/${encodeURIComponent(fileName)}`,
      fileName,
    });
  },
};

export type SwitchDeviceCallback = (deviceId: string) => void;

export const switchDeviceTool = (
  onSwitch: SwitchDeviceCallback,
): Tool<{ device: string }> => ({
  name: "switch_device",
  description:
    "切换当前会话绑定的 RDK 设备。接受设备 IP 或设备 ID。\n\n" +
    "IMPORTANT 使用规则：\n" +
    "- 仅在用户明确要求切换设备时使用\n" +
    "- NEVER 因为 device_exec 命令失败就自动切换设备——命令失败不代表设备离线\n" +
    "- NEVER 在未经用户确认的情况下切换设备\n" +
    "- SSH 超时、命令报错、连接抖动都是正常现象，应该重试而不是切换设备",
  inputSchema: {
    type: "object",
    properties: {
      device: {
        type: "string",
        description: "目标设备的 IP 地址或设备 ID",
      },
    },
    required: ["device"],
  },
  async execute(input, ctx: ToolContext) {
    const query = (input.device || "").trim();
    if (!query) return "请提供目标设备的 IP 地址或设备 ID。";

    const devices = await readDevices();
    const match = devices.find(
      (d) => d.id === query || d.host === query,
    );
    if (!match) {
      const available = devices.map((d) => `• ${d.host} (${d.status}) [id: ${d.id}]`);
      return `未找到设备 "${query}"。当前已添加的设备:\n${available.join("\n") || "（无）"}`;
    }
    /**
     * 库内 `status` 在成功连接后长期为 connected，不会在断网时自动改为 disconnected
     * （与侧栏「在线」由 ping 实时刷新不同）。不在此处用陈旧 status 拦截切换。
     */
    if (match.status === "disconnected") {
      return `设备 ${match.host} 在库中标记为 disconnected，请先用 device_connect_ssh 重新连接后再切换。`;
    }

    if (ctx.onStudioDeviceBound) {
      ctx.onStudioDeviceBound(match.id);
    } else {
      onSwitch(match.id);
    }
    return `已切换到设备 ${match.host}:${match.port ?? 22} (${match.username}) [id: ${match.id}]。后续消息将路由到该设备。`;
  },
});

export function createDeviceManagerTools(
  onSwitchDevice?: SwitchDeviceCallback,
): Tool[] {
  const tools: Tool[] = [
    deviceListTool,
    deviceScanTool,
    deviceConnectTool,
    deviceRemoveTool,
    deviceQuickConnectQrTool,
    weixinBindQrTool,
  ];
  if (onSwitchDevice) {
    tools.push(switchDeviceTool(onSwitchDevice));
  }
  return tools;
}
