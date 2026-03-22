import type { Tool } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager } from "../../managers/OpenClawDeploymentManager.js";
import type { Device } from "../../../shared/types.js";

function resolveDevicePassword(device: Device) {
  const persisted = (device as Device & { password?: string }).password ?? "";
  const envPwd = process.env.RDK_SSH_PASSWORD ?? "";
  return persisted || envPwd || device.username;
}

function toBoardDevice(device: Device) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

function parseBoardError(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "板端 OpenClaw 未返回结果";
  if (/__OPENCLAW_HTTP_FAILED__/i.test(text)) {
    return text.replace(/__OPENCLAW_HTTP_FAILED__/gi, "").trim() || "板端 OpenClaw 网关调用失败";
  }
  if (/plugins\.allow is empty/i.test(text)) {
    return "板端 OpenClaw 插件策略阻止执行（plugins.allow 为空），请先在板端配置受信任插件。";
  }
  return text;
}

export function boardOpenClawDelegateTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string) => void,
): Tool<{
  task: string;
  intent?: string;
  context?: string;
  sessionId?: string;
}> {
  return {
    name: "board_openclaw_delegate",
    description:
      "将复杂板端任务委派给板端 OpenClaw Agent 执行。适用于设备真实操作、板端插件流程、需要板端上下文的复杂任务。",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "要交给板端执行的完整任务描述" },
        intent: { type: "string", description: "可选意图标签，如 diagnose/deploy/repair" },
        context: { type: "string", description: "可选补充上下文（设备状态、约束条件）" },
        sessionId: { type: "string", description: "可选会话ID，用于连续对话" },
      },
      required: ["task"],
    },
    async execute(input) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) throw new Error("设备不存在，无法委派板端 OpenClaw");

      const boardDevice = toBoardDevice(device);
      const msg = [
        input.intent ? `intent: ${input.intent}` : "",
        input.context ? `context: ${input.context}` : "",
        `task: ${input.task}`,
      ]
        .filter(Boolean)
        .join("\n");
      const sessionId = input.sessionId?.trim() || `rdkclaw-board-${Date.now()}`;

      return await new Promise<string>((resolve, reject) => {
        let output = "";
        let pending = "";
        let lastEmitAt = 0;
        const flushProgress = (force = false) => {
          const now = Date.now();
          if (!force && now - lastEmitAt < 400) return;
          if (!pending.trim()) return;
          const toSend = pending.length > 1200 ? pending.slice(-1200) : pending;
          pending = "";
          lastEmitAt = now;
          onProgress?.(toSend);
        };
        manager.sendAgentMessage(
          msg,
          (chunk) => {
            output += chunk;
            pending += chunk;
            flushProgress(false);
          },
          (success) => {
            flushProgress(true);
            if (success) {
              resolve(output.trim() || "板端 OpenClaw 执行完成（无文本输出）");
              return;
            }
            const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
            if (cleanOutput.length > 20) {
              resolve(cleanOutput + "\n\n[注意：板端连接中途断开，以上为已收集的部分结果]");
            } else {
              reject(new Error(parseBoardError(output)));
            }
          },
          sessionId,
          boardDevice,
        );
      });
    },
  };
}
