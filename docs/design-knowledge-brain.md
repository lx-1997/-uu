# RDK Studio 知识沉淀系统设计方案（外脑）

> 版本: 0.1 | 日期: 2026-03-25 | 状态: 预研

---

## 1. 背景与动机

### 1.1 问题

当前 RDKClaw 的知识来源是静态的：
- 人格文件（SOUL.md, TOOLS.md, HEARTBEAT.md）由开发者手动维护
- Agent 没有自我进化能力——相同的问题永远以相同方式回答
- 社区经验（地瓜机器人论坛帖子、NodeHub 应用说明、RDK 文档）无法被 Agent 直接检索
- 用户解决的问题和产出的方案无法沉淀为可复用知识

### 1.2 目标

构建 **Harness 级知识基础设施**（借鉴 AI Harness 架构），让 RDKClaw 拥有：
1. **可检索的外脑**：Agent 能主动搜索结构化知识库获取解决方案
2. **自动沉淀**：成功的问答、解决方案、技能创建过程自动入库
3. **社区同步**：地瓜机器人社区优质帖子定期爬取并结构化存储
4. **质量分层**：区分官方文档、社区经验、自动沉淀、用户笔记的可信度
5. **远程同步接口**：预留将知识推送到云端的 API 接口

---

## 2. 架构设计

### 2.1 Harness 知识层（对齐 Agent Harness 架构）

```
┌─────────────────────────────────────────────────┐
│                   RDKClaw Agent                  │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ 对话处理  │  │ 工具执行  │  │  决策引擎    │ │
│  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘ │
│        └──────────────┼────────────────┘         │
│                       ▼                          │
│  ┌─────────────────────────────────────────────┐ │
│  │        知识检索中间件 (KnowledgeBroker)      │ │
│  │  • BM25 关键词搜索                          │ │
│  │  • 来源权重加成                              │ │
│  │  • 结果去重 & 摘要                           │ │
│  └──────────────────┬──────────────────────────┘ │
│                     ▼                            │
│  ┌──────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │ 官方 │  │ 社区经验 │  │ 自动沉淀 │  │ 用户 │ │
│  │ 文档 │  │  帖子库  │  │  解决方案 │  │ 笔记 │ │
│  └──────┘  └──────────┘  └──────────┘  └──────┘ │
└─────────────────────────────────────────────────┘
```

### 2.2 数据模型

```typescript
interface KnowledgeEntry {
  id: string;                    // 唯一标识
  title: string;                 // 标题
  content: string;               // 正文（Markdown）
  summary: string;               // AI 生成的摘要（≤200 字）
  
  // 来源分类
  source: 'official' | 'community' | 'auto' | 'user';
  sourceUrl?: string;            // 原始 URL
  sourceAuthor?: string;         // 作者
  
  // 质量元数据
  quality: 'verified' | 'reviewed' | 'raw';
  relevanceScore?: number;       // 被检索后的反馈评分 [0, 1]
  useCount: number;              // 被引用次数
  
  // 标签与索引
  tags: string[];                // 如 ['yolo', 'camera', 'rdk-x5']
  boardModels?: string[];        // 适用的板型 ['rdk-x3', 'rdk-x5']
  
  // 时间
  createdAt: number;
  updatedAt: number;
  
  // 内容哈希（去重用）
  contentHash: string;
}
```

### 2.3 来源质量分层

| 层级 | 来源 | 质量标记 | 检索权重 |
|------|------|---------|----------|
| L0 | RDK 官方文档 | verified | 1.0 |
| L1 | NodeHub/TROS 应用说明 | verified | 0.9 |
| L2 | 社区高赞帖子（≥5 赞） | reviewed | 0.7 |
| L3 | AI 自动沉淀的解决方案 | raw → reviewed | 0.5 → 0.8 |
| L4 | 用户手动添加的笔记 | raw | 0.4 |

---

## 3. 知识获取通道

### 3.1 地瓜机器人社区爬取

地瓜机器人开发者社区 (developer.d-robotics.cc/forum) 是最重要的外脑来源。

**爬取策略：**
- 定时任务：每 24 小时增量扫描新帖和热帖
- 质量筛选：仅入库 ≥5 赞 或 有官方回复的帖子
- 结构化处理：AI 提取问题描述、解决步骤、涉及硬件/软件
- 去重：通过 contentHash 避免重复入库

**入库流程：**
```
社区帖子 → 爬虫抓取 → AI 结构化摘要 → 质量评估 → 标签提取 → 入库
```

### 3.2 Agent 操作自动沉淀

