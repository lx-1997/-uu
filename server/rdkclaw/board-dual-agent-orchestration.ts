/**
 * RDKClaw ↔ 套件端 OpenClaw：会话内编排状态（无需改套件端协议）。
 * - assess 结果注入后续 delegate
 * - NEED_RDKCLAW 连续出现次数上限与降级说明
 * - 结构化单行 JSON 日志（可用 RDK_DUAL_AGENT_LOG=0 关闭）
 */

const ASSESS_INJECT_STALE_MS = 15 * 60 * 1000;
/** 连续多少次套件端回复含 NEED 后附加降级提示（第 3 次起）*/
const MAX_NEED_STREAK_BEFORE_DEGRADE = 2;

export type NormalizedAssess = {
  canHandle: boolean;
  confidence: number;
  reason: string;
  suggestedPath?: "board" | "local";
};

type SessionBoardState = {
  lastAssess?: NormalizedAssess & { taskSnippet: string; recordedAt: number };
  /** 连续含 [NEED_RDKCLAW] 的套件端消息次数；无 NEED 时清零；新 assess 时清零 */
  needStreak: number;
  touchedAt: number;
};

const store = new Map<string, SessionBoardState>();
const STORE_PRUNE_MAX = 2000;
const STORE_PRUNE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function touch(state: SessionBoardState): SessionBoardState {
  return { ...state, touchedAt: Date.now() };
}

function pruneStoreIfNeeded() {
  if (store.size <= STORE_PRUNE_MAX) return;
  const cutoff = Date.now() - STORE_PRUNE_MAX_AGE_MS;
  for (const [k, v] of store) {
    if (v.touchedAt < cutoff) store.delete(k);
  }
}

function storeKey(sessionKey: string, deviceId: string) {
  return `${sessionKey.trim()}::${deviceId.trim()}`;
}

function loggingEnabled() {
  return String(process.env.RDK_DUAL_AGENT_LOG ?? "1").trim() !== "0";
}

export function logDualAgentEvent(payload: Record<string, unknown>): void {
  if (!loggingEnabled()) return;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      source: "rdkclaw_dual_agent",
      ...payload,
    }),
  );
}

export function recordAssessSnapshot(
  sessionKey: string,
  deviceId: string,
  assess: NormalizedAssess,
  taskSnippet: string,
): void {
  const k = storeKey(sessionKey, deviceId);
  pruneStoreIfNeeded();
  store.set(
    k,
    touch({
      lastAssess: {
        ...assess,
        taskSnippet: taskSnippet.slice(0, 800),
        recordedAt: Date.now(),
      },
      needStreak: 0,
      touchedAt: Date.now(),
    }),
  );
  logDualAgentEvent({
    event: "assess_recorded",
    sessionKey,
    deviceId,
    canHandle: assess.canHandle,
    confidence: assess.confidence,
    suggestedPath: assess.suggestedPath ?? null,
    reasonLen: assess.reason.length,
  });
}

/**
 * 拼入 delegate 消息的 assess 摘要；过期或缺失则返回 undefined。
 */
export function formatAssessInjectBlock(sessionKey: string, deviceId: string): string | undefined {
  const k = storeKey(sessionKey, deviceId);
  const st = store.get(k);
  const la = st?.lastAssess;
  if (!la) return undefined;
  if (Date.now() - la.recordedAt > ASSESS_INJECT_STALE_MS) return undefined;

  const pathHint =
    la.suggestedPath === "local"
      ? "（assess 倾向 local：请优先 device_exec/本机工具，避免无理由大块 delegate。）"
      : la.suggestedPath === "board"
        ? "（assess 倾向 board：适合套件端承接时再用 delegate；若 canHandle=false 勿硬顶。）"
        : "";

  return [
    `studio_last_assess: canHandle=${la.canHandle} confidence=${la.confidence.toFixed(2)}` +
      (la.suggestedPath ? ` suggestedPath=${la.suggestedPath}` : ""),
    `reason: ${la.reason.slice(0, 600)}${la.reason.length > 600 ? "…" : ""}`,
    la.taskSnippet.trim() ? `assess_task: ${la.taskSnippet.trim()}` : "",
    pathHint,
    "请本回合 delegate 的验收/guidance 与上述评估对齐；若上下文已变短述差异。",
  ]
    .filter(Boolean)
    .join("\n");
}

const NEED_DEGRADE_ZH =
  "\n\n---\n[Studio 策略] 已连续多轮出现 [NEED_RDKCLAW]，补给次数已达上限。\n" +
  "请在本机用 web_search / web_fetch（若策略允许）自行补全结论，**用 board_openclaw_chat 一次性写清依据与建议**发给套件端；\n" +
  "勿再期待套件端继续发 NEED 块。若仍无法闭环，向用户说明卡点与所需材料。\n";

/**
 * 套件端 delegate/chat 返回正文：维护 NEED 连续计数，超限则附加降级说明。
 * 正文中不含 NEED 时重置 streak。
 */
export function applyNeedStreakPolicy(
  sessionKey: string,
  deviceId: string,
  body: string,
  meta: { phase: "delegate" | "chat"; toolCallId?: string },
): { text: string; degraded: boolean; needStreak: number } {
  const k = storeKey(sessionKey, deviceId);
  const st = store.get(k) ?? { needStreak: 0, touchedAt: Date.now() };
  const hasNeed = /\[NEED_RDKCLAW\]/i.test(body);

  if (!body.trim()) {
    return { text: body, degraded: false, needStreak: st.needStreak };
  }

  if (!hasNeed) {
    const next = touch({ ...st, needStreak: 0 });
    store.set(k, next);
    logDualAgentEvent({
      event: "openclaw_reply",
      phase: meta.phase,
      sessionKey,
      deviceId,
      hasNeed: false,
      needStreak: 0,
      toolCallId: meta.toolCallId ?? null,
    });
    return { text: body, degraded: false, needStreak: 0 };
  }

  const needStreak = st.needStreak + 1;
  const degraded = needStreak > MAX_NEED_STREAK_BEFORE_DEGRADE;
  store.set(k, touch({ ...st, needStreak }));
  const text = degraded ? `${body}${NEED_DEGRADE_ZH}` : body;

  logDualAgentEvent({
    event: "openclaw_reply",
    phase: meta.phase,
    sessionKey,
    deviceId,
    hasNeed: true,
    needStreak,
    degraded,
    toolCallId: meta.toolCallId ?? null,
  });

  return { text, degraded, needStreak };
}
