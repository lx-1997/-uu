/**
 * AgentEvolver 经验注入模块
 *
 * 从 ReMe 经验管理服务检索相关经验，注入到 Agent 的 system prompt 中。
 * 这是 AgentEvolver Self-Navigating 机制在 rdstudio 在线 Agent 中的落地。
 *
 * 使用方式：
 *   在 agent.ts 的 buildSystemPrompt() 中调用 fetchExperience()
 *   将返回的经验文本追加到 system prompt 末尾
 */

const REME_URL = process.env.REME_URL || "http://127.0.0.1:8001";
const REME_TIMEOUT = 5000; // 5 秒超时，不影响主流程

export interface ExperienceConfig {
  remeUrl?: string;
  topK?: number;
  workspaceId?: string;
  enabled?: boolean;
}

const defaultConfig: Required<ExperienceConfig> = {
  remeUrl: REME_URL,
  topK: 3,
  workspaceId: "rdkstudio",
  enabled: true,
};

/**
 * 从 ReMe 检索与当前用户消息相关的设备操作经验
 */
export async function fetchExperience(
  query: string,
  config?: ExperienceConfig,
): Promise<string[]> {
  const cfg = { ...defaultConfig, ...config };
  if (!cfg.enabled) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REME_TIMEOUT);

    const resp = await fetch(`${cfg.remeUrl}/context_generator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        top_k: cfg.topK,
        workspace_id: cfg.workspaceId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) return [];

    const data = (await resp.json()) as Record<string, unknown>;
    const experiences = (data.experiences ?? data.contexts ?? []) as string[];
    return experiences.filter((e) => typeof e === "string" && e.length > 0);
  } catch {
    // ReMe 不可用时静默降级，不影响主流程
    return [];
  }
}

/**
 * 将经验格式化为可注入 system prompt 的文本块
 */
export function formatExperienceBlock(experiences: string[]): string {
  if (experiences.length === 0) return "";
  const expText = experiences.map((e, i) => `[经验 ${i + 1}] ${e}`).join("\n\n");
  return `\n\n## 相关设备操作经验（来自历史成功案例）\n${expText}\n`;
}
