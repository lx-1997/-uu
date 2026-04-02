import type { Tool } from "../../agent/tools/types.js";
import { ensureFindSkillsOnBoard } from "../../agent/tools/rdk-tools.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager, type OpenClawHealthStatus } from "../../managers/OpenClawDeploymentManager.js";
import type { Device as SharedDevice } from "../../../shared/types.js";
import {
  getCachedOpenClawAiReady,
  invalidateOpenClawHealthCache,
  setCachedOpenClawAiReady,
} from "../openclaw-health-cache.js";
import {
  applyNeedStreakPolicy,
  formatAssessInjectBlock,
  logDualAgentEvent,
} from "../board-dual-agent-orchestration.js";
import {
  mentionsOpenClawGatewayPairingRequired,
  openClawBridgeMeta,
  parseOpenClawBoardRpcError,
} from "../openclaw-bridge-meta.js";

function resolveDevicePassword(device: SharedDevice) {
  const persisted = (device as SharedDevice & { password?: string }).password ?? "";
  const envPwd = process.env.RDK_SSH_PASSWORD ?? "";
  return persisted || envPwd;
}

function toBoardDevice(device: SharedDevice) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

function isRetryableFailure(output: string): boolean {
  if (mentionsOpenClawGatewayPairingRequired(output)) return false;
  const lower = output.toLowerCase();
  return /__openclaw_ws_failed__/i.test(output)
    || /ssh error|econnreset|econnrefused|connection reset|socket closed|timed out|timeout|handshake|broken pipe|websocket connect failed|websocket closed unexpectedly/i.test(lower);
}

const DELEGATE_MAX_RETRIES = 1;
const DELEGATE_RETRY_DELAY_MS = 2000;

function abortAwareDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("操作已中止")); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error("操作已中止")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getBoardHealth(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; userName: string; id?: string; password?: string },
): Promise<OpenClawHealthStatus> {
  return new Promise((resolve) => {
    manager.getHealthStatus(boardDevice, (status) => resolve(status));
  });
}

function restartGateway(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; userName: string; id?: string; password?: string },
  onProgress?: (chunk: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    manager.runRestartGateway(
      boardDevice,
      (chunk) => onProgress?.(chunk),
      (success) => resolve(success),
    );
  });
}

