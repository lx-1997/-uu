---
name: RDK Ecosystem
description: 生态技能管理：搜索、安装、运行 NodeHub 应用 / ModelZoo 模型 / TROS 组件，以及示例应用和模型部署。触发词：技能、安装包、NodeHub、ModelZoo、TROS、示例、demo、模型部署。
version: 1.0.0
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

# RDK Ecosystem

> 本技能合并了原 rdk-examples（示例应用）和 rdk-models（模型部署）的能力，统一通过生态系统 API 管理。

## 适用场景
- 用户想搜索或安装生态包（NodeHub 应用、ModelZoo 模型、TROS 组件）。
- 用户说：安装 xxx、搜索 xxx 技能、技能市场。
- 用户想查看设备上已安装的技能。
- 用户想运行示例应用（YOLO 检测、人体骨骼、SLAM、手势识别、TTS 等）。
- 用户想部署、转换或运行 AI 模型（ONNX、YOLO 等）。
- 用户想查看已部署的模型列表。

## 执行流程
1. **检测板型**：调用 `POST /api/ecosystem/detect/{deviceId}` 获取设备平台、型号和系统版本，确认兼容性。
2. **搜索技能**：调用 `GET /api/ecosystem/search` 按关键词、来源、平台过滤，找到目标技能/应用/模型。
3. **安装技能**：调用 `POST /api/ecosystem/skills/{skillId}/install` 安装到设备（安装通常需要 apt 或 pip，可能耗时较长）。
4. **运行/停止**：调用 run/stop API 管理技能生命周期。
5. **状态同步**：调用 `POST /api/ecosystem/sync/{deviceId}` 同步板端已安装和运行中的包状态。

## 工具映射

### 生态核心 API

| API | 用途 | 必需 |
|-----|------|------|
| `GET .../ecosystem/search` | 搜索技能（按关键词、来源、平台、分类、标签） | 是 |
| `GET .../ecosystem/skills/{skillId}` | 获取技能详情 | 否 |
| `POST .../ecosystem/skills/{skillId}/install` | 安装技能到设备 | 是 |
| `POST .../ecosystem/skills/{skillId}/run` | 运行技能 | 是 |
| `POST .../ecosystem/skills/{skillId}/stop` | 停止技能 | 是 |
| `POST .../ecosystem/skills/{skillId}/uninstall` | 卸载技能 | 否 |
| `POST .../ecosystem/sync/{deviceId}` | 同步板端状态 | 否 |
| `POST .../ecosystem/detect/{deviceId}` | 检测板型 | 否 |
| `POST .../ecosystem/refresh` | 刷新注册表 | 否 |
| `GET .../ecosystem/stats` | 获取生态统计 | 否 |
| `POST .../ecosystem/skills/{skillId}/provision` | 将技能注册为 OpenClaw Skill | 否 |

### 示例应用 API

| API | 用途 | 必需 |
|-----|------|------|
| `POST /api/devices/{deviceId}/examples/run` | 运行示例应用（在设备上执行启动命令） | 否 |

> 示例应用的安装/卸载/运行/停止也可通过上方生态核心 API 操作（以 skillId 引用）。

### 模型部署 API

| API | 用途 | 必需 |
|-----|------|------|
| `GET /api/devices/{deviceId}/models/list` | 列出已部署模型（扫描 /opt/rdk_model_zoo/models、/userdata 中的 .bin/.onnx） | 否 |
| `POST /api/devices/{deviceId}/models/deploy` | 执行模型部署命令 | 否 |

### API 详细参数

**搜索技能**
```
GET /api/ecosystem/search?q=yolo&source=nodehub&platform=rdk-x5&limit=20
Response: { skills: EcoSkill[], total: number }
```

**获取技能详情**
```
GET /api/ecosystem/skills/{skillId}
Response: { skill: EcoSkill }
```

**安装技能到设备**
```
POST /api/ecosystem/skills/{skillId}/install
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

**运行技能**
```
POST /api/ecosystem/skills/{skillId}/run
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

**停止技能**
```
POST /api/ecosystem/skills/{skillId}/stop
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

**卸载技能**
```
POST /api/ecosystem/skills/{skillId}/uninstall
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

**同步板端状态**
```
POST /api/ecosystem/sync/{deviceId}
Response: { ok: boolean, installedPackages: string[], runningProcesses: string[], ... }
```

**检测板型**
```
POST /api/ecosystem/detect/{deviceId}
Response: { ok: boolean, platform: string, model: string, osVersion: string }
```

**刷新注册表**
```
POST /api/ecosystem/refresh
Response: { ok: boolean, counts: Record<string, number>, total: number }
```

**获取生态统计**
```
GET /api/ecosystem/stats
Response: { total: number, bySource: Record, byCategory: Record, byPlatform: Record }
```

**将技能注册为 OpenClaw Skill**
```
POST /api/ecosystem/skills/{skillId}/provision
Body: { deviceId: string, platform?: string }
Response: { ok: boolean, message: string, output: string }
```

**运行示例应用**
```
POST /api/devices/{deviceId}/examples/run
Body: { command: string }
Response: { ok: boolean, output: string }
```

**列出已部署模型**
```
GET /api/devices/{deviceId}/models/list
Response: { ok: boolean, output: string }
```

**执行模型部署命令**
```
POST /api/devices/{deviceId}/models/deploy
Body: { command: string }
Response: { ok: boolean, output: string }
```

### Client Actions
- 打开示例页面: `navigate:examples`
- 打开模型页面: `navigate:models`

## 输出要求
- 搜索结果需展示：技能名称、来源、平台兼容性、简介。
- 安装完成后需报告：安装状态、耗时、是否需要重启。
- 运行示例/模型前需告知：资源需求（摄像头、BPU、内存）。
- 模型部署需报告：部署命令、执行结果、模型路径。

## 禁止事项
- **不跳过板型检测直接安装**：不同平台（RDK X3/X5）的包不兼容，安装前应确认。
- **不在设备离线时执行安装**：安装依赖网络和 SSH 连接。
- **部署命令/示例命令直接在设备执行，需用户确认**：避免误操作。
- **大模型下载可能耗时较长**：需提前告知用户。
- **部分示例需要摄像头（MIPI/USB）和 BPU 资源**：运行前需确认硬件就绪。
