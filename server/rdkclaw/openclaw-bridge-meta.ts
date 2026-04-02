import type { ToolContext } from "../agent/tools/types.js";
import type { Device } from "../../shared/types.js";

/** 供 sendAgentMessage → oc-bridge → 网关 chat.send 的 clientMeta / 日志对齐 */
export function openClawBridgeMeta(ctx: ToolContext): {
  correlationId?: string;
  studioRunId?: string;
  studioSessionKey?: string;
} {
  const out: { correlationId?: string; studioRunId?: string; studioSessionKey?: string } = {
    studioSessionKey: ctx.sessionKey,
  };
  const tc = ctx.toolCallId?.trim();
  if (tc) out.correlationId = tc;
  const sr = ctx.studioRunId?.trim();
  if (sr) out.studioRunId = sr;
  return out;
}

/** 将 __OPENCLAW_WS_FAILED__ 后 JSON `{ ocCode, message }` 展开为可读一行（供 parseBoardError） */
export function normalizeOpenClawWsFailureText(raw: string): string {
  const text = (raw || "").trim();
  if (!/__OPENCLAW_WS_FAILED__/i.test(text)) return text;
  const inner = text.replace(/__OPENCLAW_WS_FAILED__/gi, "").trim();
  try {
    const j = JSON.parse(inner) as { ocCode?: string; message?: string };
    if (j && typeof j.message === "string" && j.message.trim()) {
      return j.ocCode ? `[${j.ocCode}] ${j.message}` : j.message;
    }
  } catch {
    /* plain text */
  }
  return inner || "板端 OpenClaw WebSocket 调用失败";
}

export function logOpenClawBridgeEvent(device: Device | undefined, payload: Record<string, unknown>): void {
  if (String(process.env.RDK_OPENCLAW_BRIDGE_LOG ?? "").trim() !== "1") return;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      source: "openclaw_bridge",
      deviceId: device?.id ?? null,
      ...payload,
    }),
  );
}
