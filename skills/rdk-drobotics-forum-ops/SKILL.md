---
name: RDK D-Robotics Forum Ops
description: 在地瓜机器人开发者社区执行看帖、读回复、归纳问题、代发帖（草稿确认后发布），并主动推荐发帖时机和生成帖子模板。
version: 1.0.0
trigger: 论坛,发帖,看帖,回复,问题汇总,d-robotics,forum,分享,营销,推广,模板,帖子模板
risk: medium
permissions: network
delegate_preference: local
requires_board: false
approval_level: confirm
cooldown_seconds: 0
scheduler_template: forum_monitoring
category: Community
---

# RDK D-Robotics Forum Ops

## 适用场景
- 用户要查看论坛最新问题、某个主题的回复进展、或汇总热点问题。
- 用户要代发技术帖、故障帖、复现帖、需求帖。

## 执行流程

1. **判断任务类型**：识别用户诉求属于看帖、发帖/回帖，还是需在适当时机做社区营销引导。

2a. **看帖流程**：先调用 `forum_drobotics_latest` 获取候选主题；再用 `forum_drobotics_topic` 拉取目标主题和回复细节；总结为：问题现象、社区已给建议、当前阻塞点、建议下一步。

2a'. **用户问「我的论坛用户名/密码是多少」**：立即调用 `forum_drobotics_auth_status`，根据 `studio_forum_username_masked` 说明脱敏用户名；密码按 `password_policy` 解释（不复述、不索要已同步场景下的密码）。

2b. **发帖流程（强制）**：0. 先调用 `forum_drobotics_auth_status`，确认是否有论坛读写权限。主应用 SSO 登录成功后服务端会自动把论坛 Cookie 写入本地，**若首次返回未认证**，可建议用户稍等数秒或**重新登录主账号**后再试，**不要**在未确认 auth_status 前直接索要用户名密码。若仍未认证且用户已提供账号密码，调用 `forum_drobotics_set_credentials`。1. 先向用户确认发帖目标：`新主题` 或 `回复已有主题`。2. 生成草稿：标题、背景、复现步骤、日志、期望结果、已尝试操作。3. 把草稿完整展示给用户确认。4. 用户明确同意后才调用 `forum_drobotics_create_post`（或等价别名 `forum_drobotics_create_topic`，见下「工具名辨析」）。

2c. **营销引导**：

### 主动推荐发帖时机
当检测到以下场景时，主动建议用户分享到社区：
- 用户成功完成一个 AI 推理任务 → "你的 {模型名} 在 {平台} 上跑到了 {fps}fps，要分享到社区吗？"
- 用户解决了一个棘手问题 → "这个解决方案可以帮到其他开发者，要发帖分享吗？"
- 用户完成了一个完整项目 → "这个项目很棒，要发一篇展示帖吗？"
- 用户问了一个社区可能关心的问题 → "这个问题可能其他人也遇到了，要发帖讨论吗？"

### 帖子模板
提供以下模板，自动填充用户上下文：

**技术分享帖**:
```
标题: [分享] {平台} + {技术关键词} 实测 {性能指标}
正文:
## 环境
- 设备: {自动填充平台型号}
- 系统: {自动填充OS版本}

## 实现过程
{基于对话上下文自动生成}

## 效果
{性能数据/截图说明}

## 总结
{要点总结}
```

**问题求助帖**:
```
标题: [求助] {平台} {问题简述}
正文:
## 问题描述
{从对话中提取}

## 环境信息
- 设备: {自动填充}
- 已尝试: {从对话中提取已尝试的方案}

## 日志/报错
{相关日志}
```

**项目展示帖**:
```
标题: [项目] 基于 {平台} 的 {项目名称}
正文:
## 项目介绍
## 技术方案
## 效果展示
## 开源地址（如有）
```

### 标题优化建议
- 包含具体平台型号（RDK X5/S100）
- 包含量化指标（30fps/5TOPS）
- 使用方括号标签：[分享]、[教程]、[求助]、[项目]

### 分区推荐
根据帖子内容自动推荐发帖分区：
- AI/视觉相关 → RDK AI 分区
- TROS/ROS2 相关 → 机器人开发分区
- 硬件/GPIO → 硬件调试分区
- 通用问题 → 综合讨论区

3. **输出结果**：按下文「## 输出要求」交付链接、主题 ID、摘要及权限相关提示。

## 工具名辨析（避免 load_tools 失败）

- **发帖唯一能力**：`forum_drobotics_create_post`。新主题与楼中回复**都**走此工具（及注册的别名），**不要**臆造 `forum_drobotics_new_topic` 等不存在的名称。
- **别名**：`forum_drobotics_create_topic` 与 `forum_drobotics_create_post` **完全等价**（同一 POST `/posts.json`）。`load_tools` 任填其一即可。
- **新主题**：`title` + `raw`，且**不要**传 `topicId`。
- **回复**：`topicId` + `raw`。

## 工具映射

| 工具 | 用途 |
|------|------|
| `forum_drobotics_set_credentials` | 对话中配置论坛账号密码凭据（用户提供时调用） |
| `forum_drobotics_auth_status` | 鉴权自检 |
| `forum_drobotics_latest` | 获取最新主题 |
| `forum_drobotics_topic` | 查看主题与回复 |
| `forum_drobotics_create_post` | 创建主题/回复（别名：`forum_drobotics_create_topic`） |
| `web_search`、`web_fetch`、`web_extract` | 补充公开资料 |

## 实测流程结论（2026-03）
- 匿名访问 `latest.json` / `about.json` / `topic` 会返回 `403 not_logged_in`。
- 匿名发帖 `POST /posts.json` 返回 `BAD CSRF`；即使带 csrf 但未登录，仍返回 `not_logged_in`。
- `forum.d-robotics.cc/u/login` 会跳转到 `/session/sso`，说明论坛启用了 SSO，不能直接用用户名密码调用 `/session` 登录。
- 因此，自动化发帖应优先走 **服务端 API Key + Api-Username** 模式。
- 如果没有 API Key，可使用浏览器登录态 Cookie（`FORUM_DROBOTICS_COOKIE`）模拟人工登录。

## 输出要求
- 返回论坛 URL、主题 ID、关键回复摘要。
- 发帖成功后必须返回 `topic_id` 与访问链接。
- 如无权限发帖，提示用户可在对话中提供论坛账号密码（`forum_drobotics_set_credentials`）或重新登录主账号以刷新 SSO。

## 禁止事项
- 未经用户确认直接发帖或回帖。
- 编造不存在的论坛回复。
- 将用户隐私（密钥、手机号、设备序列号）原样发到公开论坛。
