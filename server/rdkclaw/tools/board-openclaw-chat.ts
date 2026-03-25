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

export function boardOpenClawChatTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  sessionId: string,
): Tool<{
  message: string;
  context?: string;
}> {
  return {
    name: "board_openclaw_chat",
    description:
      "与板端 OpenClaw 自由交流——交换信息、讨论方案、了解板端能力和状态。" +
      "不同于 assess（评估可行性）和 delegate（委派执行），这是轻量级的伙伴对话。" +
      "典型用途：了解 OpenClaw 配置的模型和能力（如是否支持视觉）、分享你的分析发现、" +
      "讨论执行方案和注意事项、获取板端实时状态、协商分工。" +
      "与 delegate 共享会话上下文，交流过的内容在后续委派时 OpenClaw 仍记得。",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "想和 OpenClaw 交流的内容" },
        context: { type: "string", description: "可选背景信息，帮助 OpenClaw 理解语境" },
      },
      required: ["message"],
    },
    async execute(input) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return "无法与 OpenClaw 交流：设备不存在或未连接";
      }

      const boardDevice = toBoardDevice(device);
      const prompt = [
        "你的伙伴 RDKClaw（RDK Studio 的主交互智能体）正在和你交流。",
        "请根据你对板端设备、已安装技能、当前系统状态和你自身能力的了解，如实回答或分享你的想法。",
        "如果涉及你的模型能力（如是否支持视觉、支持哪些语言、上下文长度等），请据实说明。",
        input.context ? `背景信息: ${input.context}` : "",
        `RDKClaw: ${input.message}`,
      ].filter(Boolean).join("\n");

      return await new Promise<string>((resolve) => {
        let output = "";
        const timeout = setTimeout(() => {
          resolve(output.trim() || "OpenClaw 未在限定时间内回复");
        }, 30000);

        manager.sendAgentMessage(
          prompt,
          (chunk) => {
            output += chunk;
          },
          (success) => {
            clearTimeout(timeout);
            if (!success) {
              const clean = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
              resolve(clean || "与 OpenClaw 的交流中断");
              return;
            }
            resolve(output.trim() || "OpenClaw 回复为空");
          },
          sessionId,
          boardDevice,
        );
      });
    },
  };
}
