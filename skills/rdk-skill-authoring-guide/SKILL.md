---
name: Skill Manager
description: 创建、总结、优化 RDKClaw 技能（SKILL.md）。在用户要新技能、沉淀重复流程、或审查技能质量时激活；生成内容对齐 ClawHub/OpenClaw 与 create-skill 的高质量要求（description 可检索、步骤可执行、含示例与失败路径）。
version: 2.1.0
trigger: 创建技能,新技能,skill create,写技能,总结技能,技能管理,优化技能,技能规范,skill模板,技能中心,技能审查,skill review
risk: low
permissions: workspace_read,workspace_write
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Meta
---

# Skill Manager — 技能创建与管理

## 零、开发者如何扩展 RDKClaw 技能

### 技能存储位置
RDKClaw 从以下目录加载技能（优先级从高到低）：
1. **用户工作区**：`~/.rdkstudio/rdkclaw-workspaces/<user-id>/skills/` — 用户自定义技能，最高优先级
2. **应用内置**：安装目录下 `skills/` — 随应用发布的预置技能
3. **仓库根**：`{workspaceDir}/skills/` — 开发模式下的仓库技能

### 桌面版用户扩展技能
1. 打开用户目录 `~/.rdkstudio/rdkclaw-workspaces/<your-id>/skills/`
2. 创建子目录如 `my-custom-skill/`
3. 在子目录内创建 `SKILL.md`，按下方模板填写
4. 重启会话即可生效（技能缓存 3 秒自动刷新）

### 通过对话扩展技能
直接告诉 RDKClaw "帮我创建一个技能：[描述]"，RDKClaw 会自动：
- 在用户工作区的 `skills/` 目录下创建新技能
- 生成符合规范的 SKILL.md
- 立即可用于后续对话

### 技能热加载
- 技能注册表每 3 秒检查一次变更
- 新增/修改/删除 SKILL.md 后无需重启应用
- 用户工作区的技能会覆盖同名内置技能

## 一、创建新技能

### 触发条件
- 用户明确要求"创建一个技能"
- 发现某个操作流程反复出现 3 次以上
- 用户描述了一个标准化的工作场景

### 创建流程（建议按阶段执行）

**阶段 A · 需求（对齐 ClawHub「先想清楚再写」）**
1. **边界**：一句话——在什么用户意图下、完成什么结果、不做什么。
2. **触发**：用户口语里会怎么说（中英文关键词），写入 `trigger`。
3. **产出物**：对话结束必须交付什么（表格、命令、文件路径、确认项）。
4. **失败与降级**：无设备 / 无网络 / 用户拒绝时怎么办。

**阶段 B · 命名与元数据**
5. **name**：kebab-case，能看出领域，避免 `helper` / `utils`。
6. **description**：见下文「description 规范」——这是检索与路由的灵魂。
7. **风险与权限**：按实际副作用填 `risk`、`permissions`，最小必要。

**阶段 C · 正文（可执行）**
8. **执行流程**：3–10 步；**每一步**要么对应**具体工具名**，要么对应**可验证的用户动作**（禁止「根据需要处理」类空话）。
9. **工具映射表**：与 RDKClaw 当前工具列表一致；过时工具必须替换。
10. **可选**：复杂长文放到同目录 `reference.md`，SKILL.md 只保留要点与链接（渐进式披露）。

**阶段 D · 落盘**
11. 写入 `skills/rdk-{name}/SKILL.md`（或用户工作区 `skills/` 下同名目录）。

### description 规范（第三人称 + WHAT + WHEN）

`description` 会进入系统提示，用于**判断是否加载本技能**。应对照 ClawHub / OpenClaw 习惯：

- 用**第三人称**写能力，不用「我」「你可以」。
- **WHAT**：具体能做什么（能力列表，忌「帮助处理各种问题」）。
- **WHEN**：何时应激活——领域词、对象词、用户说法（如 NodeHub、烧录、delegate）。
- **忌**：过短、无触发词、与别的技能无法区分。

示例（坏 → 好）：
- 坏：`帮助用户做开发`
- 好：`指导在 RDK 设备上拉取 NodeHub 项目、核对依赖并用 device_exec 执行官方安装步骤。在用户提到 NodeHub、地瓜示例、官方项目或给出版块 URL 时激活。`

### 高质量正文原则（对齐 create-skill / ClawHub）

