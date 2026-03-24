---
name: RDK D-Robotics Forum Ops
description: 在地瓜机器人开发者社区执行看帖、读回复、归纳问题与代发帖（草稿确认后发布）。
version: 1.0.0
trigger: 论坛,发帖,看帖,回复,问题汇总,d-robotics,forum
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

## 推荐工具
- 对话配置凭据：`forum_drobotics_set_credentials`（用户提供账号密码时调用）
- 鉴权自检：`forum_drobotics_auth_status`
- 获取最新主题：`forum_drobotics_latest`
- 查看主题与回复：`forum_drobotics_topic`
- 创建主题/回复：`forum_drobotics_create_post`
- 补充公开资料：`web_search`、`web_fetch`、`web_extract`

## 实测流程结论（2026-03）
- 匿名访问 `latest.json` / `about.json` / `topic` 会返回 `403 not_logged_in`。
- 匿名发帖 `POST /posts.json` 返回 `BAD CSRF`；即使带 csrf 但未登录，仍返回 `not_logged_in`。
- `forum.d-robotics.cc/u/login` 会跳转到 `/session/sso`，说明论坛启用了 SSO，不能直接用用户名密码调用 `/session` 登录。
- 因此，自动化发帖应优先走 **服务端 API Key + Api-Username** 模式。
- 如果没有 API Key，可使用浏览器登录态 Cookie（`FORUM_DROBOTICS_COOKIE`）模拟人工登录。

## 发帖流程（强制）
0. 先调用 `forum_drobotics_auth_status`，确认是否有论坛读写权限。
   - 若未认证且用户已提供账号密码，立即调用 `forum_drobotics_set_credentials` 配置凭据。
   - 若未认证且用户未提供凭据，提示用户在对话中告知论坛账号密码。
1. 先向用户确认发帖目标：`新主题` 或 `回复已有主题`。
2. 生成草稿：标题、背景、复现步骤、日志、期望结果、已尝试操作。
3. 把草稿完整展示给用户确认。
4. 用户明确同意后才调用 `forum_drobotics_create_post`。

## 看帖流程（强制）
1. 先调用 `forum_drobotics_latest` 获取候选主题。
2. 再用 `forum_drobotics_topic` 拉取目标主题和回复细节。
3. 总结为：问题现象、社区已给建议、当前阻塞点、建议下一步。

## 输出规范
- 返回论坛 URL、主题 ID、关键回复摘要。
- 发帖成功后必须返回 `topic_id` 与访问链接。
- 如无权限发帖，提示用户可在对话中直接告知论坛账号密码，或在设置面板中配置。

## 禁止事项
- 未经用户确认直接发帖或回帖。
- 编造不存在的论坛回复。
- 将用户隐私（密钥、手机号、设备序列号）原样发到公开论坛。
