---
name: Skill Manager
description: 创建、总结、优化技能。当发现反复出现的场景需要沉淀为标准流程，或需要审查/优化已有技能时激活。覆盖技能的创建、修改、质量检查和总结归档。
version: 2.0.0
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

## 一、创建新技能

### 触发条件
- 用户明确要求"创建一个技能"
- 发现某个操作流程反复出现 3 次以上
- 用户描述了一个标准化的工作场景

### 创建流程

1. **确定技能边界**：一句话说清这个技能"在什么场景下做什么"
2. **取名和关键词**：name 简短、description 精准、trigger 覆盖中英文口语表达
3. **写执行流程**：3-8 步，每步对应具体工具调用，不写空洞描述
4. **标注工具映射**：每步用哪个工具、是否必须
5. **定义输出合同**：执行完成后必须产出什么
6. **设置风险和权限**：risk 按实际副作用分级，permissions 只申请最小必要
7. **写入文件**：保存到 `skills/rdk-{name}/SKILL.md`

### SKILL.md 模板

```markdown
---
name: 技能名称
description: 一句话说清能力边界和触发场景
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
1. 步骤（对应工具）
2. 步骤（对应工具）
3. ...

## 工具映射
| 工具 | 用途 | 必需 |
|------|------|------|
| tool_name | 干什么 | 是/否 |

## 输出要求
- 必须产出的内容

## 禁止事项
- 不可以做的事
```

### Frontmatter 必填字段（12 项）
name, description, version, trigger, risk, permissions, delegate_preference, requires_board, approval_level, cooldown_seconds, scheduler_template, category

### 质量检查清单
- [ ] trigger 关键词是否覆盖了用户可能的说法？
- [ ] 每步流程是否对应了具体工具？
- [ ] 失败路径是否有降级方案？
- [ ] 禁止事项是否有实际约束力（不是废话）？

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
