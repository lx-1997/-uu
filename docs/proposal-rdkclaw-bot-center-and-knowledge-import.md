# RDKClaw 能力提升 & 机器人应用中心 & 知识导入 — 架构设计提案

> 日期：2026-04-06
> 状态：Draft / RFC
> 作者：RDK Studio 架构

---

## 一、现状分析

### 1.1 当前 RDKClaw 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    RDK Studio (Client)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐             │
│  │ ChatPanel │  │ Settings │  │ Attachment│             │
│  │  + Hub    │  │  Panel   │  │  Upload   │             │
│  └─────┬────┘  └────┬─────┘  └─────┬─────┘             │
│        │ WebSocket   │              │                    │
├────────┼─────────────┼──────────────┼────────────────────┤
│                    Server Layer                          │
│  ┌──────────────────────────────────────────────┐       │
│  │             RDKClawApp (app.ts)               │       │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │       │
│  │  │ Provider │ │ System   │ │ Tool Router  │  │       │
│  │  │ Registry │ │ Prompt   │ │ (40+ tools)  │  │       │
│  │  │          │ │ Layers   │ │              │  │       │
│  │  └─────────┘ └──────────┘ └──────────────┘  │       │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │       │
│  │  │ Persona │ │ RDK Doc  │ │ Skill        │  │       │
│  │  │ Store   │ │ Index    │ │ Registry     │  │       │
│  │  └─────────┘ └──────────┘ └──────────────┘  │       │
│  └──────────────────┬───────────────────────────┘       │
│                     │ Dual-Agent Protocol                │
├─────────────────────┼───────────────────────────────────┤
│                  Board (OpenClaw)                        │
│  ┌──────────────────┴──────────────────┐                │
│  │  assess → delegate → chat → report  │                │
│  │  Skills + Memory + Session Persist  │                │
│  └─────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

### 1.2 当前痛点

| 痛点 | 现状 | 影响 |
|------|------|------|
| **文档知识固定** | 仅内置 RDK 官方开发者文档索引（`rdk-doc-url-index.md`） | 无法支持第三方硬件/SDK/传感器文档 |
| **额外指令太简陋** | `extraInstructions` 为纯文本 textarea，2 行 | 无法承载结构化知识、多文档引用 |
| **知识导入缺乏入口** | 仅支持当前对话附件（图片/文件） | 无法持久化自定义知识、无法跨会话复用 |
| **无机器人概念** | 所有对话共享同一 Agent 人格 | 不同场景（X5 开发、TROS 调试、传感器集成）混用 |
| **Skill 创建门槛高** | 需要手写 SKILL.md + YAML frontmatter | 普通开发者难以快速上手 |
| **竞品差距** | 主流 AI 平台（Coze/Dify/GPTs）已有 Bot 商店 + 知识库 | 差异化不足 |

---

## 二、竞品调研参考

### 2.1 各竞品知识导入方式对比

| 平台 | 知识来源 | 接入方式 | 冲突策略 | 特色 |
|------|---------|---------|---------|------|
| **OpenAI GPTs** | 上传文件（PDF/TXT/MD）+ 网址 | 上传 → Retrieval API 索引 | 每个 GPT 独立知识库，互不干扰 | 简洁，但粒度粗 |
| **Coze (字节)** | 文件 + URL + 手动文本 + API 数据源 | 上传/爬取 → 向量化 → 知识库 | 可绑定多个知识库到单个 Bot | 多数据源，但需手动管理切片 |
| **Dify** | 文件 + URL + Notion + 自定义 API | 上传 → 自动切片 → 向量数据库 | 应用级知识库绑定 | 开源、灵活，支持自定义切片策略 |
| **Claude Projects** | 上传文件（.txt .pdf .csv 等） | 项目级上传 → 上下文注入 | 项目隔离 | 最简洁，但无向量搜索 |
| **Cursor** | @docs + @file + @web | 指令前缀引用 | 不冲突，用户主动选择 `@docs` 加载 | **最贴近开发者工作流** |

### 2.2 最佳实践提炼

1. **Cursor `@docs` 模式最适合 RDKClaw 场景** —— 开发者通过指令主动引用文档，不影响默认行为
2. **Bot/Agent 隔离是解决冲突的根本** —— 不同机器人有不同的知识上下文
3. **知识来源多元化** —— 需支持 URL/文件/文本/Notion 等多种格式
4. **按需激活 > 全量注入** —— 避免 context window 浪费

---

## 三、核心方案：RoboBot 应用中心 + 知识空间

