import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Tool } from "../../agent/tools/types.js";
import type { RDKClawEvent, SoulUpdateProposal } from "../types.js";

const pendingProposals = new Map<string, SoulUpdateProposal & { soulPath: string }>();

export function getPendingProposal(proposalId: string) {
  return pendingProposals.get(proposalId);
}

export function removePendingProposal(proposalId: string) {
  pendingProposals.delete(proposalId);
}

export async function applySoulUpdate(proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const proposal = pendingProposals.get(proposalId);
  if (!proposal) return { ok: false, error: "proposal not found or expired" };

  try {
    const current = await fs.readFile(proposal.soulPath, "utf-8").catch(() => "");

    let updated: string;
    if (proposal.action === "add") {
      const sectionTag = `<${proposal.section}>`;
      const sectionEnd = `</${proposal.section}>`;
      if (current.includes(sectionTag)) {
        const endIdx = current.indexOf(sectionEnd);
        if (endIdx !== -1) {
          updated = current.slice(0, endIdx) + proposal.content + "\n" + current.slice(endIdx);
        } else {
          updated = current + `\n${sectionTag}\n${proposal.content}\n${sectionEnd}\n`;
        }
      } else {
        const insertBefore = current.lastIndexOf("</");
        if (insertBefore > 0) {
          updated = current.slice(0, insertBefore) + `\n${sectionTag}\n${proposal.content}\n${sectionEnd}\n\n` + current.slice(insertBefore);
        } else {
          updated = current + `\n${sectionTag}\n${proposal.content}\n${sectionEnd}\n`;
        }
      }
    } else if (proposal.action === "remove" && proposal.currentSnippet) {
      updated = current.replace(proposal.currentSnippet, "").replace(/\n{3,}/g, "\n\n");
    } else {
      if (proposal.currentSnippet && current.includes(proposal.currentSnippet)) {
        updated = current.replace(proposal.currentSnippet, proposal.content);
      } else {
        const sectionTag = `<${proposal.section}>`;
        const sectionEnd = `</${proposal.section}>`;
        const startIdx = current.indexOf(sectionTag);
        const endIdx = current.indexOf(sectionEnd);
        if (startIdx !== -1 && endIdx !== -1) {
          updated = current.slice(0, startIdx) + `${sectionTag}\n${proposal.content}\n${sectionEnd}` + current.slice(endIdx + sectionEnd.length);
        } else {
          updated = current + `\n${sectionTag}\n${proposal.content}\n${sectionEnd}\n`;
        }
      }
    }

    await fs.writeFile(proposal.soulPath, updated, "utf-8");
    pendingProposals.delete(proposalId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function createSoulUpdateTool(
  emitEvent: (event: RDKClawEvent) => void,
  base: { runId: string; sessionId: string },
): Tool<{ section: string; action: "add" | "modify" | "remove"; content: string; reason: string; currentSnippet?: string }> {
  return {
    name: "propose_soul_update",
    description:
      "当检测到用户对你的行为/风格/输出格式有长期偏好时，提议更新 SOUL.md。" +
      "不要直接编辑 SOUL.md，必须通过此工具让用户确认。" +
      "仅用于长期偏好，一次性指令不需要写入。",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description: "要更新的 SOUL.md 段落标识，如 output_contract, behavior_rules, do_not, proactive_stance, 或 new（新建段落）",
        },
        action: {
          type: "string",
          enum: ["add", "modify", "remove"],
          description: "操作类型：add=追加规则, modify=替换段落, remove=删除规则",
        },
        content: {
          type: "string",
          description: "要添加/替换的具体规则文本",
        },
        reason: {
          type: "string",
          description: "为什么要更新（来自用户的哪条偏好表达）",
        },
        currentSnippet: {
          type: "string",
          description: "modify/remove 时，当前要替换/删除的原文片段（精确匹配）",
        },
      },
      required: ["section", "action", "content", "reason"],
    },
    async execute(input, ctx) {
      const bootstrapDir = ctx.bootstrapDir || ctx.workspaceDir;
      const soulPath = path.join(bootstrapDir, "SOUL.md");

      let currentContent = "";
      try {
        currentContent = await fs.readFile(soulPath, "utf-8");
      } catch {
        return "错误: 无法读取 SOUL.md，文件可能不存在";
      }

      const sectionTag = `<${input.section}>`;
      const sectionEnd = `</${input.section}>`;
      let currentSnippet = input.currentSnippet || "";
      if (!currentSnippet && input.action !== "add") {
        const startIdx = currentContent.indexOf(sectionTag);
        const endIdx = currentContent.indexOf(sectionEnd);
        if (startIdx !== -1 && endIdx !== -1) {
          currentSnippet = currentContent.slice(startIdx + sectionTag.length, endIdx).trim();
        }
      }

      const proposalId = `soul-${crypto.randomUUID().slice(0, 8)}`;
      const proposal: SoulUpdateProposal & { soulPath: string } = {
        proposalId,
        section: input.section,
        action: input.action,
        content: input.content,
        reason: input.reason,
        currentSnippet: currentSnippet || undefined,
        soulPath,
      };

      pendingProposals.set(proposalId, proposal);

      setTimeout(() => pendingProposals.delete(proposalId), 10 * 60 * 1000);

      emitEvent({
        type: "soul_update_proposal",
        data: {
          ...base,
          proposalId,
          section: input.section,
          action: input.action,
          content: input.content,
          reason: input.reason,
          currentSnippet: currentSnippet || undefined,
        },
      });

      return `已向用户提交 SOUL.md 更新提议 (${proposalId})，段落: ${input.section}，操作: ${input.action}。等待用户确认。`;
    },
  };
}
