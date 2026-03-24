import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Tool } from "./types.js";

const PLANS_DIR = ".rdkclaw-runtime/plans";

interface PlanStep {
  id: number;
  action: string;
  tools?: string[];
  status: "pending" | "in_progress" | "done" | "failed";
}

function formatPlanMarkdown(
  title: string,
  steps: PlanStep[],
  planId: string,
): string {
  const lines = [
    `# ${title}`,
    "",
    `> Plan ID: ${planId}`,
    `> Created: ${new Date().toISOString()}`,
    "",
    "## Steps",
    "",
  ];
  for (const step of steps) {
    const marker =
      step.status === "done" ? "x" : step.status === "in_progress" ? "~" : " ";
    const toolHint = step.tools?.length ? ` (tools: ${step.tools.join(", ")})` : "";
    lines.push(`- [${marker}] **Step ${step.id}**: ${step.action}${toolHint}`);
  }
  lines.push("");
  return lines.join("\n");
}

export const createPlanTool: Tool<{
  title: string;
  steps: Array<{ action: string; tools?: string[] }>;
}> = {
  name: "create_plan",
  description:
    "为复杂任务创建结构化执行计划。当任务涉及 3+ 步骤、多个工具协同、或需要用户确认时使用。" +
    "计划保存为 Markdown 文件，可被后续工具引用。每个步骤可标注预期使用的工具名。",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "计划标题" },
      steps: {
        type: "array",
        description: "执行步骤列表",
        items: {
          type: "object",
          properties: {
            action: { type: "string", description: "步骤描述" },
            tools: {
              type: "array",
              items: { type: "string" },
              description: "该步骤预期使用的工具名（可选）",
            },
          },
          required: ["action"],
        },
      },
    },
    required: ["title", "steps"],
  },
  async execute(input, ctx) {
    const planId = crypto.randomUUID().slice(0, 8);
    const plansDir = path.join(ctx.workspaceDir, PLANS_DIR);
    await fs.mkdir(plansDir, { recursive: true });

    const steps: PlanStep[] = input.steps.map((s, i) => ({
      id: i + 1,
      action: s.action,
      tools: s.tools,
      status: "pending" as const,
    }));

    const markdown = formatPlanMarkdown(input.title, steps, planId);
    const filePath = path.join(plansDir, `${planId}.md`);
    await fs.writeFile(filePath, markdown, "utf-8");

    return [
      `计划已创建: ${filePath}`,
      `Plan ID: ${planId}`,
      `共 ${steps.length} 个步骤`,
      "",
      "请按照计划逐步执行。完成每步后用 update_plan 更新状态。",
    ].join("\n");
  },
};

export const updatePlanTool: Tool<{
  planId: string;
  stepId: number;
  status: "in_progress" | "done" | "failed";
  note?: string;
}> = {
  name: "update_plan",
  description: "更新执行计划中某个步骤的状态。在执行每个步骤前标记为 in_progress，完成后标记为 done。",
  inputSchema: {
    type: "object",
    properties: {
      planId: { type: "string", description: "Plan ID" },
      stepId: { type: "number", description: "步骤编号 (从 1 开始)" },
      status: {
        type: "string",
        enum: ["in_progress", "done", "failed"],
        description: "新状态",
      },
      note: { type: "string", description: "可选备注" },
    },
    required: ["planId", "stepId", "status"],
  },
  async execute(input, ctx) {
    const filePath = path.join(ctx.workspaceDir, PLANS_DIR, `${input.planId}.md`);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return `计划文件不存在: ${input.planId}`;
    }

    const statusMap: Record<string, string> = {
      pending: " ",
      in_progress: "~",
      done: "x",
      failed: "!",
    };
    const marker = statusMap[input.status] ?? " ";
    const stepPattern = new RegExp(
      `^(- \\[)[ ~x!](\\] \\*\\*Step ${input.stepId}\\*\\*:.*)$`,
      "m",
    );
    const match = content.match(stepPattern);
    if (!match) {
      return `未找到 Step ${input.stepId}`;
    }

    let updated = content.replace(stepPattern, `$1${marker}$2`);
    if (input.note) {
      updated = updated.replace(
        stepPattern,
        `$&\n  - _${input.note}_`,
      );
    }
    await fs.writeFile(filePath, updated, "utf-8");

    const doneCount = (updated.match(/- \[x\]/g) || []).length;
    const totalCount = (updated.match(/- \[[ ~x!]\]/g) || []).length;
    return `Step ${input.stepId} → ${input.status}${input.note ? ` (${input.note})` : ""} | 进度: ${doneCount}/${totalCount}`;
  },
};

export const planTools: Tool[] = [createPlanTool, updatePlanTool];
