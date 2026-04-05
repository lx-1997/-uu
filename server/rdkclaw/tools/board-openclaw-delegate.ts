import type { Tool } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import {
  OpenClawDeploymentManager,
  sshEndpointKey,
  type OpenClawHealthStatus,
} from "../../managers/OpenClawDeploymentManager.js";
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
  abortAwareDelay,
  isRetryableOpenClawBoardSendFailure,
  mentionsOpenClawGatewayPairingRequired,
  openClawBridgeMeta,
  parseOpenClawBoardRpcError,
} from "../openclaw-bridge-meta.js";
import { resolvePersistedOrDefaultSshPassword } from "../../device-ssh-credentials.js";

function resolveDevicePassword(device: SharedDevice) {
  return resolvePersistedOrDefaultSshPassword(device);
}

function toBoardDevice(device: SharedDevice) {
  return {
    ip: device.host,
    port: device.port ?? 22,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

const DELEGATE_MAX_RETRIES = 1;
const DELEGATE_RETRY_DELAY_MS = 2000;

/** 注入板端消息：强制阶段性反馈，避免「长时间无输出」；与 skills/rdk-board-progress-reporter/SKILL.md 一致 */
const BOARD_VISIBILITY_CONTRACT = [
  "---",
  "board_visibility_contract (mandatory, zh):",
  "- 每个主要步骤必须成对传递：**[板端·进行]**（要做什么、对象是谁）+ **[板端·结果]**（exit/端口/节点/成败一句）；有终端输出时中间加 **[板端·过程]**（关键输出 3～12 行，过长尾部截断）。",
  "- **禁止**只有「进行」没有「结果」；禁止单独使用「处理数据/执行脚本」等模糊词，必须带包名、*.launch.py、/dev/video*、topic、端口等具体标识。",
  "- 长日志在 [板端·过程] 只保留末尾约 12 行 + 省略标记；stderr 在结果或过程中摘要。",
  "- 若 rdkclaw_guidance 已含可直接执行命令：勿重复 dpkg/ros2 pkg 探测，先执行再排错。",
  "- Web 预览 URL 须板卡真实 IP（ip -br a），禁止文档占位 IP；标准演示目标约 60s 内可验收。",
  "- 收尾列出 launch 全名、验收命令与现象、预览 URL。",
  "若已安装技能「RDK Board Progress Reporter」请按其全文执行。",
].join("\n");

/** 注入板端学习闭环：让 OpenClaw 把可复用方法沉淀到板端 memory，减少同类问题反复试探 */
const BOARD_LEARNING_CONTRACT = [
  "---",
  "board_learning_contract (mandatory, zh):",
  "- 任务成功或形成明确结论后，追加 **[板端·复盘]** 段，至少包含：关键命令链(<=5条)、失败信号、最终验收命令、风险注意点。",
  "- 若流程可复用，给出 **[板端·可沉淀]**：skill_name 建议、触发条件、最小输入。",
  "- 若本次采用了 rdkclaw_guidance 中已确认命令，复盘里标注“已由 RDKClaw 确认”并说明哪些探测可省略。",
  "- 在有写权限且路径可用时，将复盘摘要落盘到 `~/.openclaw/workspace/memory/`（可按日期追加到 daily 文件）；若无法写入，需在结果中明确说明原因。",
].join("\n");

/** 注入协作优先契约：先对齐再执行，避免把 OpenClaw 当成纯执行器 */
const BOARD_COLLAB_CONTRACT = [
  "---",
  "board_collaboration_contract (mandatory, zh):",
  "- 本次是 **RDKClaw ↔ OpenClaw 协作**，不是单向派单。先给出 **[板端·对齐]**：你对目标/约束/验收的理解、主要风险、推荐路径（A/B 或取舍理由）。",
  "- 若信息不足，先在 **[板端·对齐]** 里点名缺口并请求补充；需要联网/文档/策略判断时，优先用 [NEED_RDKCLAW] 请求 RDKClaw 支援。",
  "- 执行阶段保持可见：对每个关键步骤输出「做什么→得到什么→下一步为什么」。",
  "- 若你判断 RDKClaw 本地更快闭环（已给出可直跑命令、仅 1-2 步），请明确建议回切本地快路径，不要机械继续板端承接。",
].join("\n");

const DELEGATE_STALL_CHECK_MS = 10_000;
const DELEGATE_STALL_FIRST_ALERT_MS = 25_000;
const DELEGATE_STALL_REPEAT_MS = 30_000;
const DELEGATE_MAX_EXECUTION_MS = 5 * 60 * 1000;

function getBoardHealth(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; port?: number; userName: string; id?: string; password?: string },
): Promise<OpenClawHealthStatus> {
  return new Promise((resolve) => {
    manager.getHealthStatus(boardDevice, (status) => resolve(status));
  });
}

function restartGateway(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; port?: number; userName: string; id?: string; password?: string },
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

function probeBoardConnectivity(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; port?: number; userName: string; id?: string; password?: string },
): Promise<{ wifiConnected: boolean; hasDefaultRoute: boolean; raw: string }> {
  const cmd = [
    "bash -lc '",
    "WIFI=0; ",
    "if command -v nmcli >/dev/null 2>&1; then ",
    "nmcli -t -f TYPE,STATE dev status 2>/dev/null | grep -q \"^wifi:connected$\" && WIFI=1; ",
    "fi; ",
    "ROUTE=0; ip route 2>/dev/null | grep -q \"^default\" && ROUTE=1; ",
    "[ \"$WIFI\" = \"1\" ] && echo __WIFI_OK__ || echo __WIFI_DOWN__; ",
    "[ \"$ROUTE\" = \"1\" ] && echo __ROUTE_OK__ || echo __ROUTE_DOWN__'",
  ].join("");

  return new Promise((resolve) => {
    let output = "";
    manager.execCommand(
      boardDevice,
      cmd,
      (chunk) => { output += chunk; },
      (_ok) => {
        const raw = String(output || "");
        resolve({
          wifiConnected: /__WIFI_OK__/i.test(raw),
          hasDefaultRoute: /__ROUTE_OK__/i.test(raw),
          raw,
        });
      },
      { timeout: 25_000 },
    );
  });
}

