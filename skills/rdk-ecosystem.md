---
name: rdk-ecosystem
description: "生态技能管理：搜索、安装、运行NodeHub/ModelZoo/TROS技能包。Use when user mentions ecosystem, skill, install package, 技能, 安装包, NodeHub, ModelZoo, TROS."
version: 1.0.0
metadata: {"rdkstudio":{"category":"system","icon":"package","requires":{"device":true}}}
---

# 生态技能管理

## When to Use
- 用户想搜索或安装生态包（NodeHub 应用、ModelZoo 模型、TROS 组件）
- 用户说：安装 xxx、搜索 xxx 技能、技能市场
- 用户想查看设备上已安装的技能

## APIs

### 搜索技能
```
GET /api/ecosystem/search?q=yolo&source=nodehub&platform=rdk-x5&limit=20
Response: { skills: EcoSkill[], total: number }
```
支持按关键词、来源、平台、分类、标签过滤。

### 获取技能详情
```
GET /api/ecosystem/skills/{skillId}
Response: { skill: EcoSkill }
```

### 安装技能到设备
```
POST /api/ecosystem/skills/{skillId}/install
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

### 运行技能
```
POST /api/ecosystem/skills/{skillId}/run
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

### 停止技能
```
POST /api/ecosystem/skills/{skillId}/stop
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

### 卸载技能
```
POST /api/ecosystem/skills/{skillId}/uninstall
Body: { deviceId: string }
Response: { ok: boolean, skillId: string, output: string }
```

### 同步板端状态
```
POST /api/ecosystem/sync/{deviceId}
Response: { ok: boolean, installedPackages: string[], runningProcesses: string[], ... }
```

### 检测板型
```
POST /api/ecosystem/detect/{deviceId}
Response: { ok: boolean, platform: string, model: string, osVersion: string }
```

### 刷新注册表
```
POST /api/ecosystem/refresh
Response: { ok: boolean, counts: Record<string, number>, total: number }
```

### 获取生态统计
```
GET /api/ecosystem/stats
Response: { total: number, bySource: Record, byCategory: Record, byPlatform: Record }
```

### 将技能注册为 OpenClaw Skill
```
POST /api/ecosystem/skills/{skillId}/provision
Body: { deviceId: string, platform?: string }
Response: { ok: boolean, message: string, output: string }
```

## Notes
- 来源包括：NodeHub（应用）、ModelZoo（模型）、TROS（ROS组件）、OpenClaw Skills
- 安装通常需要 apt 或 pip，可能耗时较长
