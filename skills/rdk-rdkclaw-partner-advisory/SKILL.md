---
name: RDKClaw Partner Advisory
description: 供板端 OpenClaw 阅读：遇阻时如何通过 [NEED_RDKCLAW] 向 RDKClaw 征求建议。文件由 Studio 同步到板端 skills/；RDKClaw 侧不参与本技能的触发匹配。
version: 1.0.1
trigger: 商量,征求建议,同伴,RDKClaw,卡住,不确定,失败,重试,策略,风险,取舍,咨询,求助,下一步
risk: low
permissions: network
delegate_preference: collaborative
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Collaboration
enabled: false
---

# RDKClaw 同伴商量（板端 OpenClaw）

## 目的

你是板端全栈 Agent，具备独立规划与执行能力；**RDKClaw** 在 RDK Studio 侧拥有联网检索、文档、生态与上下文精编视角。你们是双规划执行的协作关系。当你**遇到问题**、**信心不足**或**需要有人一起拍板**时，应**主动**向 RDKClaw 发起商量，而不是独自反复试错到超时。

本技能与 **`rdk-reverse-consultation`** 中的 `[NEED_RDKCLAW]` 协议共用同一格式；此处强调 **「要建议、要讨论」** 的场景。

## 何时必须考虑找 RDKClaw 商量

- 同一类错误已出现 **≥2 次**，或现象与预期矛盾。
- 存在 **多种可行路径**（例如换模型 / 换依赖源 / 降级内核），需要你与 RDKClaw 对齐取舍。
- 涉及 **安全、数据丢失、升级不可逆** 的操作前，需要第二意见。
- 用户目标表述模糊，需要先澄清再执行——可请 RDKClaw 帮忙把问题拆成可执行步骤。
- 你已能部分执行，但需要 **RDKClaw 帮你补全「为什么」和「是否值得」**。

## 主动行为准则

1. **先简报再求助**：在求助块中写清「当前现象、已执行步骤、相关日志摘要（短）」。
2. **明确你要什么**：区分「只要资料」与「要 RDKClaw 给**建议/方案对比/下一步**」。
3. **不要闷头重试**：长时间重试同一命令而不说明变化，视为不良行为；应先商量或换策略。

## 结构化求助格式（与全仓协议一致）

在回复中嵌入（可多个块，但每轮不宜过多）：

```
[NEED_RDKCLAW]
type: web_search | documentation | ecosystem | analysis | advisory
query: 你需要 RDKClaw 具体做什么（检索词、问题陈述、或「请给建议」的完整问句）
reason: 板端上下文：现象、已尝试、阻塞点；若是 advisory，说明你需要「建议」而非仅链接
priority: high | medium | low
[/NEED_RDKCLAW]
```

### type 说明（重点）

| type | 用途 |
|------|------|
| `web_search` | 需要联网查命令、版本、issue |
| `documentation` | 需要官方文档段落或 API 说明 |
| `ecosystem` | 生态/技能/包注册类信息 |
| `analysis` | 请 RDKClaw 分析日志、错误栈、可行性 |
| **`advisory`** | **请 RDKClaw 基于当前上下文给出建议、取舍、推荐顺序**（例如「先 A 还是先 B」）。**不是**单纯贴 URL，而是期待一段可执行的协作意见。 |

当 `type` 为 **`advisory`** 时，`query` 建议写成完整问句，例如：「当前在 X5 上 Y 步骤失败（附现象），请建议下一步应优先检查 Z 还是 W，并说明理由。」

## RDKClaw 侧预期

RDKClaw 收到后会按需调用工具，并通过 **`board_openclaw_chat`**（或后续 delegate 上下文）把结论发回；你应在收到补充后**致谢并继续执行**，或**继续追问**（仍用本格式）。

## 与「仅反向要信息」的区别

| 场景 | 更适合 |
|------|--------|
| 缺一条安装命令、一个版本号 | `web_search` / `documentation` |
| 不知道两条路选哪条、要不要继续折腾 | **`advisory`** |
| 日志看不懂 | `analysis` |
| 既要资料又要拍板 | 一个块里 `query` 写清，或拆成两个块（先 `web_search` 再 `advisory`） |

## 限制

- 与全局策略一致：同一任务链内 **consultation 轮次不宜过多**（通常 ≤2 轮完整往返），避免循环。
- 若网关或鉴权异常，先走设备侧排障；本技能不替代 SSH/网关修复流程。
