---
name: RDK Ecosystem
description: 在已无集中式生态注册表的前提下，通过联网文档、板型探测与板端 OpenClaw 完成「找方案—装依赖—跑起来」。触发词：技能、安装包、NodeHub、ModelZoo、TROS、示例、demo、模型部署。
version: 1.1.0
trigger: 技能,安装包,NodeHub,ModelZoo,TROS,ecosystem,install,示例,demo,example,模型部署,deploy model,yolo,onnx,推理
risk: medium
permissions: device_exec,network
delegate_preference: local
requires_board: true
approval_level: confirm
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# RDK Ecosystem（设备 + 联网）

> **已废弃**：旧的 `/api/ecosystem/*` 与本地 `ecosystem-registry.json` 流水线不再作为真相来源。平台能力以 **设备记录中的板卡字段**、**板端 OpenClaw assess** 与 **web_search / web_fetch** 为准。

## 适用场景
- 用户想安装或运行 NodeHub / ModelZoo / TROS 相关组件（通过官方文档与命令，而非注册表搜索）。
- 用户想确认当前板卡型号与系统版本是否匹配某方案。
- 用户想部署或运行示例、模型（ONNX、YOLO 等）。
- 用户想查看设备上已安装的模型或运行示例应用。

## 执行流程
1. **板型与系统**：查看设备是否已有 `boardPlatform` / `boardModel`；若没有，调用 `POST /api/devices/{deviceId}/board/detect?persist=1` 经 SSH 探测并可选写回 `devices.json`。
2. **资料与方案**：用 `web_search` 找官方教程与仓库，用 `web_fetch` 拉取关键页面；优先使用设备记录里的 `researchSeeds`（由 `board/detect?persist=1` 写入）作为检索起点。
3. **板端能力**：用 `board_openclaw_assess` / `board_openclaw_chat` 确认依赖、已装技能与是否可执行复杂编排。
4. **执行**：简单命令用 `device_exec`；多步编排优先 `board_openclaw_delegate`，在 `guidance` 中附带文档链接与建议命令。
5. **示例与模型（设备 API，仍可用）**：
   - 运行示例：`POST /api/devices/{deviceId}/examples/run`，Body: `{ command: string }`
   - 列出已部署模型：`GET /api/devices/{deviceId}/models/list`
   - 部署模型命令：`POST /api/devices/{deviceId}/models/deploy`，Body: `{ command: string }`

## 工具映射

| 能力 | 方式 | 必需 |
|------|------|------|
| 板型探测（SSH） | `POST /api/devices/{id}/board/detect?persist=1` | 推荐 |
| 文档与仓库 | `web_search` / `web_fetch` | 推荐 |
| 板端评估与委派 | `board_openclaw_assess`, `board_openclaw_delegate`, `board_openclaw_chat` | 视任务 |
| 直跑 shell | `device_exec` | 常用 |

### Client Actions
- 打开示例页面: `navigate:examples`
- 打开模型页面: `navigate:models`

## 输出要求
- 说明板型与系统版本依据（设备字段或探测输出摘要）。
- 安装/运行前给出资源需求（摄像头、BPU、内存、网络）。
- 引用文档时附可点击链接；关键命令单独成块便于复制。

## 禁止事项
- **不假设仍存在 ecosystem 注册表或 `/api/ecosystem/search`**。
- **不在未确认板型与依赖前批量安装**：X3/X5/S100 等包不混用。
- **不在设备离线时承诺安装成功**。
- **高危命令需用户确认**。
