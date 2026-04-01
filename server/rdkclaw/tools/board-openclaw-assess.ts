import type { Tool, ToolContext } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager } from "../../managers/OpenClawDeploymentManager.js";
import type { Device } from "../../../shared/types.js";

function resolveDevicePassword(device: Device) {
  const persisted = (device as Device & { password?: string }).password ?? "";
  const envPwd = process.env.RDK_SSH_PASSWORD ?? "";
  return persisted || envPwd;
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
  if (/missing\s+scope|operator\.(read|write|admin)/i.test(text)) {
    return (
      "板端网关鉴权范围不足（scope）。请检查 RDK Studio 与板端 Gateway 的 token / pairing；"
      + "若健康检查显示网关在运行，应说明为鉴权问题而非网关停机。"
    );
  }
  if (/__OPENCLAW_HTTP_FAILED__/i.test(text)) {
    const inner = text.replace(/__OPENCLAW_HTTP_FAILED__/gi, "").trim();
    if (/missing\s+scope|operator\.(read|write|admin)/i.test(inner)) {
      return parseBoardError(inner);
    }
    return inner || "板端 OpenClaw 网关调用失败";
  }
  if (/plugins\.allow is empty/i.test(text)) {
    return "板端 OpenClaw 插件策略阻止执行（plugins.allow 为空）";
  }
  return text;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch (_) {}
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch (_) {}
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const maybe = text.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(maybe);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch (_) {}
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "can", "able", "ok"].includes(v)) return true;
    if (["false", "no", "n", "0", "cannot", "cant", "unable"].includes(v)) return false;
  }
  return null;
}

function normalizeAssessment(raw: string, fallbackReason?: string) {
  const obj = extractJsonObject(raw);
  const can =
    asBool(obj?.canHandle) ??
    asBool(obj?.can_do) ??
    asBool(obj?.canDo) ??
    asBool(obj?.capable);
  let canHandle = can ?? false;
  const lower = (raw || "").toLowerCase();
  if (can === null) {
    if (/不能|无法|做不到|失败|不支持/.test(raw)) canHandle = false;
    else if (/可以|可执行|能做|可完成/.test(raw)) canHandle = true;
  }
  const reason =
    (typeof obj?.reason === "string" && obj.reason.trim()) ||
    (typeof obj?.summary === "string" && obj.summary.trim()) ||
    (fallbackReason?.trim() || "") ||
    (canHandle ? "板端可执行该任务" : "板端不建议执行该任务");
  const confidenceRaw =
    typeof obj?.confidence === "number"
      ? obj.confidence
      : typeof obj?.score === "number"
        ? obj.score
        : canHandle
          ? 0.7
          : 0.6;
  const confidence = Math.max(0, Math.min(1, Number.isFinite(confidenceRaw) ? confidenceRaw : 0.6));
  return {
    canHandle,
    confidence,
    reason,
  };
}

export interface BoardSkillInfo {
  name: string;
  path: string;
  description: string;
}

export function boardOpenClawAssessTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  conversationId?: string,
  boardSkills?: BoardSkillInfo[],
  onProgress?: (chunk: string, toolCallId?: string) => void,
): Tool<{
  task: string;
  context?: string;
  sessionId?: string;
}> {
  return {
    name: "board_openclaw_assess",
    description:
      "读者=编排模型。与板端 OpenClaw 的**正式能力握手**：只评估不执行，但**不是可跳过的一步**——在可能 delegate 前应先 assess，避免 RDKClaw 用 SSH 把整件事包办。\n" +
      "向板端 OpenClaw 咨询：某任务是否适合由板端 Agent 承接（canHandle/confidence/reason）。\n\n" +
      "选用时机：\n" +
      "- 板端多步/试错/技能链/clawhub 流程；或你已预见要多轮 device_exec 试探\n" +
      "- 不确定该 SSH 硬顶还是交给板端时——先 assess 再决定\n" +
      "不适用：纯本机搜索/读文档/知识问答（与板端无关）；单条 shell 就能完成的原子命令（直接 device_exec）\n\n" +
      "规则：\n" +
      "- ALWAYS 在 board_openclaw_delegate 之前调用（同一复杂任务勿跳过）\n" +
      "- 返回 confidence < 0.5 时：倾向用本地/SSH；若 reason 指缺技能，可先装技能再 assess\n",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "待评估任务描述" },
        context: { type: "string", description: "可选上下文，例如环境约束、期望产物" },
        sessionId: { type: "string", description: "可选会话 ID" },
      },
      required: ["task"],
    },
    async execute(input, ctx: ToolContext) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return JSON.stringify({
          canHandle: false,
          confidence: 0,
          reason: "设备不存在，无法进行板端能力评估",
        }, null, 2);
      }

      const boardDevice = toBoardDevice(device);
      const skillContext = boardSkills && boardSkills.length > 0
        ? `\n你当前已安装的技能（${boardSkills.length} 个）:\n` +
          boardSkills.map((s) => `- ${s.name}: ${s.description || "无描述"} [${s.path}]`).join("\n") +
          "\n评估时请考虑这些已安装技能是否能完成任务。"
        : "";
      const prompt = [
        "你是板端 OpenClaw 的任务评估器，只做可行性评估，不执行任务。",
        "请严格返回 JSON（不要 markdown，不要代码块）：",
        '{"canHandle": true|false, "confidence": 0~1, "reason": "一句话原因", "suggestedPath": "board|local"}',
        skillContext,
        input.context ? `context: ${input.context}` : "",
        `task: ${input.task}`,
      ].filter(Boolean).join("\n");
      const sessionId = input.sessionId?.trim() || conversationId || `rdkclaw-board-assess-${Date.now()}`;

      return await new Promise<string>((resolve) => {
        let output = "";
        manager.sendAgentMessage(
          prompt,
          (chunk) => {
            output += chunk;
            onProgress?.(chunk, ctx.toolCallId);
          },
          (success) => {
            if (!success) {
              const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
              if (cleanOutput.length > 10) {
                const normalized = normalizeAssessment(cleanOutput, "板端连接中断，基于部分输出评估");
                resolve(JSON.stringify(normalized, null, 2));
              } else {
                const reason = parseBoardError(output);
                resolve(JSON.stringify({
                  canHandle: false,
                  confidence: 0.2,
                  reason,
                }, null, 2));
              }
              return;
            }
            const normalized = normalizeAssessment(output);
            resolve(JSON.stringify(normalized, null, 2));
          },
          sessionId,
          boardDevice,
        );
      });
    },
  };
}
