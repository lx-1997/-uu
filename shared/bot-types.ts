/**
 * RoboBot 应用中心 & 知识空间 — 前后端共享类型
 */

// ---------------------------------------------------------------------------
//  RoboBot
// ---------------------------------------------------------------------------

export type DocPriority = "bot-first" | "rdk-first" | "merged";
export type BotVisibility = "private" | "shared";

export interface RoboBotSummary {
  id: string;
  name: string;
  icon?: string;
  description: string;
  tags: string[];
  knowledgeSpaceCount: number;
  skillCount: number;
  /** 绑定的知识空间 ID（列表接口返回，供资料库与机器人关联） */
  knowledgeSpaceIds?: string[];
  includeRdkOfficialDocs: boolean;
  docPriority: DocPriority;
}

// ---------------------------------------------------------------------------
//  Knowledge Space
// ---------------------------------------------------------------------------

export type KnowledgeSourceType = "url" | "file" | "text" | "github";
export type IndexStatus = "pending" | "indexing" | "ready" | "error";

export interface KnowledgeSpaceSummary {
  id: string;
  name: string;
  description: string;
  sourceCount: number;
  totalChunks: number;
  indexStatus: IndexStatus;
}

// ---------------------------------------------------------------------------
//  @ 引用会话状态
// ---------------------------------------------------------------------------

export interface AtRefSessionState {
  /** 当前激活的 Bot ID */
  activeBotId?: string;
  /** 当前激活的 Bot 名称（UI 展示用） */
  activeBotName?: string;
  /** 当前追加的知识空间列表 */
  activeKnowledgeSpaces: Array<{ id: string; name: string }>;
  /** 当前即时引用的 URL 列表 */
  activeUrls: string[];
}

export const DEFAULT_AT_REF_STATE: AtRefSessionState = {
  activeBotId: undefined,
  activeBotName: undefined,
  activeKnowledgeSpaces: [],
  activeUrls: [],
};