function hasBoardAlignmentSection(text: string): boolean {
  return /\[板端[·.]?对齐\]/i.test(String(text || ""));
}

async function ensureBoardGatewayReady(
  manager: OpenClawDeploymentManager,
  boardDevice: { ip: string; port?: number; userName: string; id?: string; password?: string },
  onProgress?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error("操作已中止");
  const deviceId = String(boardDevice.id || "").trim();
  if (deviceId && getCachedOpenClawAiReady(deviceId) === true) {
    onProgress?.("\n[预检] 近期已确认板端 OpenClaw 就绪，跳过重复健康检测。\n");
    return;
  }

  let health = await getBoardHealth(manager, boardDevice);
  if (health.aiReady) {
    if (deviceId) setCachedOpenClawAiReady(deviceId, true);
    return;
  }

  if (health.installed && !health.gatewayRunning) {
    onProgress?.("\n[预检] 板端网关未就绪，尝试自动重启...\n");
    await restartGateway(manager, boardDevice, onProgress);
    if (signal?.aborted) throw new Error("操作已中止");
    health = await getBoardHealth(manager, boardDevice);
    if (health.aiReady) {
      if (deviceId) setCachedOpenClawAiReady(deviceId, true);
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
      "将任务交给板端 OpenClaw 与 RDKClaw 协同推进。不是把 OpenClaw 当纯执行器，而是共享上下文并共同决策路径。\n" +
      "**Studio 可见性**：板端流式输出经 **tool_progress** 推到对话里的「板端 OpenClaw」协作块；请展开该块查看实时日志。委派消息会附带 **board_visibility_contract**，要求板端用「[板端] 阶段 · …」分段说明；技能 **RDK Board Progress Reporter**（仓库 `skills/rdk-board-progress-reporter`）可装到板端强化可见性。若只见「完成」而无过程，检查折叠区或板端是否按契约输出。\n\n" +
      "规则：\n" +
      "- **前置条件（缺一可能无法工作）**：① Studio 能 **SSH 到板**（与 device_exec 同源）；② 板端 **OpenClaw Gateway 已运行**（本工具会预检，未起则尝试重启）；③ 若任务需 **apt/clawhub/云端模型 API** 等，板子还须 **能访问外网**；纯离线本地推理时③可不要求\n" +
      "- ALWAYS 在消息里提供协作上下文包（目标、约束、已验证证据、失败模式、验收标准），让 OpenClaw 先对齐再执行\n" +
      "- ALWAYS 先做 RDKClaw 本地速度评估；assess 通过不等于必须 delegate。仅当板端明显更优、强依赖板端技能/会话、或本地进入多轮试错时再委派\n" +
      "- ALWAYS 在 guidance 中注入你的分析和建议——OpenClaw 只了解板端本地状态，你的全局知识（RDK 文档、联网检索结果）对它至关重要\n" +
      "- ALWAYS 在 guidance/context 中写明：验收标准、已执行命令与关键输出、失败模式、约束条件（网络/权限/板型）\n" +
      "- ALWAYS 要求 OpenClaw 在完成后输出可复用复盘（命令链/失败信号/验收）并尽量落盘到板端 memory，帮助后续同类任务提速\n" +
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
      await ensureBoardGatewayReady(
        manager,
        boardDevice,
        (chunk) => onProgress?.(chunk, ctx.toolCallId),
        ctx.abortSignal,
      );
      const health = await getBoardHealth(manager, boardDevice);
      const net = await probeBoardConnectivity(manager, boardDevice);
      const strictAlignmentGate = Boolean(health.aiReady && net.wifiConnected);
      if (!strictAlignmentGate) {
        const reason = !health.aiReady
          ? "OpenClaw 网关未稳定就绪"
          : !net.wifiConnected
            ? "板端 WiFi 未连接"
            : "网络状态未满足";
        onProgress?.(`\n[协作门槛降级] ${reason}：本轮不强制 [板端·对齐] 成功门槛，避免任务卡死。\n`, ctx.toolCallId);
      }
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
      msgParts.push(
        "\ncollaboration_mode: RDKClaw 与 OpenClaw 协作共解（先对齐，再执行；必要时回切本地快路径）",
      );
      if (assessInject) {
        msgParts.push(`\n${assessInject}`);
      }
      if (input.guidance?.trim()) {
        const g = input.guidance.trim();
        const hasConfirmedCmd = /RDKClaw\s*已确认|已由\s*RDKClaw\s*确认|已确认.*可直接执行/i.test(g);
        msgParts.push(
          hasConfirmedCmd
            ? `\nrdkclaw_guidance (含已确认命令，可直接执行无需重复探测): ${g}`
            : `\nrdkclaw_guidance: ${g}`,
        );
      }
      if (boardSkills && boardSkills.length > 0) {
        const installed = boardSkills.map((s) =>
          `  - ${s.name}: ${s.description || "无描述"} [${s.path}]`
        ).join("\n");
        msgParts.push(`\ninstalled_skills (${boardSkills.length}):\n${installed}`);
      }
      if (useSkills) {
        msgParts.push(
          "\nhint: 优先用已装技能（含 **RDK Board Progress Reporter** 时须按其对用户可见性输出）；不够则 `find-skills` 再执行，必要时 `clawhub install <owner/slug>`。收尾一句话说明用到的技能/命令链。",
        );
      }
      msgParts.push(`\n${BOARD_COLLAB_CONTRACT}`);
      msgParts.push(`\n${BOARD_VISIBILITY_CONTRACT}`);
      msgParts.push(`\n${BOARD_LEARNING_CONTRACT}`);
      msgParts.push(
        "\n[NEED_RDKCLAW] 缺联网、文档或生态信息时，在回复中包一层（勿与正文混写）：\n" +
          "[NEED_RDKCLAW]\ntype: web_search|documentation|advisory\nquery: …\nreason: …\n[/NEED_RDKCLAW]\n" +
          "同 session 内 RDKClaw 会补发结果，你可据此继续。",
      );
      const msg = msgParts.filter(Boolean).join("\n");
      const sessionId = input.sessionId?.trim() || conversationId || `rdkclaw-board-${deviceId}-${Date.now()}`;

      const runOnce = (messageOverride?: string): Promise<{ output: string; success: boolean }> =>
        new Promise((resolve, reject) => {
          if (ctx.abortSignal?.aborted) {
            reject(new Error("操作已中止"));
            return;
          }

          let settled = false;
          const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
            if (execTimeout) { clearTimeout(execTimeout); execTimeout = null; }
            fn();
          };
          let output = "";
          let pending = "";
          let lastEmitAt = 0;
          let handle: { abort: () => void } | null = null;
          let stallTimer: ReturnType<typeof setInterval> | null = null;
          let execTimeout: ReturnType<typeof setTimeout> | null = null;
          const startAt = Date.now();
          let lastChunkAt = Date.now();

          const flushProgress = (force = false) => {
            const now = Date.now();
            if (!force && now - lastEmitAt < 100) return;
            if (!pending.trim()) return;
            const toSend = pending.length > 1200 ? pending.slice(-1200) : pending;
            pending = "";
            lastEmitAt = now;
            onProgress?.(toSend, ctx.toolCallId);
          };

          if (onProgress) {
            let firstAlertDone = false;
            stallTimer = setInterval(() => {
              if (settled) return;
              const silent = Date.now() - lastChunkAt;
              const total = Math.floor((Date.now() - startAt) / 1000);
              const threshold = firstAlertDone ? DELEGATE_STALL_REPEAT_MS : DELEGATE_STALL_FIRST_ALERT_MS;
              if (silent < threshold) return;
              firstAlertDone = true;
              lastChunkAt = Date.now();
              onProgress?.(`\n[板端 OpenClaw 正在推理中… 总计 ${total}s]\n`, ctx.toolCallId);
            }, DELEGATE_STALL_CHECK_MS);
          }

          execTimeout = setTimeout(() => {
            if (settled) return;
            try { handle?.abort(); } catch { /* ignore */ }
            const partial = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
            const fallback = partial.length > 20
              ? partial + "\n\n[RDKClaw：板端执行超时（5 分钟），以上为已收集的部分结果。建议用 device_exec 直接执行已确认命令。]"
              : "板端 OpenClaw 执行超时（5 分钟），未收到有效结果。建议用 device_exec 直接执行已确认命令，或拆分为更小的步骤。";
            settle(() => resolve({ output: fallback, success: partial.length > 20 }));
          }, DELEGATE_MAX_EXECUTION_MS);

          const onAbort = () => {
            try { handle?.abort(); } catch { /* ignore */ }
            settle(() => reject(new Error("操作已中止")));
          };
          ctx.abortSignal?.addEventListener("abort", onAbort, { once: true });

          handle = manager.sendAgentMessage(
            messageOverride && messageOverride.trim() ? messageOverride : msg,
            (chunk) => {
              if (settled) return;
              lastChunkAt = Date.now();
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
          let result = output.trim() || "板端 OpenClaw 执行完成（无文本输出）";
          if (strictAlignmentGate && !hasBoardAlignmentSection(result)) {
            onProgress?.("\n[协作门槛] 未收到 [板端·对齐]，正在要求板端先补齐对齐信息...\n", ctx.toolCallId);
            const alignPrompt = [
              "请先补齐 [板端·对齐] 段后再继续：",
              "1) 你对目标/约束/验收的理解；",
              "2) 主要风险与备选路径；",
              "3) 当前建议：继续板端执行，还是回切 RDKClaw 本地快路径（给理由）。",
            ].join("\n");
            const alignTry = await runOnce(alignPrompt);
            const merged = [result, String(alignTry.output || "").trim()].filter(Boolean).join("\n\n");
            if (!(alignTry.success && hasBoardAlignmentSection(merged))) {
              throw new Error("未收到 [板端·对齐]，本轮不判定成功。请先确认 OpenClaw 在线且板端 WiFi 已连接后重试。");
            }
            result = merged;
          }
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
          manager.destroyConnection(sshEndpointKey(boardDevice));
          if (pairOk) {
            await abortAwareDelay(DELEGATE_RETRY_DELAY_MS, ctx.abortSignal);
            attempt--;
            continue;
          }
        }
        const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
        if (cleanOutput.length > 20 && !isRetryableOpenClawBoardSendFailure(output)) {
          const partial = cleanOutput + "\n\n[注意：板端连接中途断开，以上为已收集的部分结果]";
          const need = applyNeedStreakPolicy(ctx.sessionKey, deviceId, partial, {
            phase: "delegate",
            toolCallId: ctx.toolCallId,
          });
          return need.text;
        }
        if (attempt < DELEGATE_MAX_RETRIES && isRetryableOpenClawBoardSendFailure(output)) {
          console.warn(`[board-delegate] retryable failure on attempt ${attempt + 1}, retrying in ${DELEGATE_RETRY_DELAY_MS}ms`);
          onProgress?.("\n[连接中断，正在自动重试...]\n", ctx.toolCallId);
          manager.destroyConnection(sshEndpointKey(boardDevice));
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
