---
name: RDK Skill Authoring Guide
description: 给技能中心沉淀“好 Skill 怎么写”的模板与质量标准，覆盖触发词、边界、流程、输出格式和安全约束。
version: 1.0.0
trigger: skill怎么写,技能规范,skill模板,技能中心,skill最佳实践
risk: low
permissions: workspace_read
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
---

# RDK Skill Authoring Guide

## 一个“好 Skill”的最小结构
1. **清晰场景**：明确“什么时候用”，避免泛化描述。
2. **可执行流程**：给出 3~6 步标准流程，能被直接照做。
3. **工具映射**：每步对应推荐工具，避免“只讲概念不讲动作”。
4. **输出合同**：明确最终必须产出哪些字段和结论。
5. **风险边界**：禁止事项写清楚，避免误操作。

## Frontmatter 建议
- `name`：短且可识别，不与现有技能重名。
- `description`：一句话说清能力边界。
- `trigger`：覆盖中英文关键词和口语表达。
- `risk`：按真实副作用分级（low/medium/high）。
- `permissions`：只申请最小必要权限。
- `delegate_preference`：local/board/hybrid 明确职责边界。

## 内容写法建议
- 用“动作句”而不是“理念句”，例如“先调用 X，再调用 Y”。
- 每条规则尽量可验证，例如“变更后必须再次检查状态”。
- 对高风险操作加二次确认要求。
- 对失败路径给降级方案，而不是仅报错。

## 质量自检清单
- 是否能在 30 秒内判断该不该用这个技能？
- 是否提供了可直接执行的工具链？
- 是否在输出中包含验证与下一步建议？
- 是否明确了禁止事项和数据脱敏要求？