### 3.1 顶层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RDK Studio — 新增模块                            │
│                                                                     │
│  ┌───────────────┐   ┌──────────────────┐   ┌─────────────────┐   │
│  │  RoboBot      │   │  知识空间         │   │  @引用系统       │   │
│  │  应用中心     │   │  (Knowledge Space)│   │  (@ref System)  │   │
│  │               │   │                   │   │                  │   │
│  │ • 创建机器人  │   │ • 在线链接        │   │ • @bot <name>   │   │
│  │ • 绑定知识库  │   │ • 上传文件        │   │ • @docs <name>  │   │
│  │ • 设置人格    │   │ • 粘贴文本        │   │ • @知识 <name>   │   │
│  │ • 分享/复制   │   │ • API 数据源      │   │ • @url <link>   │   │
│  └───────┬───────┘   └────────┬─────────┘   └────────┬─────────┘  │
│          │                     │                       │            │
│  ┌───────┴─────────────────────┴───────────────────────┴──────────┐│
│  │                   Knowledge Router (新增)                       ││
│  │  • 文档解析 → 切片 → 索引                                       ││
│  │  • 上下文窗口预算管理                                            ││
│  │  • RDK 默认文档 vs 用户自定义文档 优先级调度                      ││
│  │  • 相关性评分 + 动态注入                                         ││
│  └───────────────────────┬────────────────────────────────────────┘│
│                          │                                         │
│  ┌───────────────────────┴───────────────────────────────────────┐ │
│  │            RDKClawApp (现有，扩展)                              │ │
│  │  system-prompt-layers ← 新增 `knowledge_context` layer        │ │
│  │  persona-store ← 扩展为 bot-persona-store（多 persona）       │ │
│  │  tool-router ← 新增 knowledge_search / knowledge_import       │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据模型

#### 3.2.1 RoboBot（机器人）

```typescript
interface RoboBot {
  id: string;                      // UUID
  name: string;                    // 显示名称，如 "TROS 调试助手"
  icon?: string;                   // Emoji 或 URL
  description: string;             // 简短描述
  createdAt: number;
  updatedAt: number;

  // ---- 人格配置（继承 PersonaProfile + 扩展）----
  persona: {
    systemPrompt?: string;         // 自定义系统提示词（覆盖默认 SOUL.md 的部分）
    extraInstructions: string;     // 额外指令
    delegationBias: DelegationBias;
    autonomyLevel: AutonomyLevel;
    riskLevel: RiskLevel;
  };

  // ---- 知识绑定 ----
  knowledgeSpaceIds: string[];     // 绑定的知识空间 ID 列表
  skillIds: string[];              // 绑定的 Skill 列表

  // ---- 默认行为 ----
  includeRdkOfficialDocs: boolean; // 是否同时使用 RDK 官方文档（默认 true）
  docPriority: "bot-first" | "rdk-first" | "merged";  // 文档优先策略

  // ---- 可见性 ----
  visibility: "private" | "shared";   // 个人/团队可见
  tags: string[];
}
```

#### 3.2.2 Knowledge Space（知识空间）

```typescript
interface KnowledgeSpace {
  id: string;
  name: string;                    // 如 "激光雷达 SDK 文档"
  description: string;
  createdAt: number;
  updatedAt: number;

  sources: KnowledgeSource[];      // 知识来源列表
  indexStatus: "pending" | "indexing" | "ready" | "error";
  totalChunks: number;             // 总切片数
  totalTokens: number;             // 估算 token 数（用于预算管理）
}

type KnowledgeSource =
  | { type: "url";    url: string;     crawlDepth?: number; refreshInterval?: number }
  | { type: "file";   filePath: string; mimeType: string; size: number }
  | { type: "text";   title: string;   content: string }
  | { type: "github"; repo: string;    branch?: string; paths?: string[] }
  | { type: "notion"; pageId: string;  token: string }
  ;

interface KnowledgeChunk {
  id: string;
  sourceId: string;
  spaceId: string;
  content: string;                 // 原文切片
  metadata: {
    title?: string;
    url?: string;
    section?: string;
    pageNumber?: number;
  };
  embedding?: number[];            // 向量（可选，取决于是否启用向量搜索）
  keywords: string[];              // BM25 索引关键词
}
```

### 3.3 存储方案

```
~/.rdkstudio/
  ├── bots/
  │   ├── registry.json               # RoboBot 注册表
  │   ├── {bot-id}/
  │   │   ├── bot.json                 # RoboBot 配置
  │   │   └── persona-override.md      # 可选：Markdown 格式的详细人格覆盖
  │   └── ...
  ├── knowledge-spaces/
  │   ├── registry.json                # KnowledgeSpace 注册表
  │   ├── {space-id}/
  │   │   ├── space.json               # KnowledgeSpace 配置
  │   │   ├── sources/                 # 原始来源文件缓存
  │   │   │   ├── {source-hash}.html
  │   │   │   ├── {source-hash}.pdf
  │   │   │   └── ...
  │   │   ├── chunks/                  # 切片索引
  │   │   │   └── index.json           # BM25 关键词索引
  │   │   └── embeddings/              # 向量索引（可选）
  │   │       └── vectors.bin
  │   └── ...
  └── rdkclaw-persona.json             # 保持现有（默认机器人的 persona）
```

