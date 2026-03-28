import type { Tool } from "./types.js";
import { readDevices, writeDevices } from "../../storage.js";
import { verifySshConnection } from "../../ssh.js";
import { v4 as uuid } from "uuid";
import * as net from "node:net";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";

const DEFAULT_SSH_USER = "root";
const DEFAULT_SSH_PASSWORDS = ["sunrise", "root", ""];
const SCAN_PORT = 22;
const SCAN_TIMEOUT_MS = 1500;

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
  description: "列出 RDK Studio 中所有已添加的设备及其连接状态。无需参数。",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    const devices = await readDevices();
    if (devices.length === 0) {
      return "当前没有已添加的设备。可以用 device_scan_network 扫描局域网，或用 device_connect_ssh 直接连接。";
    }
    const lines = devices.map(
      (d) => `• ${d.host}:${d.port ?? 22} (${d.username}) — ${d.status} [id: ${d.id}]`,
    );
    return `已添加 ${devices.length} 台设备:\n${lines.join("\n")}`;
  },
};

export const deviceScanTool: Tool<{ subnet?: string }> = {
  name: "device_scan_network",
  description: "扫描局域网中开放 SSH(22) 端口的设备，通常是 RDK 开发板。可选指定子网前缀（如 192.168.1），不填则自动检测本机子网。",
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

    return `发现 ${found.length} 台设备:\n${lines.join("\n")}\n\n可以用 device_connect_ssh 连接新设备。RDK 默认用户名: root，默认密码: sunrise`;
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
    "通过 SSH 连接一台新的 RDK 设备并添加到 Studio。需要提供 IP 地址，用户名和密码可选（默认 root/sunrise）。连接成功后设备将自动可用于后续操作。",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "设备 IP 地址，如 192.168.1.100" },
      username: { type: "string", description: "SSH 用户名（默认 root）" },
      password: { type: "string", description: "SSH 密码（默认 sunrise）" },
      port: { type: "number", description: "SSH 端口（默认 22）" },
    },
    required: ["host"],
  },
  async execute(input) {
    const host = input.host.trim();
    const port = input.port ?? 22;
    const username = input.username?.trim() || DEFAULT_SSH_USER;
    const passwords = input.password ? [input.password] : DEFAULT_SSH_PASSWORDS;

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

    if (!connectedPassword && !input.password) {
      return `SSH 连接失败（尝试了默认密码）: ${lastError}\n请提供正确的密码后重试。`;
    }
    if (!connectedPassword) {
      return `SSH 连接失败: ${lastError}\n请检查 IP 地址、用户名和密码是否正确。`;
    }

    const devices = await readDevices();
    const now = new Date().toISOString();
    const existingId = devices.find(
      (d) => d.host === host && (d.port ?? 22) === port && d.username === username,
    )?.id;

    const device = {
      id: existingId ?? uuid(),
      host,
      port,
      username,
      password: connectedPassword,
      status: "connected" as const,
      lastCheckedAt: now,
    };

    const nextDevices = [
      device,
      ...devices.filter(
        (d) => !(d.host === host && (d.port ?? 22) === port && d.username === username),
      ),
    ];
    await writeDevices(nextDevices);

    return `设备连接成功!\n• IP: ${host}:${port}\n• 用户: ${username}\n• 设备ID: ${device.id}\n• 状态: connected\n\n现在可以对该设备执行命令、文件操作等。`;
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
  async execute(input) {
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

    const nextDevices = devices.filter((d) => d.id !== target.id);
    await writeDevices(nextDevices);
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

    const downloadsDir = ctx.workspaceDir
      ? `${ctx.workspaceDir}/downloads`
      : `${process.cwd()}/downloads`;
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

    const downloadsDir = ctx.workspaceDir
      ? `${ctx.workspaceDir}/downloads`
      : `${process.cwd()}/downloads`;
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
    "切换当前会话绑定的 RDK 设备。后续所有渠道（AI Dock、飞书、微信）的消息将路由到新设备。接受设备 IP 或设备 ID。切换在下一条消息生效。",
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
  async execute(input) {
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
    if (match.status !== "connected") {
      return `设备 ${match.host} 当前状态为 ${match.status}，需要先连接才能切换。可以用 device_connect_ssh 重新连接。`;
    }

    onSwitch(match.id);
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
