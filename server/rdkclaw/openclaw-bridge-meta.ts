import type { ToolContext } from "../agent/tools/types.js";
import type { Device } from "../../shared/types.js";

/** Studio 侧桥接元数据：abort / 错误 payload 关联；板端 chat.send 不再附带 clientMeta（严格网关会拒收）。 */
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

/**
 * 本机 CLI / oc-bridge 与 **127.0.0.1:18789 网关** 的信任配对提示；
 * 与 `pairing approve feishu …` 等「渠道配对」不是同一套流程。
 */
export const OPENCLAW_GATEWAY_PAIRING_REQUIRED_HINT =
 "网关报 pairing required：本机客户端尚未与 loopback 上的 Gateway 完成**设备信任**。" +
 "与飞书等渠道的 `board_openclaw_pairing_*` 不同。" +
 "面板「一键配对」或工具 `board_openclaw_gateway_pair` 会执行 **`openclaw devices approve --latest`**（新版 CLI；旧版为 `pair --force`）。" +
 "若无待审批请求，先点「测试网关」或触发委派再试。完成后用 `board_openclaw_model_test` 或 health 验收。";

export function mentionsOpenClawGatewayPairingRequired(raw: string): boolean {
  return /\bpairing\s+required\b/i.test(String(raw || ""));
}

/** 板端 delegate / assess 等 RPC 失败时统一转给人读文案（含 WS / HTTP 包装）。 */
export function parseOpenClawBoardRpcError(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "板端 OpenClaw 未返回结果";

  if (/__OPENCLAW_WS_FAILED__/i.test(text)) {
    const normalized = normalizeOpenClawWsFailureText(text);
    if (mentionsOpenClawGatewayPairingRequired(normalized)) {
      return `${normalized}\n\n${OPENCLAW_GATEWAY_PAIRING_REQUIRED_HINT}`;
    }
    return normalized;
  }

  if (mentionsOpenClawGatewayPairingRequired(text)) {
    return `${text}\n\n${OPENCLAW_GATEWAY_PAIRING_REQUIRED_HINT}`;
  }

  if (/missing\s+scope|operator\.(read|write|admin)/i.test(text)) {
    return (
      "板端网关鉴权范围不足（scope，例如 operator.read）。"
      + "请检查 Gateway token 与本机 gateway pair 状态；"
      + "若健康检查显示网关在跑，多为鉴权/配对问题而非进程宕机。"
    );
  }

  if (/__OPENCLAW_HTTP_FAILED__/i.test(text)) {
    const inner = text.replace(/__OPENCLAW_HTTP_FAILED__/gi, "").trim();
    if (/missing\s+scope|operator\.(read|write|admin)/i.test(inner)) {
      return parseOpenClawBoardRpcError(inner);
    }
    if (mentionsOpenClawGatewayPairingRequired(inner)) {
      return parseOpenClawBoardRpcError(inner);
    }
    return inner || "板端 OpenClaw 网关调用失败";
  }

  if (/plugins\.allow is empty/i.test(text)) {
    return "板端 OpenClaw 插件策略阻止执行（plugins.allow 为空），请先在板端配置受信任插件。";
  }

  return text;
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