---

## 四、@引用系统（核心交互设计）

### 4.1 为什么是 @引用而不是全量注入

**核心原则：按需激活 > 全量注入**

全量注入问题：
- 自定义文档 + RDK 官方文档 = 轻易超过 context window
- LLM 对无关上下文有"注意力稀释"，影响回答质量
- 用户未必每次都需要自定义知识

@引用方式的优势：
- **零冲突**：不用时 = 不存在，不影响默认 RDK 文档行为
- **精准导入**：用户明确指定需要的知识范围
- **可组合**：`@bot TROS助手` + `@docs 激光雷达` 自由搭配
- **开发者友好**：Cursor 的 `@docs` 已经教育了开发者市场

### 4.2 @引用指令设计

```
指令格式                        | 含义                                    | 示例
---                            | ---                                     | ---
@bot <机器人名称>               | 切换到指定机器人（加载其人格+知识空间） | @bot TROS调试助手
@docs <知识空间名称>            | 当前对话追加一个知识空间               | @docs 激光雷达SDK
@url <链接>                    | 即时引用一个在线链接                    | @url https://docs.ros.org/...
@file                          | 通过选择器上传/选择本地文件             | @file（打开文件选择器）
@paste                         | 粘贴板内容作为临时知识                  | @paste（获取剪贴板）
@reset                         | 回到默认 RDKClaw（关闭当前 bot/docs）  | @reset
```

### 4.3 输入框 UI 增强

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─ 当前 Bot: 默认小地瓜 ──┐  ┌─ 已激活知识 ──────────┐   │
│  │  🥔 小地瓜 (默认)   [✕] │  │  📚 RDK 官方文档       │   │
│  └────────────────────────┘  │  📘 激光雷达SDK    [✕]  │   │
│                               └─────────────────────────┘   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ @  输入消息... (输入 @ 唤出引用菜单)                     │ │
│ │                                                         │ │
│ └──┬──────────────────────────────────────────────────┬───┘ │
│    │ 📎 附件                                    🤖 Bot│     │
│    └──────────────────────────────────────────────────┘     │
│                                                             │
│  ┌──────────── @ 引用菜单（typing @ 后弹出）──────────────┐  │
│  │  🤖 机器人                                             │  │
│  │    ├─ TROS 调试助手                                    │  │
│  │    ├─ 激光雷达集成专家                                  │  │
│  │    └─ + 新建机器人...                                   │  │
│  │  📚 知识空间                                           │  │
│  │    ├─ RDK 官方文档 (默认)                               │  │
│  │    ├─ 激光雷达 SDK 文档                                 │  │
│  │    └─ + 新建知识空间...                                  │  │
│  │  📎 即时引用                                           │  │
│  │    ├─ 粘贴 URL                                         │  │
│  │    ├─ 上传文件                                         │  │
│  │    └─ 粘贴文本                                         │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Bot 切换 vs 知识追加的区别

| 操作 | `@bot TROS助手` | `@docs 激光雷达SDK` |
|------|-----------------|---------------------|
| 改变 persona？ | ✅ 加载 Bot 专属人格 | ❌ 保持当前 persona |
| 改变 knowledge？ | ✅ 加载 Bot 绑定的知识空间 | ✅ 追加知识空间到当前会话 |
| 改变 skills？ | ✅ 加载 Bot 绑定的 skills | ❌ 不变 |
| 保持 RDK 文档？ | 取决于 Bot 的 `includeRdkOfficialDocs` | ✅ 始终保留 |
| 生命周期 | 直到 `@bot` 切换或 `@reset` | 直到 `[✕]` 移除或会话结束 |

---

## 五、RDK 官方文档 vs 自定义文档冲突解决策略

### 5.1 优先级调度矩阵

```
场景                    | RDK 官方文档 | 用户自定义文档 | 策略
──                     | ──          | ──            | ──
默认模式（无 @bot）    | ✅ 启用     | ❌ 不加载      | 现有行为不变
@bot（含 RDK 选项）    | ✅ 启用     | ✅ 启用        | merged / bot-first（Bot 配置决定）
@bot（不含 RDK 选项）  | ❌ 跳过     | ✅ 启用        | Bot 完全替代默认文档
@docs（追加）          | ✅ 保留     | ✅ 追加        | 始终 merged
纯 @url                | ✅ 保留     | 即时文档       | 临时上下文，不影响默认
```

