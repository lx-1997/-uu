import type { Tool } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager } from "../../managers/OpenClawDeploymentManager.js";
import { applyNeedStreakPolicy } from "../board-dual-agent-orchestration.js";
import { openClawBridgeMeta } from "../openclaw-bridge-meta.js";
import type { Device } from "../../../shared/types.js";
import { resolvePersistedOrDefaultSshPassword } from "../../device-ssh-credentials.js";

/** 板端推理可能较慢；默认 120s，可用 RDK_BOARD_OPENCLAW_CHAT_TIMEOUT_MS 覆盖（5000–600000） */
function boardOpenClawChatTimeoutMs(): number {
  const raw = process.env.RDK_BOARD_OPENCLAW_CHAT_TIMEOUT_MS;
  if (raw && /^\d+$/.test(String(raw).trim())) {
    const n = parseInt(String(raw).trim(), 10);
    if (n >= 5000 && n <= 600_000) return n;
  }
  return 120_000;
}

/** 等待板端首包时推给用户看的短句，减轻「卡住」感（随机一条） */
const WAITING_BLURBS = [
  "…正在等板端 OpenClaw 回话。先听句闲话：据说最早的调试器是 printf，治百病。\n\n",
  "…OpenClaw 在板子上琢磨呢。等的时候最适合倒杯水——反正比盯着白屏强。\n\n",
  "…和板端通个话要过网关，稍等片刻。小趣闻：第一个 bug 真的是只飞蛾。\n\n",
  "…消息已发给板端，它可能在想长上下文。你先歇两秒，急也没用。\n\n",
  "…等 OpenClaw 的时候，CPU 可能在跑推理。你可以深呼吸一下，算免费冥想。\n\n",
  "…板端若在用本地模型，首 token 有时会慢。下面开始是 OpenClaw 的回复：\n\n",
];

function resolveDevicePassword(device: Device) {
  return resolvePersistedOrDefaultSshPassword(device);
}

function toBoardDevice(device: Device) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

export type BoardOpenClawChatProgressMeta = { progressSource?: 'studio_wait' | 'board' };

export function boardOpenClawChatTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  sessionId: string,
  onProgress?: (chunk: string, toolCallId?: string, meta?: BoardOpenClawChatProgressMeta) => void,
): Tool<{
  message: string;
  context?: string;
}> {
  return {
    name: "board_openclaw_chat",
    description:
      "与板端 OpenClaw 自由交流——交换信息、讨论方案、了解板端能力和状态。\n\n" +
      "IMPORTANT 使用规则：\n" +
      "- 不同于 board_openclaw_assess（评估可行性）和 board_openclaw_delegate（委派执行），这是轻量级的伙伴对话\n" +
      "- 典型用途：了解 OpenClaw 配置的模型和能力、分享你的分析发现、讨论执行方案、获取板端实时状态\n" +
      "- 与 delegate 共享会话上下文，交流过的内容在后续委派时 OpenClaw 仍记得\n" +
      "- 板端回复可能需数十秒（本地模型推理慢），先对用户说一两句轻松话再调用\n" +
      "- 当 delegate 返回 [NEED_RDKCLAW] 块时，用你的工具获取信息后通过此工具发回给 OpenClaw\n" +
      "- NEVER 用此工具替代 delegate 来执行任务——chat 只交流不执行",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "想和 OpenClaw 交流的内容" },
        context: { type: "string", description: "可选背景信息，帮助 OpenClaw 理解语境" },
      },
      required: ["message"],
    },
    async execute(input, ctx) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return "无法与 OpenClaw 交流：设备不存在或未连接";
      }

      const boardDevice = toBoardDevice(device);
      /** 板端收到的用户消息前缀：短契约，与 delegate 的 NEED 块口径一致 */
      const prompt = [
        "[RDKClaw↔OpenClaw] Studio 侧主智能体与你对话（本 turn 以交流与对齐为主，复杂长任务用 delegate 已在其它消息中下达）。",
        "依据板端实况答复：设备状态、技能、文件与模型能力据实说；不确定写明「不确定」勿编造。",
        "缺联网/上游文档才能结论时：可在回复中使用与 delegate 相同的 [NEED_RDKCLAW]…[/NEED_RDKCLAW] 块（type/query/reason）。",
        input.context ? `背景: ${input.context}` : "",
        `—\nRDKClaw: ${input.message}`,
      ].filter(Boolean).join("\n");

      const waitMs = boardOpenClawChatTimeoutMs();
      return await new Promise<string>((resolve) => {
        let output = "";
        const blurb = WAITING_BLURBS[Math.floor(Math.random() * WAITING_BLURBS.length)];
        onProgress?.(blurb, ctx.toolCallId, { progressSource: 'studio_wait' });

        const timeout = setTimeout(() => {
          const line =
            output.trim() ||
            `OpenClaw 未在 ${Math.round(waitMs / 1000)} 秒内回复（板端推理慢或网关未返回时可重试 / 检查 OpenClaw 状态）`;
          const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, line, {
            phase: "chat",
            toolCallId: ctx.toolCallId,
          });
          resolve(need.text);
        }, waitMs);

        manager.sendAgentMessage(
          prompt,
          (chunk) => {
            output += chunk;
            onProgress?.(chunk, ctx.toolCallId, { progressSource: 'board' });
          },
          (success) => {
            clearTimeout(timeout);
            if (!success) {
              const clean = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
              const line = clean || "与 OpenClaw 的交流中断";
              const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, line, {
                phase: "chat",
                toolCallId: ctx.toolCallId,
              });
              resolve(need.text);
              return;
            }
            const trimmed = output.trim() || "OpenClaw 回复为空";
            const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, trimmed, {
              phase: "chat",
              toolCallId: ctx.toolCallId,
            });
            resolve(need.text);
          },
          sessionId,
          boardDevice,
          openClawBridgeMeta(ctx),
        );
      });
    },
  };
}