async function maybeEnsureBoardFindSkills(deviceId: string, onProgress?: (chunk: string) => void): Promise<void> {
  if (!deviceId.trim()) return;
  try {
    await ensureFindSkillsOnBoard(deviceId, onProgress);
  } catch (e) {
    onProgress?.(`\n[板端] find-skills 预装跳过: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function ensureBoardGatewayReady(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; userName: string; id?: string; password?: string },
  onProgress?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error("操作已中止");
  const deviceId = String(boardDevice.id || "").trim();
  if (deviceId && getCachedOpenClawAiReady(deviceId) === true) {
    onProgress?.("\n[预检] 近期已确认板端 OpenClaw 就绪，跳过重复健康检测。\n");
    await maybeEnsureBoardFindSkills(deviceId, onProgress);
    return;
  }

  let health = await getBoardHealth(manager, boardDevice);
  if (health.aiReady) {
    if (deviceId) setCachedOpenClawAiReady(deviceId, true);
    await maybeEnsureBoardFindSkills(deviceId, onProgress);
    return;
  }

  if (health.installed && !health.gatewayRunning) {
    onProgress?.("\n[预检] 板端网关未就绪，尝试自动重启...\n");
    await restartGateway(manager, boardDevice, onProgress);
    if (signal?.aborted) throw new Error("操作已中止");
    health = await getBoardHealth(manager, boardDevice);
    if (health.aiReady) {
      if (deviceId) setCachedOpenClawAiReady(deviceId, true);
      await maybeEnsureBoardFindSkills(deviceId, onProgress);
      return;
    }
  }

  if (deviceId) invalidateOpenClawHealthCache(deviceId);
  const reason = health.summary?.trim() || "板端 OpenClaw 未就绪";
  const advice = !health.installed
    ? "请先安装 OpenClaw 并完成初始化。"
    : !health.gatewayRunning
      ? "请先启动或修复板端 Gateway。"
      : health.tokenStatus === "missing"
        ? "请先生成并配置 Gateway token。"
        : health.tokenStatus === "invalid"
          ? "请先修复 Gateway token（无效或过期）。"
          : "请先执行 OpenClaw 健康检查并修复后重试。";
  throw new Error(`${reason}（${advice}）`);
}

export interface BoardSkillInfo {
  name: string;
  path: string;
  description: string;
}

export function boardOpenClawDelegateTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  onProgress?: (chunk: string, toolCallId?: string) => void,
  conversationId?: string,
  boardSkills?: BoardSkillInfo[],
): Tool<{
  task: string;
  intent?: string;
  context?: string;
  guidance?: string;
  encourageSkills?: boolean;
  sessionId?: string;
}> {
  return {
    name: "board_openclaw_delegate",
    description:
      "读者=编排模型。把**一段板端责任**交给板端 OpenClaw 在其会话里执行（多步推理、技能链、迭代排障），不是「多调几次 SSH」的别名。\n" +
      "将任务委派给板端 OpenClaw。RDKClaw 与板端协作的核心执行工具。\n\n" +
      "规则：\n" +
      "- ALWAYS 在委派前先用 board_openclaw_assess；assess 认为可承接后再 delegate（勿跳过 assess）\n" +
      "- ALWAYS 在 guidance 中注入你的分析和建议——OpenClaw 只了解板端本地状态，你的全局知识（RDK 文档、联网检索结果）对它至关重要\n" +
      "- ALWAYS 在 guidance 中写明验收标准（怎样算成功）\n" +
      "- 若任务可能超出板端当前技能，在 guidance 中提示：可先用 find-skills（SkillHub）检索/安装再执行\n" +
      "- 委派后 ALWAYS 评估返回结果的质量，失败时用本地工具兜底\n" +
      "- 若 OpenClaw 回复含 [NEED_RDKCLAW] 块，提取 type/query/reason 后用你的工具获取信息，再通过 board_openclaw_chat 发回\n" +
      "- 同一对话内自动复用会话，板端保留上下文\n" +
      "- NEVER 在未连接设备时调用此工具",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "要交给板端执行的完整任务描述" },
        intent: { type: "string", description: "可选意图标签，如 diagnose/deploy/repair" },
        context: { type: "string", description: "可选补充上下文（设备状态、约束条件）" },
        guidance: { type: "string", description: "RDKClaw 对 OpenClaw 的执行建议：推荐方案、注意事项、参考文档链接等。帮助 OpenClaw 更高效地完成任务" },
        encourageSkills: { type: "boolean", description: "是否鼓励 OpenClaw 优先使用自身已安装的技能来完成任务（默认 true）" },
        sessionId: { type: "string", description: "可选会话ID，用于连续对话" },
      },
      required: ["task"],
    },
    async execute(input, ctx) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) throw new Error("设备不存在，无法委派板端 OpenClaw");

      const boardDevice = toBoardDevice(device);
      await ensureBoardGatewayReady(manager, boardDevice, (chunk) => onProgress?.(chunk, ctx.toolCallId), ctx.abortSignal);
      const useSkills = input.encourageSkills !== false;
      const assessInject = formatAssessInjectBlock(ctx.sessionKey, deviceId);
      logDualAgentEvent({
        event: "delegate_start",
        sessionKey: ctx.sessionKey,
        deviceId,
        toolCallId: ctx.toolCallId ?? null,
        hasAssessInject: Boolean(assessInject),
      });
      const msgParts = [
        input.intent ? `intent: ${input.intent}` : "",
        input.context ? `context: ${input.context}` : "",
        `task: ${input.task}`,
      ];
      if (assessInject) {
        msgParts.push(`\n${assessInject}`);
      }
      if (input.guidance?.trim()) {
        msgParts.push(`\nrdkclaw_guidance: ${input.guidance.trim()}`);
      }
      if (boardSkills && boardSkills.length > 0) {
        const installed = boardSkills.map((s) =>
          `  - ${s.name}: ${s.description || "无描述"} [${s.path}]`
        ).join("\n");
        msgParts.push(`\ninstalled_skills (${boardSkills.length}):\n${installed}`);
      }
      if (useSkills) {
        msgParts.push(
          "\nhint: 优先用已装技能；不够则 `find-skills` 再执行，必要时 `clawhub install <owner/slug>`。收尾一句话说明用到的技能/命令链。",
        );
      }
      msgParts.push(
        "\n[NEED_RDKCLAW] 缺联网、文档或生态信息时，在回复中包一层（勿与正文混写）：\n" +
          "[NEED_RDKCLAW]\ntype: web_search|documentation|advisory\nquery: …\nreason: …\n[/NEED_RDKCLAW]\n" +
          "同 session 内 RDKClaw 会补发结果，你可据此继续。",
      );
      const msg = msgParts.filter(Boolean).join("\n");
      const sessionId = input.sessionId?.trim() || conversationId || `rdkclaw-board-${deviceId}-${Date.now()}`;

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
            if (!force && now - lastEmitAt < 200) return;
            if (!pending.trim()) return;
            const toSend = pending.length > 1200 ? pending.slice(-1200) : pending;
            pending = "";
            lastEmitAt = now;
            onProgress?.(toSend, ctx.toolCallId);
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
            openClawBridgeMeta(ctx),
          );
        });

      let lastOutput = "";
      let gatewayPairRecoveryDone = false;
      for (let attempt = 0; attempt <= DELEGATE_MAX_RETRIES; attempt++) {
        const { output, success } = await runOnce();
        if (success) {
          const result = output.trim() || "板端 OpenClaw 执行完成（无文本输出）";
          const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, result, {
            phase: "delegate",
            toolCallId: ctx.toolCallId,
          });
          const body = need.text;
          const hasConsultationRequest = /\[NEED_RDKCLAW\]/i.test(body);
          const suffix = hasConsultationRequest
            ? need.degraded
              ? "\n\n---\n[RDKClaw：已按上限处理 NEED；请按上文 [Studio 策略] 用本机补全后 chat 一次，勿再循环 NEED。]"
              : "\n\n---\n[RDKClaw 提示：OpenClaw 在回复中发出了求助信号 [NEED_RDKCLAW]。" +
                "请提取其中的 type/query/reason，用你的本地工具（web_search、web_fetch 等）获取所需信息，" +
                "然后通过 board_openclaw_chat 把结果发回给 OpenClaw，让它继续完成任务。" +
                "共享同一会话，OpenClaw 能看到你的补充信息。]"
            : "\n\n---\n[RDKClaw 提示：请评估 OpenClaw 的执行结果。" +
              "如果它用了好的技能或方案，记在记忆中以备推荐；" +
              "如果有可改进之处，下次委派时在 guidance 中补充。" +
              "如果发现可复用的板端经验，建议创建为 OpenClaw 技能。]";
          return body + suffix;
        }
        lastOutput = output;
        if (
          !gatewayPairRecoveryDone &&
          mentionsOpenClawGatewayPairingRequired(output)
        ) {
          gatewayPairRecoveryDone = true;
          onProgress?.(
            "\n[板端 pairing required：正自动建立 CLI↔Gateway 信任（devices approve / pair）...]\n",
            ctx.toolCallId,
          );
          if (deviceId) invalidateOpenClawHealthCache(deviceId);
          const pairOk = await new Promise<boolean>((resolvePair) => {
            manager.runGatewayPair(
              boardDevice,
              "force",
              (chunk) => onProgress?.(chunk, ctx.toolCallId),
              resolvePair,
            );
          });
          manager.destroyConnection(boardDevice.ip);
          if (pairOk) {
            await abortAwareDelay(DELEGATE_RETRY_DELAY_MS, ctx.abortSignal);
            attempt--;
            continue;
          }
        }
        const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
        if (cleanOutput.length > 20 && !isRetryableFailure(output)) {
          const partial = cleanOutput + "\n\n[注意：板端连接中途断开，以上为已收集的部分结果]";
          const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, partial, {
            phase: "delegate",
            toolCallId: ctx.toolCallId,
          });
          return need.text;
        }
        if (attempt < DELEGATE_MAX_RETRIES && isRetryableFailure(output)) {
          console.warn(`[board-delegate] retryable failure on attempt ${attempt + 1}, retrying in ${DELEGATE_RETRY_DELAY_MS}ms`);
          onProgress?.("\n[连接中断，正在自动重试...]\n", ctx.toolCallId);
          manager.destroyConnection(boardDevice.ip);
          await abortAwareDelay(DELEGATE_RETRY_DELAY_MS, ctx.abortSignal);
          continue;
        }
        break;
      }
      const finalClean = lastOutput.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
      if (finalClean.length > 20) {
        const partial = finalClean + "\n\n[注意：板端连接中途断开，以上为已收集的部分结果]";
        const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, partial, {
          phase: "delegate",
          toolCallId: ctx.toolCallId,
        });
        return need.text;
      }
      if (deviceId) {
        if (
          mentionsOpenClawGatewayPairingRequired(lastOutput)
          || /missing\s+scope|operator\.(read|write|admin)/i.test(lastOutput)
        ) {
          invalidateOpenClawHealthCache(deviceId);
        }
      }
      throw new Error(parseOpenClawBoardRpcError(lastOutput));
    },
  };
}