### 5.2 Context Window 预算管理

```typescript
// 预算分配（以 128K context 为例）
const CONTEXT_BUDGET = {
  systemPromptStable:  20_000,  // persona + reasoning + tool_contracts
  rdkOfficialDocs:      8_000,  // rdk-doc-url-index hint + doc-first blocks
  userKnowledge:        30_000,  // 知识空间注入（按相关性排序取 top-K chunks）
  conversationHistory:  50_000,  // 对话历史
  tools:               15_000,  // 工具 schema
  headroom:             5_000,  // 安全余量
};

// 当同时启用 RDK 文档和用户文档时:
// 1. 先满足 systemPromptStable（不可压缩）
// 2. RDK doc hint = 固定 compact 模式（~2K tokens）
// 3. 用户知识 = 按查询相关性 top-K 填满 userKnowledge 预算
// 4. 剩余给对话历史
```

### 5.3 知识路由（Knowledge Router）

```typescript
// 新增：server/rdkclaw/knowledge-router.ts

interface KnowledgeRouterInput {
  userMessage: string;
  activeBotId?: string;           // 当前 @bot
  activeKnowledgeSpaceIds: string[]; // 当前 @docs
  instantUrls: string[];          // 当前 @url
  includeRdkOfficialDocs: boolean;
}

interface KnowledgeRouterOutput {
  rdkDocHint?: string;            // 现有 buildRdkDocHintForSystemPrompt() 输出
  rdkDocFirstBlock?: string;      // 现有 buildRdkDocFirstUserMessageHintBlock() 输出
  knowledgeChunks: {              // 相关知识切片
    spaceId: string;
    spaceName: string;
    chunks: KnowledgeChunk[];
  }[];
  totalInjectedTokens: number;
  budgetUsed: Record<string, number>;
}
```

**路由决策流程：**

```
用户输入
  │
  ├─ 检查 @bot 状态
  │   ├─ 有 @bot → 加载 Bot 的 knowledgeSpaceIds + persona
  │   └─ 无 @bot → 使用默认 persona
  │
  ├─ 收集所有激活的知识空间
  │   ├─ Bot 绑定的
  │   ├─ @docs 追加的
  │   └─ @url 即时引用的（临时空间）
  │
  ├─ 执行 RDK Doc First Intent 检测
  │   ├─ 命中且 includeRdkOfficialDocs=true → 注入 rdkDocFirstBlock
  │   └─ 未命中或 false → 跳过
  │
  ├─ 对所有激活知识空间执行检索
  │   ├─ BM25 关键词匹配
  │   ├─ （可选）向量近似搜索
  │   └─ 按相关性排序，取 top-K 直到填满预算
  │
  └─ 组装 knowledge_context layer
      → 注入 system-prompt-layers 的 dynamic 区域
```

---

## 六、知识导入系统（多元化导入方案）

### 6.1 支持的导入源

| 来源类型 | 说明 | 处理方式 | 刷新策略 |
|---------|------|---------|---------|
| **在线链接** | 文档网站 URL | `web_fetch` / `web_browser_fetch` 抓取 → 提取正文 → 切片 | 手动刷新 / 定时（可选） |
| **本地文件** | PDF/MD/TXT/DOCX/XLSX | 已有 attachment 解析能力（unpdf/mammoth/JSZip）复用 | 手动更新 |
| **粘贴文本** | 直接粘贴内容 | 直接存储 + 切片 | 手动编辑 |
| **GitHub 仓库** | repo + path 指定 | GitHub API + raw content 抓取 | 手动刷新 / webhook |
| **Notion 页面** | Notion page ID + token | Notion API 获取 blocks → 转 Markdown → 切片 | 手动刷新 |
| **RDK Skill 包** | 标准 SKILL.md | 直接作为知识注入（不切片） | 随 Skill 更新 |

### 6.2 文档处理流水线

```
原始输入
  │
  ├─ URL → web_fetch() → HTML
  ├─ PDF → unpdf → text
  ├─ DOCX → mammoth → HTML → text
  ├─ MD → 直接 text
  ├─ GitHub → API → text
  └─ Notion → API → Markdown → text
  │
  ▼
正文提取 & 清洗
  │ • 去除导航/页脚/广告
  │ • 保留代码块、表格、标题结构
  │ • 提取 metadata（title, description, URL）
  │
  ▼
智能切片（Chunking）
  │ • 按标题层级（H1/H2/H3）自然分段
  │ • 代码块保持完整（不切断中间）
  │ • 单 chunk 目标 500-1000 tokens
  │ • chunk 之间保留 50 token 重叠（避免信息丢失）
  │
  ▼
索引构建
  │ • BM25 关键词索引（轻量，本地即可）
  │ • （可选进阶）embedding 向量索引
  │
  ▼
存储到 Knowledge Space
  └─ ~/.rdkstudio/knowledge-spaces/{space-id}/
```