**触发条件：**
- 用户明确表示"解决了"/"成功了"的会话
- 工具调用成功且用户未报告问题的多轮对话
- 技能创建并成功部署到板端的完整流程

**沉淀内容：**
```typescript
interface AutoDepositedKnowledge {
  conversationSummary: string;     // 压缩后的对话摘要
  problemDescription: string;      // AI 提取的问题描述
  solutionSteps: string[];         // 解决步骤
  toolsUsed: string[];             // 使用的工具
  boardModel?: string;             // 涉及的板型
  skillCreated?: string;           // 创建的技能名
}
```

### 3.3 用户手动笔记

通过 AI 工具提供笔记添加能力：
- `knowledge_save` 工具：用户可以让 AI 保存任何内容到知识库
- `knowledge_search` 工具：AI 在回答问题前先搜索知识库

---

## 4. 检索机制

### 4.1 KnowledgeBroker 搜索流程

```
用户问题 → 提取关键词 → BM25 搜索
                         ↓
                    来源权重加成
                         ↓
                    去重 & 排序
                         ↓
                    返回 Top-K 结果（附带摘要）
```

### 4.2 Agent 集成方式

新增两个 AI 工具：

**`knowledge_search`**
- 输入：查询文本 + 可选过滤（来源、板型、标签）
- 输出：Top 5 知识条目（标题 + 摘要 + 来源 + 质量）
- Agent 在遇到不确定问题时自动调用

**`knowledge_save`**
- 输入：标题 + 内容 + 标签
- 输出：保存确认
- 用户要求保存经验时调用

---

## 5. 云端同步接口（预留）

### 5.1 接口设计

```typescript
// 上传知识到云端
POST /api/knowledge/sync/push
Body: { entries: KnowledgeEntry[], deviceFingerprint: string }

// 从云端拉取新知识
GET  /api/knowledge/sync/pull?since=<timestamp>&tags=<csv>

// 知识反馈（引用后评分）
POST /api/knowledge/feedback
Body: { entryId: string, helpful: boolean, context?: string }
```

### 5.2 存储选型建议

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| GitHub Repo (knowledge-base) | 版本管理、PR 审核、社区可见 | 需要 Git 操作、不适合频繁更新 | 中 |
| Supabase / Postgres | 结构化查询、免费额度大 | 需要后端部署 | 高 |
| 本地 SQLite + 定期导出 | 零依赖、离线可用 | 搜索能力有限 | 作为本地缓存 |
| CloudFlare R2 + D1 | 边缘部署、CDN 加速 | 锁定 CF 生态 | 备选 |

**推荐方案：** 本地 SQLite 作为主存储 + Supabase 作为云端同步目标。

---

## 6. 实现路径

### Phase 1: 本地知识库基础（1-2 周）

- [ ] 定义 KnowledgeEntry 数据模型
- [ ] 实现本地 JSON/SQLite 存储
- [ ] 实现 BM25 搜索（复用现有 memory.ts 的搜索算法）
- [ ] 注册 `knowledge_search` 和 `knowledge_save` 两个 AI 工具
- [ ] 预置一批 RDK 官方文档摘要作为种子数据

### Phase 2: 自动沉淀（2-3 周）

- [ ] 实现对话成功检测（用户满意度信号）
- [ ] 实现自动摘要 + 结构化提取
- [ ] 接入自动沉淀流水线
- [ ] 在 Agent 回答时自动搜索知识库作为上下文增强

### Phase 3: 社区同步（3-4 周）

- [ ] 实现地瓜社区 API/爬虫接口
- [ ] AI 结构化处理流水线
- [ ] 质量评估与标签提取
- [ ] 定时增量同步

### Phase 4: 云端同步（配合 PRD-05）

- [ ] 实现 push/pull API
- [ ] 实现知识反馈机制
- [ ] 部署云端存储
- [ ] 跨设备知识共享

---

## 7. 与 Agent Harness 架构的对齐

本方案对齐 Agent Harness 的 **Perception Layer（感知层）** 和 **Memory System（记忆系统）**：

| Harness 概念 | 本方案对应 |
|-------------|-----------|
| RAG (Retrieval-Augmented Generation) | KnowledgeBroker + BM25 搜索 |
| Long-term Memory | 知识库持久化存储 |
| Sensory Normalization | 社区帖子结构化 + AI 摘要 |
| Context Offloading | 知识检索替代直接塞入 prompt |

核心理念一致：**Agent 的能力由 Harness 决定，而非仅由模型决定**。知识沉淀系统是 Harness 中"让 Agent 越用越聪明"的关键基础设施。
