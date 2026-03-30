---
name: SkillHub Discovery
description: 当当前对话需要某类自动化/集成能力时，主动用 SkillHub（ClawHub 生态）检索是否已有可安装技能，并给出 slug 与摘要。触发：找技能、SkillHub、社区技能、有没有现成 skill、能否装一个 xxx 技能、clawhub。
version: 1.0.0
trigger: SkillHub,技能检索,社区技能,clawhub,现成技能,安装技能,找技能,有没有技能,skill 推荐,技能推荐,OpenClaw 技能
risk: low
permissions: network
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Meta
---

# SkillHub 技能发现

## 何时主动使用

在**不重复打扰用户**的前提下，当满足以下任一情况时，**优先调用 `skillhub_search`** 再回答：

1. 用户明确想「找技能 / 装技能 / SkillHub / clawhub」。
2. 用户描述的目标明显可通过**现成 OpenClaw 技能包**完成（例如：天气、搜索、PDF、Obsidian、浏览器自动化、IM 等），而你尚未确认是否存在社区方案。
3. 对话陷入「缺工具 / 要自己写脚本」时，**先检索一次**是否有现成技能可缩短路径。

若用户仅做闲聊、或问题明显与技能生态无关，**不必**例行调用。

## 检索策略

1. **提炼查询词**：用 1～3 个英文或中文关键词概括用户目标（例：`weather`、`百度`、`pdf edit`、`obsidian`）。避免整段对话复制进 `query`。
2. **调用工具**：`skillhub_search`，`limit` 建议 8～15。
3. **解读结果**：按 `score` 或相关性向用户展示 **前若干条**，每条包含：**slug**、**displayName**、**summary**、**version**（若有）。
4. **无结果时**：缩小或改写关键词再搜一次；仍无则如实说明，并回到 `web_search` / 设备能力等其它路径。

## 安装与后续（说明即可，勿虚构已安装）

- **板端**：若已连接设备且用户同意，可说明使用 `board_openclaw_skill_install`，技能 ID 一般为 `owner/slug`（与注册表一致）；需板端已装 `clawhub` CLI。
- **本机 Studio**：用户可在 **技能工坊 → SkillHub** 搜索同名技能并「写入本地 RDKClaw」或「部署到板端」。
- **不要**在未调用工具且未获用户确认时声称「已安装」。

## 输出要求

- 先给**简短结论**（是否找到候选），再列技能列表。
- 标注信息来源：**SkillHub / ClawHub 公共注册表**（与 RDK Studio 默认镜像同源）。
- 若注册表超时或失败，说明现象并建议稍后重试或改用技能工坊手动搜索。

## 禁止

- 不要用本技能替代 `web_search` 查 D-Robotics 官方文档与硬件资料。
- 不要在高风险设备操作未确认时，仅凭技能名就建议安装。