### 6.3 @url 即时引用流程（零配置体验）

> 这是最重要的快速体验路径——用户不用预先创建知识空间

```
用户输入: @url https://docs.ros.org/en/humble/Tutorials/xxx.html 帮我在板子上跑这个教程
  │
  ├─ 1. 识别 @url 指令，提取 URL
  ├─ 2. 调用 web_fetch() 抓取页面内容
  ├─ 3. 正文提取 + 智能切片
  ├─ 4. 创建临时知识上下文（session-scoped，不持久化）
  ├─ 5. 注入到当前对话的 knowledge_context layer
  ├─ 6. 正常走 RDKClaw 处理流程
  └─ 7. 对话结束后提示："是否将此文档保存到知识空间？"
```

---

## 七、RoboBot 应用中心 UI 设计

### 7.1 入口位置

在现有 AI Chat Hub 侧边栏新增 "机器人" tab：

```
┌─ AI Chat Hub ──────────────────────────────────┐
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌─────────┐    │
│  │ 对话  │  │ 知识  │  │ 机器人│  │ 设置    │    │
│  └──┬───┘  └──┬───┘  └──┬───┘  └────┬────┘    │
│     │         │         │            │          │
│  (现有)    (新增)     (新增)      (现有扩展)   │
└─────────────────────────────────────────────────┘
```

### 7.2 机器人列表页