1. **写给 Agent，不是科普**：默认模型已具备通用知识；只写**本仓库/本设备/本工作流**特有的约束、路径、命令、顺序。**删掉**可 Google 到的长篇背景。
2. **简洁**：主 SKILL.md 宜 **≤500 行**；细节进 `reference.md`。
3. **自由度与任务脆弱度匹配**：
   - 高自由度：多策略可行时给**原则 + 检查点**。
   - 低自由度：易错操作给**逐步命令、可复制模板、失败时重试/中止**。
4. **至少一个具体示例**：输入情境 → 期望 Agent 行为（或输出片段），避免只有抽象条目。
5. **术语一致**：同一概念全程同一叫法（如始终用「板端」或始终用 `device_exec`，勿混用无说明）。

### SKILL.md 模板

```markdown
---
name: 技能名称
description: 第三人称；写清能力与触发场景（WHAT + WHEN），含领域关键词
version: 1.0.0
trigger: 关键词1,关键词2,keyword1,keyword2
risk: low|medium|high
permissions: workspace_read,device_exec
delegate_preference: local|board|hybrid|collaborative
requires_board: true|false
approval_level: none|auto|confirm
cooldown_seconds: 0
scheduler_template: none
category: 分类名
---

# 技能标题

## 适用场景
- 具体场景描述

## 执行流程
1. 步骤（对应工具或明确动作）
2. 步骤（对应工具或明确动作）
3. ...

## 工具映射
| 工具 | 用途 | 必需 |
|------|------|------|
| tool_name | 干什么 | 是/否 |

## 输出要求
- 必须产出的内容

## 示例（推荐至少一条）
**情境**：用户说了什么 / 提供了什么  
**期望**：Agent 应执行的步骤摘要或输出要点

## 失败与降级
- 无设备 / 无网络 / 工具报错时如何处理

## 禁止事项
- 不可以做的事
```

### Frontmatter 必填字段（12 项）
name, description, version, trigger, risk, permissions, delegate_preference, requires_board, approval_level, cooldown_seconds, scheduler_template, category

### 低质量信号（反模式，生成时必须避免）

- description 空洞、无触发词，或与现有技能重复。
- 流程里大量「分析」「优化」「处理」而无工具名或命令。
- 一次给出过多可选工具却不指定**默认路径**与**例外路径**。
- 正文科普化、篇幅长而**无可执行步骤**。
- Windows 风格路径 `skills\foo`（应使用 `skills/foo`）。

### 质量检查清单（发布前逐项打勾）

**可发现性**
- [ ] `description` 为第三人称，且同时包含 **WHAT** 与 **WHEN**（触发词）
- [ ] `trigger` 覆盖用户可能的中英文说法

**可执行性**
- [ ] 每步流程对应**具体工具**或**可验证动作**
- [ ] 工具映射与当前 RDKClaw 工具列表一致
- [ ] 含**至少一条**情境示例或输出模板

**健壮性**
- [ ] 写清**失败/降级**路径（非空话）
- [ ] `禁止事项` 有实际约束力
- [ ] 术语全文一致

**体量**
- [ ] 主 SKILL.md 篇幅可控；长参考已拆分或计划拆分

## 二、总结已有技能

### 触发条件
- 用户要求"总结一下现有技能"
- 需要了解当前技能覆盖范围

### 总结流程

1. 扫描 `skills/` 目录，列出所有 SKILL.md
2. 读取每个技能的 frontmatter（name、description、trigger、category、risk）
3. 按 category 分组汇总
4. 标注覆盖空白（哪些常见场景还没有对应技能）
5. 输出技能全景表

### 输出格式

```
## 技能全景（共 N 个）

### 分类: DevOps（N个）
| 技能 | 说明 | 风险 | 需要板端 |
|------|------|------|----------|
| name | desc | risk | yes/no   |

### 覆盖空白
- 场景 X 尚无对应技能，建议创建
```

## 三、优化已有技能

### 触发条件
- 用户反馈某个技能不好用
- 发现技能的流程过时（工具已更新、流程可简化）
- 技能的 trigger 关键词覆盖不足

### 优化流程

1. 读取目标技能的 SKILL.md
2. 对照当前工具列表检查工具映射是否过时
3. 检查 trigger 是否覆盖了用户常用的说法
4. 检查执行流程是否有可简化的步骤
5. 提出修改建议，确认后写入

## 禁止事项
- 不创建没有 trigger 的技能（加载器无法匹配）
- 不省略 frontmatter 的 12 个必填字段
- 不写空洞的执行流程（每步必须对应工具或明确动作）
- 不自作主张删除技能（需用户确认）
