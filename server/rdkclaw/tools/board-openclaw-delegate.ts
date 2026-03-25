import type { Tool } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager } from "../../managers/OpenClawDeploymentManager.js";
import type { Device } from "../../../shared/types.js";
import type { EcosystemRegistry } from "../../ecosystem/registry.js";
import type { RdkPlatform } from "../../../shared/ecosystem-types.js";

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

function isRetryableFailure(output: string): boolean {
  const lower = output.toLowerCase();
  return /__openclaw_ws_failed__/i.test(output)
    || /ssh error|econnreset|econnrefused|connection reset|socket closed|timed out|timeout|handshake|broken pipe|network|websocket connect failed/i.test(lower);
}

const DELEGATE_MAX_RETRIES = 1;
const DELEGATE_RETRY_DELAY_MS = 2000;

export function boardOpenClawDelegateTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string) => void,
  conversationId?: string,
  ecosystemRegistry?: EcosystemRegistry,
): Tool<{
  task: string;
  intent?: string;
  context?: string;
  sessionId?: string;
}> {
  return {
    name: "board_openclaw_delegate",
    description:
      "将复杂板端任务委派给板端 OpenClaw Agent 执行。适用于设备真实操作、板端插件流程、需要板端上下文的复杂任务。同一对话内自动复用会话，板端保留上下文。",
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
    async execute(input, ctx) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) throw new Error("设备不存在，无法委派板端 OpenClaw");

      const boardDevice = toBoardDevice(device);
      const platform = (device as any).platform as RdkPlatform | undefined;
      const msgParts = [
        input.intent ? `intent: ${input.intent}` : "",
        input.context ? `context: ${input.context}` : "",
        `task: ${input.task}`,
      ];
      if (ecosystemRegistry) {
        const taskKeywords = input.task;
        const skills = ecosystemRegistry.findRelevantSkills(taskKeywords, platform, 5);
        if (skills.length > 0) {
          const skillLines = skills.map((s) => {
            const note = platform && s.platformNotes?.[platform] ? ` (${s.platformNotes[platform]})` : "";
            const doc = s.docUrl ? ` 文档:${s.docUrl}` : "";
            return `  - ${s.name}: ${s.description}${note}${doc}`;
          });
          msgParts.push(`\navailable_skills:\n${skillLines.join("\n")}`);
        }
      }
      const msg = msgParts.filter(Boolean).join("\n");
      const sessionId = input.sessionId?.trim() || `rdkclaw-board-${deviceId}-${conversationId || Date.now()}`;

      const runOnce = (): Promise<{ output: string; success: boolean }> =>
        new Promise((resolve, reject) => {
          if (ctx.abortSignal?.aborted) {
            reject(new Error("操作已中止"));
            return;
          }

          let settled = false;
          const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
          };
          let output = "";
          let pending = "";
          let lastEmitAt = 0;
          let handle: { abort: () => void } | null = null;
          const flushProgress = (force = false) => {
            const now = Date.now();
            if (!force && now - lastEmitAt < 400) return;
            if (!pending.trim()) return;
            const toSend = pending.length > 1200 ? pending.slice(-1200) : pending;
            pending = "";
            lastEmitAt = now;
            onProgress?.(toSend);
          };

          const onAbort = () => {
            try { handle?.abort(); } catch { /* ignore */ }
            settle(() => reject(new Error("操作已中止")));
          };
          ctx.abortSignal?.addEventListener("abort", onAbort, { once: true });

          handle = manager.sendAgentMessage(
            msg,
            (chunk) => {
              if (settled) return;
              output += chunk;
              pending += chunk;
              flushProgress(false);
            },
            (success) => {
              if (settled) return;
              ctx.abortSignal?.removeEventListener("abort", onAbort);
              flushProgress(true);
              settle(() => resolve({ output, success }));
            },
            sessionId,
            boardDevice,
          );
        });

      let lastOutput = "";
      for (let attempt = 0; attempt <= DELEGATE_MAX_RETRIES; attempt++) {
        const { output, success } = await runOnce();
        if (success) {
          return output.trim() || "板端 OpenClaw 执行完成（无文本输出）";
        }
        lastOutput = output;
        const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
        if (cleanOutput.length > 20 && !isRetryableFailure(output)) {
          return cleanOutput + "\n\n[注意：板端连接中途断开，以上为已收集的部分结果]";
        }
        if (attempt < DELEGATE_MAX_RETRIES && isRetryableFailure(output)) {
          console.warn(`[board-delegate] retryable failure on attempt ${attempt + 1}, retrying in ${DELEGATE_RETRY_DELAY_MS}ms`);
          onProgress?.("\n[连接中断，正在自动重试...]\n");
          manager.destroyConnection(boardDevice.ip);
          await new Promise((r) => setTimeout(r, DELEGATE_RETRY_DELAY_MS));
          continue;
        }
        break;
      }
      const finalClean = lastOutput.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
      if (finalClean.length > 20) {
        return finalClean + "\n\n[注意：板端连接中途断开，以上为已收集的部分结果]";
      }
      throw new Error(parseBoardError(lastOutput));
    },
  };
}