```
┌─────────────────────────────────────────────┐
│  🤖 机器人应用中心                     [+ 新建]│
│─────────────────────────────────────────────│
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ 🥔 小地瓜（默认）              [默认]│   │
│  │ RDK Studio 默认助手                  │   │
│  │ 知识：RDK 官方文档                    │   │
│  │ [使用] [编辑]                         │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ 🔧 TROS 调试助手            [自定义]│   │
│  │ 专注 TROS2 节点调试和日志分析        │   │
│  │ 知识：RDK 官方文档 + TROS2 源码文档  │   │
│  │ [使用] [编辑] [分享] [删除]          │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ 📡 激光雷达专家              [自定义]│   │
│  │ 思岚/速腾激光雷达集成开发助手        │   │
│  │ 知识：雷达 SDK 文档 + ROS2 nav2      │   │
│  │ [使用] [编辑] [分享] [删除]          │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ 🖥️ OpenCV 视觉助手           [自定义]│   │
│  │ OpenCV + BPU 推理加速集成            │   │
│  │ 知识：OpenCV Docs + BPU 工具链文档   │   │
│  │ [使用] [编辑] [分享] [删除]          │   │
│  └──────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

### 7.3 机器人创建/编辑页

```
┌─────────────────────────────────────────────────┐
│  🤖 创建机器人                                   │
│─────────────────────────────────────────────────│
│                                                 │
│  机器人名称: [                               ]   │
│  图标:  [🤖] [自定义...]                         │
│  描述:  [                                    ]   │
│                                                 │
│  ── 人格配置 ──────────────────────────────────  │
│  系统提示词:                                     │
│  ┌──────────────────────────────────────────┐   │
│  │ 你是一个专注于TROS2开发的技术助手。       │   │
│  │ 熟悉ROS2 Humble、TROS2节点开发、         │   │
│  │ 话题发布/订阅、服务调用、参数配置...       │   │
│  └──────────────────────────────────────────┘   │
│  AI 内容生成: [根据描述智能生成 ▶]               │
│                                                 │
│  委派偏好:  ○ 本地优先  ● 均衡  ○ 板端优先       │
│  自主级别:  ○ 低  ● 中  ○ 高                     │
│                                                 │
│  ── 知识空间 ──────────────────────────────────  │
│  [✅] RDK 官方文档（默认启用）                    │
│  [✅] TROS2 源码文档                              │
│  [  ] 激光雷达 SDK 文档                           │
│  [+ 新建知识空间] [+ 导入知识]                    │
│                                                 │
│  ── 绑定 Skills ──────────────────────────────── │
│  [✅] rdk-developer-docs                          │
│  [✅] rdk-ros                                     │
│  [  ] rdk-board-delegate                          │
│  [+ 从 SkillHub 搜索]                             │
│                                                 │
│  文档优先策略:                                   │
│  ○ Bot 文档优先（bot-first）                      │
│  ● 融合模式（merged）← 推荐                      │
│  ○ RDK 文档优先（rdk-first）                      │
│                                                 │
│           [取消]          [保存机器人]             │
└─────────────────────────────────────────────────┘
```

### 7.4 知识空间管理页

```
┌─────────────────────────────────────────────────┐
│  📚 知识空间管理                          [+ 新建]│
│─────────────────────────────────────────────────│
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │ 📖 RDK 官方文档                  [系统]  │   │
│  │ 540+ 页面索引 · 自动更新                  │   │
│  │ 来源: developer.d-robotics.cc/rdk_doc     │   │
│  │ 状态: ✅ 已索引 · 最后更新 2026-04-05     │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │ 📘 TROS2 源码文档               [自定义] │   │
│  │ 3 来源 · 127 切片                         │   │
│  │ 来源:                                     │   │
│  │   🔗 https://developer.d-robotics...      │   │
│  │   📄 tros2-api-reference.pdf              │   │
│  │   📝 手动笔记: TROS2 调试技巧             │   │
│  │ 状态: ✅ 已索引 · 最后更新 2026-04-03     │   │
│  │ [编辑] [刷新索引] [删除]                  │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  ┌──────────────────── 新建知识空间 ──────────┐  │
│  │ 名称: [                                ]   │  │
│  │                                            │  │
│  │ 添加来源:                                  │  │
│  │ ┌────────────────────────────────────────┐ │  │
│  │ │ [🔗 在线链接] [📄 上传文件] [📝 粘贴]  │ │  │
│  │ │ [🐙 GitHub] [📓 Notion]               │ │  │
│  │ └────────────────────────────────────────┘ │  │
│  │                                            │  │
│  │ 在线链接:                                  │  │
│  │ [https://docs.slamtec.com/rplidar...    ]  │  │
│  │ 爬取深度: [1层 ▾]  自动刷新: [关闭 ▾]     │  │
│  │ [+ 添加更多链接]                           │  │
│  │                                            │  │
│  │ 已添加来源:                                │  │
│  │  ✅ https://docs.slamtec.com/rplidar/api   │  │
│  │  ✅ rplidar_ros2_package_guide.pdf          │  │
│  │                                            │  │
│  │         [取消]        [创建并开始索引]      │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## 八、System Prompt 层扩展设计

### 8.1 新增 Layer：`knowledge_context`

位于 **dynamic** 区域，在 `rdk_doc_route` 之后注入：

```typescript
// server/rdkclaw/system-prompt-layers.ts 扩展

// 新增 dynamic layer ID
const SYSTEM_PROMPT_DYNAMIC_LAYER_IDS = [
  "open_web_route",
  "rdk_doc_route",
  "knowledge_context",    // ← 新增
  "delegation_runtime",
  "device_connectivity",
  "studio_ui_hints",
  "attachments",
  "collaboration"
];

// knowledge_context layer 构建
function buildKnowledgeContextLayer(input: {
  activeBotId?: string;
  activeKnowledgeSpaceIds: string[];
  userMessage: string;
  tokenBudget: number;
}): SystemPromptLayer | null {
  // 1. 如果没有激活任何自定义知识，返回 null（不注入）
  // 2. 从 KnowledgeRouter 获取相关 chunks
  // 3. 按相关性排序，填满预算
  // 4. 格式化成结构化 Markdown 注入
}
```

### 8.2 Layer 注入格式

```markdown
## 📚 已激活知识上下文

### 知识空间: TROS2 源码文档
> 以下为与用户问题最相关的参考资料片段。引用时请注明来源。

**[来源: TROS2 API Reference, §3.2 节点生命周期]**
节点（Node）的生命周期包括：Unconfigured → Inactive → Active → Finalized...
(切片内容)

**[来源: https://developer.d-robotics.cc/tros_doc/..., §ros2 launch]**
使用 ros2 launch 启动多个节点...
(切片内容)

### 知识空间: 激光雷达 SDK 文档
**[来源: RPLidar A1 SDK Manual, §4.1 串口配置]**
默认波特率 115200, 数据位 8, 停止位 1...
(切片内容)

---
📌 注意：以上知识来源于用户自定义文档，优先级为 merged 模式。
如与 RDK 官方文档冲突，请综合判断并说明来源差异。
```

---

## 九、工具扩展

### 9.1 新增工具

| 工具名 | 功能 | 类型 |
|--------|------|------|
| `knowledge_search` | 在激活的知识空间中搜索 | Studio Tool |
| `knowledge_import_url` | 即时导入 URL 到临时知识 | Studio Tool |
| `knowledge_list_spaces` | 列出可用知识空间 | Studio Tool |
| `bot_switch` | 切换当前机器人 | Studio Tool |
| `bot_list` | 列出可用机器人 | Studio Tool |

### 9.2 `knowledge_search` 工具定义

```typescript
{
  name: "knowledge_search",
  description: "在用户已激活的知识空间中搜索相关文档片段。在用户提问涉及自定义文档时自动使用。",
  parameters: {
    query: { type: "string", description: "搜索关键词或自然语言查询" },
    spaceIds: { type: "array", items: { type: "string" }, description: "限定搜索范围（可选）" },
    topK: { type: "number", description: "返回前 K 个最相关结果，默认 5" },
  }
}
```

---

## 十、实现计划与优先级

### Phase 1: 基础能力（MVP，2-3 周）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | **@url 即时引用** | 最小成本实现最大价值；复用现有 `web_fetch`；零配置 |
| P0 | **知识空间基础** | 本地文件存储 + BM25 切片索引 + 简单搜索 |
| P0 | **knowledge_context layer** | system-prompt-layers 新增 dynamic layer |
| P1 | **输入框 @ 引用菜单** | 输入 `@` 弹出智能菜单 |
| P1 | **知识空间管理 UI** | 新建/编辑/删除 知识空间 |

### Phase 2: 机器人中心（3-4 周）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | **RoboBot 数据模型** | bot.json + registry 存储 |
| P0 | **Bot 创建/编辑 UI** | 人格 + 知识绑定 + Skills 绑定 |
| P0 | **@bot 切换逻辑** | persona-store 扩展 + prompt layer 动态切换 |
| P1 | **Bot 列表页** | 展示 + 搜索 + 标签筛选 |
| P1 | **AI 生成系统提示词** | 根据描述自动生成 Bot persona |

### Phase 3: 深度增强（4-6 周）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | **多来源导入** | GitHub / Notion / API 数据源 |
| P1 | **向量搜索** | embedding + ANN 索引（提升搜索质量） |
| P2 | **Bot 分享/导入** | 导出为 JSON/YAML → 其他用户一键导入 |
| P2 | **知识空间自动刷新** | 定时爬取 URL 更新 |
| P2 | **Bot 商店（社区）** | 用户发布 Bot 到 ClawhHub |
| P3 | **多 Bot 协作** | 一次对话可引用多个 Bot 的能力 |

---

## 十一、与现有系统的兼容性保证

### 11.1 核心原则：**向后兼容，渐进增强**

| 保证项 | 说明 |
|--------|------|
| **默认行为不变** | 不创建任何 Bot / 知识空间时，体验与当前完全一致 |
| **RDK 文档不降级** | 官方文档始终作为 "系统知识空间" 存在，即使切换 Bot 也默认可用 |
| **extraInstructions 保留** | 现有 `extraInstructions` 机制保留，作为 "默认 Bot" 的额外指令 |
| **现有 Skill 体系兼容** | Bot 的 `skillIds` 只是过滤器，不替换 find_skills 机制 |
| **文件结构无冲突** | 新增 `bots/` 和 `knowledge-spaces/` 目录，不影响现有 `rdkclaw-persona.json` |

### 11.2 额外指令的演进路径

```
现在:   extraInstructions (纯文本, 2 行)
  │
  ▼  Phase 1
增强:   extraInstructions (多行 + Markdown 支持 + @url 引用)
  │
  ▼  Phase 2
演进:   默认 Bot 的 persona.systemPrompt + 知识空间绑定
        （extraInstructions 作为快捷入口保留）
  │
  ▼  Phase 3
成熟:   多 Bot 体系，每个 Bot 有独立完整配置
        extraInstructions = 当前会话的临时覆盖指令
```

---

## 十二、技术实现要点

### 12.1 BM25 本地索引（Phase 1 轻量方案）

```typescript
// server/rdkclaw/knowledge/bm25-index.ts

interface BM25Index {
  // 参数
  k1: 1.5;      // 词频饱和度
  b: 0.75;       // 文档长度归一化

  // 索引
  documents: Map<string, { content: string; tokens: string[]; metadata: ChunkMetadata }>;
  invertedIndex: Map<string, Set<string>>;     // term → doc_ids
  docLengths: Map<string, number>;              // doc_id → token count
  avgDocLength: number;

  // 方法
  addDocument(id: string, content: string, metadata: ChunkMetadata): void;
  search(query: string, topK?: number): SearchResult[];
  removeDocument(id: string): void;
}
```

**优势：** 纯本地运算，无需外部向量数据库，启动快，依赖少。
**OpenClaw mini 已有类似实现**（`openclaw-mini-main/src/memory.ts`），可复用其 BM25 评分逻辑。

### 12.2 文档切片策略

```typescript
// server/rdkclaw/knowledge/chunker.ts

interface ChunkOptions {
  maxTokens: 800;           // 单 chunk 最大 token
  overlapTokens: 50;        // chunk 间重叠 token
  respectHeadings: true;    // H1/H2/H3 断点优先
  keepCodeBlocks: true;     // 代码块不截断
  keepTables: true;         // 表格不截断
}

function chunkDocument(text: string, options: ChunkOptions): Chunk[] {
  // 1. 按 H1/H2/H3 标题分段
  // 2. 超长段落按句子粒度继续分
  // 3. 代码块/表格作为原子单元（不分割）
  // 4. 添加 overlap 确保上下文连续性
}
```

### 12.3 知识空间与 PersonaStore 的关系

```
PersonaStore (现有)
  │
  ├─ 保持不变：默认 persona 仍存储在 rdkclaw-persona.json
  │
  └─ 扩展：当 activeBotId 不为空时
     │
     ├─ 从 BotStore 读取 Bot 配置
     ├─ Bot.persona 覆盖 / 合并默认 persona
     └─ Bot.knowledgeSpaceIds 注入到 KnowledgeRouter
```

---

## 十三、特色差异化

### 为什么这不是另一个 GPTs / Coze？

| 维度 | GPTs / Coze | RDKClaw RoboBot |
|------|-------------|-----------------|
| **领域** | 通用对话 | **嵌入式开发 + 硬件操控** |
| **执行力** | 只能对话 | **SSH 执行 + 板端 Agent 协作** |
| **知识验证** | 无法验证知识正确性 | **可以直接在板端执行验证** |
| **Skill 联动** | 无 Skill 概念 | **Bot 绑定 Skill → 板端自动化** |
| **双 Agent** | 无 | **RDKClaw + OpenClaw 协作** |
| **场景** | 聊天 | **开发者文档 → 代码 → 部署 → 调试 全链路** |

**核心差异化场景：**

> 用户创建 "激光雷达集成专家" Bot → 绑定雷达 SDK 文档知识空间 → 在对话中 `@bot 激光雷达集成专家`
> → 用户说 "帮我在 X5 上跑激光雷达 SLAM"
> → RDKClaw 检索雷达 SDK 文档获取配置方法
> → 同时检索 RDK 官方文档获取 ROS2 nav2 配置
> → delegate 到板端 OpenClaw 执行安装、配置、启动
> → 实时反馈结果，验证节点是否正常发布 scan topic

**这是其他平台做不到的：从知识到执行的完整闭环。**

---

## 十四、开放问题

1. **向量索引方案选择** — Phase 3 是否引入 SQLite-vec / hnswlib / 调用远端 embedding API？
2. **Bot 分享格式** — JSON 还是 YAML？是否包含知识空间数据（体积考虑）？
3. **知识空间大小限制** — 单个空间最多多少来源 / 多少 chunks？需要基于 context window 限制反推。
4. **Board 知识同步** — Bot 的知识空间是否需要同步到板端 OpenClaw？还是仅在 RDKClaw 侧检索？
5. **多用户隔离** — 团队场景下 Bot 和知识空间的权限模型如何设计？
6. **计费** — 知识空间索引是否消耗额外资源？向量 embedding 是否产生 API 调用费用？

---

## 附录 A：相关文件参考

| 文件 | 关联 |
|------|------|
| [server/rdkclaw/app.ts](server/rdkclaw/app.ts) | 主编排器，工具注册 |
| [server/rdkclaw/system-prompt-layers.ts](server/rdkclaw/system-prompt-layers.ts) | Prompt 层组合 |
| [server/rdkclaw/system-prompt-builder.ts](server/rdkclaw/system-prompt-builder.ts) | 各层内容构建 |
| [server/rdkclaw/persona-store.ts](server/rdkclaw/persona-store.ts) | Persona 存储 |
| [server/rdkclaw/rdk-doc-url-index.ts](server/rdkclaw/rdk-doc-url-index.ts) | RDK 文档索引 |
| [server/rdkclaw/rdk-doc-first-intent.ts](server/rdkclaw/rdk-doc-first-intent.ts) | 文档优先意图检测 |
| [server/rdkclaw/board-dual-agent-orchestration.ts](server/rdkclaw/board-dual-agent-orchestration.ts) | 双 Agent 协调 |
| [server/rdkclaw/skills/registry.ts](server/rdkclaw/skills/registry.ts) | Skill 注册中心 |
| [openclaw-mini-main/src/memory.ts](openclaw-mini-main/src/memory.ts) | BM25 内存搜索（可复用） |
| [openclaw-mini-main/src/skills.ts](openclaw-mini-main/src/skills.ts) | Skill 加载机制 |
| [src/components/AiChatHubPage.tsx](src/components/AiChatHubPage.tsx) | Chat Hub UI 入口 |
| [src/components/SettingsPanel.tsx](src/components/SettingsPanel.tsx) | 设置面板 |
| [skills/rdk-skill-authoring-guide/SKILL.md](skills/rdk-skill-authoring-guide/SKILL.md) | Skill 创建指南 |
