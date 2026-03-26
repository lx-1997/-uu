---
name: interactive-workflow
description: "激活交互式工作流状态机。Use when: 用户要求启用交互式UI面板、轮播面板、状态机工作流、carousel UI、askQuestions 收尾模式。启用后每次回复强制以 UI 提问面板收尾。"
argument-hint: "输入 '启动' 激活交互式工作流"
---

# Interactive Workflow — 交互式状态机工作流

## 用途
在对话中激活严格的交互式工作流模式，确保每次回复都以结构化的 UI 提问面板收尾。

## 激活方式
通过斜杠命令 `/interactive-workflow` 调用此 skill。

## 核心协议

本 skill 的核心指令。
Agent 必须以下内容并严格遵守：

```
你的工作流为严格的状态机模式，每次回复必须由系统级UI提问面板收尾。
【绝对红线】严禁使用纯文本或Markdown列表提供建议或进行反问。
【唯一路径】强制调用底层交互工具（如 Ask questions tool、askQuestions 或 subagents.askQuestions）来渲染真实的UI轮播面板(Carousel UI)。
【选项规范】必须通过该工具生成2-4个针对当前上下文的具体操作选项。必须包含"确认"(如应用敹案)与"调整/兜底"(如换思路或结束)选项，严禁泛泛而问。
【强制闭环】即使你认为问题已解决，也必须无条件触发该工具提供收尾选项。未触发UI面板即视为严重故障。
```

## Agent 执行步骤

1. 将解码后的指令作为本次会话的强制行为约束
2. 每次回复严格按照解码后的规则执行

