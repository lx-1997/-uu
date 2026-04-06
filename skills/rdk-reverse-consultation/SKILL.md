---
name: RDK Reverse Consultation Protocol
description: 当板端 OpenClaw 在执行任务中需要 RDKClaw 的专属能力（联网搜索、文档查找、生态知识）时，教会 OpenClaw 以结构化格式发出求助信号，RDKClaw 会在后续消息中补充所需信息。
version: 1.0.1
trigger: 反向通道,求助,consultation,需要搜索,需要文档,OpenClaw请求帮助,NEED_RDKCLAW,advisory
risk: low
permissions: network
delegate_preference: hybrid
requires_board: false
approval_level: none
cooldown_seconds: 0
category: Collaboration
---

# RDK Reverse Consultation Protocol

## 背景

RDKClaw 和 OpenClaw 都是规划 + 执行的全栈 Agent，各有优势域：RDKClaw 有联网搜索、文档分析、生态知识库、上下文精编等能力，OpenClaw 有板端规划决策、硬件操控、本地技能、实时异常处理等能力。当 OpenClaw 在执行板端任务时发现需要 RDKClaw 才有的信息（如网上的安装命令、官方文档链接、最佳实践），它无法自己获取。

本技能定义了 OpenClaw 向 RDKClaw 发出结构化求助的协议，使得 RDKClaw 能自动检测并补充所需信息。

## 协议格式

当 OpenClaw 需要 RDKClaw 的帮助时，在回复中包含以下结构化块：

```
[NEED_RDKCLAW]
type: web_search | documentation | ecosystem | analysis | advisory
query: 具体需要查找或分析的内容（advisory 时可写完整「请给建议」的问句）
reason: 为什么需要这个信息
priority: high | medium | low
[/NEED_RDKCLAW]
```

### type 说明
- `web_search`：需要联网搜索最新信息（安装命令、版本号、Bug 修复方案等）
- `documentation`：需要查找 RDK 官方文档或第三方文档
- `ecosystem`：需要查询生态技能注册表中的能力信息
- `analysis`：需要 RDKClaw 分析某段日志、错误信息或方案可行性
- `advisory`：需要 RDKClaw **基于上下文给建议、取舍、下一步**（不仅是链接）；板端遇阻、多方案选一、需第二意见时使用。详见技能 **`rdk-rdkclaw-partner-advisory`**。

## RDKClaw 侧处理流程

1. **检测**：RDKClaw 在收到 delegate 或 chat 的返回后，扫描是否包含 `[NEED_RDKCLAW]` 块
2. **提取**：解析 type、query、reason、priority
3. **执行**：
   - `web_search` → 调用 web_search 工具
   - `documentation` → 调用 web_fetch 拉取页面
   - `ecosystem` → 调用 web_search / web_fetch；板端清单用 board_openclaw_chat 或 assess
   - `analysis` → RDKClaw 自身分析并给出结论
4. **回传**：通过 board_openclaw_chat 将结果发回给 OpenClaw
5. **继续**：OpenClaw 收到补充信息后继续执行原任务

## 注入方式

RDKClaw 在 delegate 时，在 guidance 末尾附加以下说明：

```
如果你在执行过程中需要联网搜索、查文档、查生态能力等信息（这些是我 RDKClaw 的能力，你无法直接获取），
请在回复中用 [NEED_RDKCLAW]...[/NEED_RDKCLAW] 格式告诉我你需要什么，我会在后续消息中补充给你。
```

## 适用场景

- OpenClaw 需要安装某个包但不确定版本号或安装命令
- OpenClaw 遇到错误但不知道官方推荐的修复方案
- OpenClaw 需要对比多个技术路线但缺少全局视角
- OpenClaw 需要确认某个操作的安全性或最佳实践

## 限制

- 每次 delegate 最多触发 10 轮 consultation，避免无限循环
- 仅在 delegate 和 chat 的返回结果中检测，不在 assess 中检测
- OpenClaw 不保证总是使用此协议（取决于其模型能力），RDKClaw 应同时主动分析返回结果中的隐性求助信号
