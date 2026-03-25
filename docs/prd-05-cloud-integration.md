# RDK Studio PRD — 云端资源整合与技能生态

> 版本: 1.0 | 日期: 2026-03-25 | 状态: 初稿

---

## 目录

- [1. 背景与目标](#1-背景与目标)
- [2. 核心问题分析](#2-核心问题分析)
- [3. 云端技能仓库（Skill Registry Cloud）](#3-云端技能仓库skill-registry-cloud)
- [4. 课程技能包（Course Skill Pack）](#4-课程技能包course-skill-pack)
- [5. 云端模型与应用分发](#5-云端模型与应用分发)
- [6. 桌面端 OTA 更新机制](#6-桌面端-ota-更新机制)
- [7. 多租户云部署](#7-多租户云部署)
- [8. 设备舰队远程管理](#8-设备舰队远程管理)
- [9. 数据与遥测](#9-数据与遥测)
- [10. 安全与合规](#10-安全与合规)
- [11. 实施路线图](#11-实施路线图)
- [12. 技术架构](#12-技术架构)

---

## 1. 背景与目标

### 1.1 背景

RDK Studio 当前以本地桌面端为主要形态，以下资源完全打包在安装包中：

- Agent 人格文件（SOUL.md、技能定义）
- 生态注册表（NodeHub/ModelZoo/TROS/OpenClaw 数据）
- 内置模型列表与示例应用列表
- 设备画像与平台适配信息

**打包后的核心问题**：一旦发布，这些资源就冻结了。新技能、新模型、新板型适配、Bug 修复都需要发布新版本才能到达用户手中。

### 1.2 目标

1. **技能可热更新**：用户无需升级 Studio 即可获得最新技能
2. **课程可分发**：教师创建课程后，学生一键导入并在板端复现
3. **生态实时同步**：NodeHub/ModelZoo 新增资源自动同步到 Studio
4. **版本可回滚**：任何云端更新都可回退到之前版本
5. **离线可用**：网络不可用时，使用本地缓存继续工作

### 1.3 用户价值

| 角色 | 价值 |
|------|------|
| **教师** | 创建课程技能包 → 发布到云端 → 学生一键导入 → 复现率 100% |
| **学生** | 导入课程 → 按步骤执行 → 自动验证 → 学习进度云端同步 |
| **开发者** | 技能自动更新 → 生态最新资源实时可用 → 减少手动配置 |
| **运维** | 远程设备舰队管理 → 批量下发技能 → 集中监控 |

---

## 2. 核心问题分析

### 2.1 当前资源生命周期

```
开发时                    打包时                用户手中
Skills/*.md  ────────→  静态文件  ──────→  不可更新（除非升级整个 App）
Ecosystem    ────────→  JSON 快照 ──────→  数据逐渐过时
Models.tsx   ────────→  硬编码    ──────→  无法新增
SOUL.md      ────────→  静态文件  ──────→  仅 propose_soul_update 可修改
```

### 2.2 目标资源生命周期

```
云端仓库                  Studio 客户端            板端设备
Skill Registry ──同步──→ 本地缓存 + 热加载  ──部署──→ OpenClaw 技能目录
Course Packs   ──导入──→ 课程进度追踪       ──执行──→ 板端复现
Model Catalog  ──同步──→ 模型列表实时更新   ──部署──→ BPU 推理
Config Updates ──OTA───→ Agent 行为更新      ──传播──→ 板端 OpenClaw 同步
```

---

## 3. 云端技能仓库（Skill Registry Cloud）

### 3.1 定位

类比 ClawHub 之于 OpenClaw，为 RDK Studio 构建专属的技能分发与管理平台。

### 3.2 架构

```
┌────────────────────────────────────────┐
│           Skill Registry Cloud          │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ 技能仓库 │  │ 版本管理  │  │ 审核系统│ │
│  │ (Git)   │  │ (semver) │  │(自动+人工)│ │
│  └─────────┘  └──────────┘  └────────┘ │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ 搜索引擎 │  │ 分发 CDN  │  │ 统计分析│ │
│  │(语义检索)│  │(全球加速) │  │(安装量)│  │
│  └─────────┘  └──────────┘  └────────┘ │
└───────────────────┬────────────────────┘
                    │ REST API / WebSocket
        ┌───────────┴──────────────┐
        │     RDK Studio 客户端     │
        │                          │
        │  SkillSyncManager        │
        │  ├── 定期轮询新版本        │
        │  ├── 增量下载 (diff)       │
        │  ├── 本地缓存              │
        │  ├── 热加载到 SkillRegistry │
        │  └── 离线回退              │
        └──────────────────────────┘
```

### 3.3 同步协议

```
1. Studio 启动时:
   POST /api/cloud/skills/sync
   Body: { installedSkills: [{id, version, hash}], platform: "rdk-x5" }
   
   Response: {
     updates: [{id, newVersion, changelog, downloadUrl}],
     newSkills: [{id, name, description, ...}],
     deprecated: [{id, reason, alternative}]
   }

2. 用户确认更新:
   POST /api/cloud/skills/download
   Body: { skillIds: ["skill-a@2.0.0", "skill-b@1.3.0"] }
   
   Response: Stream of SKILL.md contents

3. 后台增量同步 (每 30 分钟):
   GET /api/cloud/skills/changelog?since=2026-03-25T10:00:00Z
```

### 3.4 技能质量标准

基于 ClawHub 经验和 RDK 特点，定义质量标准：

| 维度 | 要求 | 检查方式 |
|------|------|---------|
| **Frontmatter 完整性** | 12 个必填字段全部填写 | 自动校验 |
| **触发词覆盖** | 中英文触发词至少各 2 个 | 自动校验 |
| **执行流程可执行** | 每步对应具体命令或工具 | 人工审核 |
| **平台兼容标注** | 明确标注支持的板型 | 自动校验 |
| **错误处理** | 包含失败回退段落 | 自动校验 |
| **验证步骤** | 包含如何验证执行成功 | 自动校验 |
| **安全扫描** | 无危险命令（rm -rf /、dd 等） | 自动扫描 |

### 3.5 技能分级

| 等级 | 标准 | 标记 |
|------|------|------|
| **官方认证** | D-Robotics 团队审核 | 🏆 Certified |
| **社区精选** | 安装量 > 100 且评分 > 4.5 | ⭐ Featured |
| **社区贡献** | 通过自动审核 | ✅ Community |
| **实验性** | 未通过全部审核 | ⚠️ Experimental |

---

## 4. 课程技能包（Course Skill Pack）

### 4.1 定位

**"每节课 = 一个可执行技能"** — 将传统教学文档转化为板端可复现的技能序列。

### 4.2 课程包结构

```yaml
# COURSE.yaml — 课程元数据
name: "RDK 视觉入门"
version: 1.0.0
author: "张老师"
description: "从相机预览到 YOLO 检测的 4 节课"
target_platform: ["rdk-x5", "rdk-x3"]
prerequisites:
  - "板端已安装 OpenClaw"
  - "摄像头已连接"
lessons:
  - id: lesson-01
    title: "相机预览"
    skill: lesson-01-camera-preview/SKILL.md
    duration: "15min"
    verify: "板端能输出相机画面帧数"
  - id: lesson-02
    title: "YOLO 目标检测"
    skill: lesson-02-yolo-detect/SKILL.md
    duration: "20min"
    depends_on: lesson-01
    verify: "检测到至少一个目标并输出坐标"
  - id: lesson-03
    title: "自定义模型部署"
    skill: lesson-03-custom-model/SKILL.md
    duration: "30min"
    depends_on: lesson-02
  - id: lesson-04
    title: "多板卡协作推理"
    skill: lesson-04-multi-board/SKILL.md
    duration: "25min"
    depends_on: lesson-03
```

### 4.3 课程技能 SKILL.md 扩展格式

在标准 SKILL.md 基础上增加课程专用字段：

```markdown
---
name: camera-preview
description: "启动板端摄像头并预览画面"
version: 1.0.0
trigger: 相机预览,camera preview,打开相机
risk: low
permissions: device_exec
delegate_preference: board
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Course

# 课程扩展字段
course_id: rdk-vision-101
lesson_id: lesson-01
difficulty: beginner
estimated_time: 15min
learning_objectives:
  - 了解 RDK 相机驱动
  - 掌握 MIPI CSI 相机的使用
  - 学会通过命令行预览相机画面
---

# 课程 1: 相机预览

## 前置检查
1. 确认摄像头已物理连接到板端 MIPI CSI 接口
2. 确认设备已启动且 SSH 可连接

## 执行流程
1. 检查相机设备节点: `ls /dev/video*`
2. 安装 v4l 工具: `sudo apt install -y v4l-utils`
3. 查看相机信息: `v4l2-ctl --list-devices`
4. 启动相机预览: `python3 /opt/tros/humble/share/mipi_cam/launch/mipi_cam.py`

## 验证步骤
- 执行 `v4l2-ctl --list-devices` 应输出至少一个视频设备
- 预览窗口应显示实时画面
- 输出帧率应 > 15fps

## 失败回退
- 如果 `/dev/video*` 不存在：检查排线连接，执行 `dmesg | grep camera`
- 如果安装失败：检查网络连接，尝试 `sudo apt update` 后重试

## 知识点
- MIPI CSI 是什么
- V4L2 子系统简介
- RDK 板端相机驱动架构
```

### 4.4 课程导入与进度管理

**导入流程**：
```
教师发布课程包 (.zip / Git URL)
    ↓
学生在 Studio 中: "导入课程"
    ↓
Studio 解析 COURSE.yaml
    ↓
检查前置条件（板型、摄像头、OpenClaw）
    ↓
按顺序加载 lesson SKILL.md
    ↓
展示课程大纲（带进度条）
    ↓
学生按步骤执行每节课
    ↓
自动验证 → 标记完成 → 云端同步进度
```

**进度追踪数据结构**：
```json
{
  "courseId": "rdk-vision-101",
  "userId": "student-001",
  "startedAt": "2026-03-25T10:00:00Z",
  "lessons": [
    { "id": "lesson-01", "status": "completed", "completedAt": "...", "attempts": 1 },
    { "id": "lesson-02", "status": "in-progress", "startedAt": "...", "attempts": 2 },
    { "id": "lesson-03", "status": "locked" },
    { "id": "lesson-04", "status": "locked" }
  ]
}
```

---

## 5. 云端模型与应用分发

### 5.1 问题

当前 Models.tsx 和 Examples.tsx 的模型/应用列表硬编码在前端代码中：
- 新模型/新应用需要发版才能到达用户
- 不同板型支持的模型不同，但切换板型后列表不动态更新
- 没有用户安装量/评分等反馈数据

### 5.2 云端模型注册表

```
Cloud Model Registry
├── NodeHub 应用同步器 (爬取 developer.d-robotics.cc/nodehub)
├── ModelZoo 同步器 (爬取 github.com/D-Robotics/rdk_model_zoo)
├── TROS 包同步器 (apt list)
└── 手动录入的社区模型

Studio 启动时:
GET /api/cloud/catalog?platform=rdk-x5

Response: {
  models: [...],      // 按板型过滤后的可用模型
  apps: [...],        // 按板型过滤后的可用应用
  updated_at: "..."
}
```

### 5.3 AI 工具集成

新增以下 AI 工具，让对话可以完成模型/应用的全生命周期管理：

| 工具名 | 功能 | 数据来源 |
|--------|------|---------|
| `model_catalog_search` | 搜索可用模型 | 云端注册表 |
| `model_deploy` | 部署模型到板端 | 模型元数据中的 deployCmd |
| `model_run` | 运行已部署模型 | 模型元数据中的 runCmd |
| `model_stop` | 停止运行中的模型 | 模型元数据中的 processKey |
| `model_status` | 检查模型部署/运行状态 | SSH 检测 |
| `app_catalog_search` | 搜索可用应用 | 云端注册表 |
| `app_install` | 安装应用到板端 | 应用元数据中的 installCmd |
| `app_run` | 运行已安装应用 | 应用元数据中的 runCmd |
| `app_stop` | 停止运行中的应用 | 应用元数据中的 processKey |

---

## 6. 桌面端 OTA 更新机制

### 6.1 三层更新策略

| 层级 | 更新内容 | 频率 | 机制 | 用户感知 |
|------|---------|------|------|---------|
| **技能热更新** | SKILL.md 文件 | 实时 | SkillSyncManager | 静默（通知新技能可用） |
| **数据包更新** | 生态注册表、模型列表、设备画像 | 每日 | JSON diff + 合并 | 静默 |
| **应用版本更新** | Electron 主程序 | 月度 | electron-updater | 弹窗提示 |

### 6.2 技能热更新流程

```
SkillSyncManager（服务端模块）
├── 启动时检查: fetchRemoteSkillManifest()
│   └── 比对本地 manifest.json vs 远程 manifest
├── 发现更新:
│   ├── 下载变更的 SKILL.md 文件
│   ├── 写入 ~/.rdkstudio/skills/ （用户目录，不覆盖安装目录）
│   └── 通知 SkillRegistry 热加载
├── 定时轮询: setInterval(checkUpdate, 30 * 60 * 1000)
└── 离线回退: 使用本地缓存的最后版本
```

### 6.3 版本管理

```json
// ~/.rdkstudio/skill-manifest.json
{
  "lastSyncAt": "2026-03-25T10:00:00Z",
  "skills": {
    "rdk-camera-preview": { "version": "1.2.0", "hash": "abc123", "source": "cloud" },
    "rdk-yolo-detect": { "version": "1.0.1", "hash": "def456", "source": "cloud" },
    "my-custom-skill": { "version": "1.0.0", "hash": "ghi789", "source": "local" }
  },
  "pinnedVersions": {
    "rdk-camera-preview": "1.2.0"
  }
}
```

---

## 7. 多租户云部署

### 7.1 场景

学校/企业将 RDK Studio 部署为云服务，多个用户通过浏览器访问同一实例。

### 7.2 租户隔离

```
Cloud RDK Studio Instance
├── 用户 A
│   ├── 设备列表（独立）
│   ├── 会话记忆（独立）
│   ├── 课程进度（独立）
│   └── 技能定制（独立）
├── 用户 B
│   ├── ...
└── 共享资源
    ├── 云端技能仓库（共享）
    ├── 模型注册表（共享）
    └── Agent 引擎（共享，按用户隔离上下文）
```

### 7.3 教室模式

教师可以在云端实例中：
1. 创建"教室"，生成邀请码
2. 学生扫码加入教室
3. 教师实时查看所有学生的进度
4. 教师可以远程查看学生板端状态
5. 教师可以广播消息到所有学生的 AI Dock

---

## 8. 设备舰队远程管理

### 8.1 现有基础

已实现的 fleet 工具（`fleet_board_list`、`fleet_board_delegate`、`fleet_board_broadcast`）为本地多设备管理。

### 8.2 云端扩展

```
Cloud Fleet Manager
├── 设备注册: 板端通过 token 自注册到云端
├── 心跳上报: 板端定期上报健康状态
├── 远程指令: 云端下发任务到指定板端
├── 批量管理: 按标签分组、批量部署技能
└── 监控大盘: 所有设备实时状态看板
```

### 8.3 设备注册协议

```
板端 OpenClaw 启动时:
POST /api/cloud/fleet/register
Body: {
  deviceId: "...",
  boardModel: "RDK X5",
  ip: "192.168.1.100",
  openclawVersion: "0.9.2",
  capabilities: { bpuTops: 10, ramGb: 4, ... },
  token: "fleet-registration-token"
}

云端定期同步:
GET /api/cloud/fleet/devices?groupId=classroom-a
Response: { devices: [...], healthSummary: { online: 15, offline: 3 } }
```

---

## 9. 数据与遥测

### 9.1 匿名使用统计

用户同意后，收集匿名使用数据帮助改进产品：

| 指标 | 用途 |
|------|------|
| 日活设备数 | 了解用户规模 |
| 常用功能 Tab 分布 | 优化功能优先级 |
| AI 对话轮次 | 了解 Agent 使用深度 |
| 技能安装/使用排行 | 优化推荐算法 |
| 课程完成率 | 评估教学效果 |
| 错误率最高的操作 | 定位体验瓶颈 |

### 9.2 课程分析（教师端）

| 指标 | 展示 |
|------|------|
| 每节课完成率 | 柱状图 |
| 平均完成时间 | 趋势线 |
| 失败步骤 Top 5 | 排行榜 |
| 学生求助 AI 频率 | 热力图 |

---

## 10. 安全与合规

### 10.1 技能安全

- 所有上传到云端的技能必须通过自动安全扫描
- 禁止包含：`rm -rf /`、`dd`、`curl | bash`、明文密钥等
- 社区举报 3 次以上的技能自动下架审查
- 安全审核日志保留 90 天

### 10.2 数据安全

- 用户设备凭据（SSH 密码）**不上传云端**，仅本地存储
- 会话记忆可选是否同步到云端
- 遥测数据匿名化处理，不包含用户身份

### 10.3 网络安全

- 所有云端 API 使用 HTTPS
- API 鉴权使用 JWT + refresh token
- 设备注册使用一次性 token
- 防 DDoS 限流

---

## 11. 实施路线图

### Phase 1: 基础设施（4 周）

| 任务 | 优先级 | 依赖 |
|------|--------|------|
| 云端技能仓库 API 搭建 | P0 | 无 |
| SkillSyncManager 客户端模块 | P0 | API |
| 技能质量校验系统 | P0 | 无 |
| 技能热加载机制 | P0 | SyncManager |

### Phase 2: 课程系统（4 周）

| 任务 | 优先级 | 依赖 |
|------|--------|------|
| COURSE.yaml 解析器 | P0 | Phase 1 |
| 课程 UI（进度/步骤） | P0 | 解析器 |
| 课程导入/导出 | P1 | 解析器 |
| 课程进度云端同步 | P1 | 云端 API |

### Phase 3: 生态整合（4 周）

| 任务 | 优先级 | 依赖 |
|------|--------|------|
| 云端模型注册表 | P1 | Phase 1 |
| AI 工具（model_deploy 等） | P1 | 注册表 |
| 桌面端 OTA 更新 | P1 | 无 |
| 设备舰队云端管理 | P2 | Phase 1 |

### Phase 4: 教室模式（4 周）

| 任务 | 优先级 | 依赖 |
|------|--------|------|
| 多租户隔离 | P1 | Phase 1 |
| 教室创建与管理 | P2 | 多租户 |
| 学生进度实时看板 | P2 | 课程系统 |
| 教师分析报表 | P2 | 遥测系统 |

---

## 12. 技术架构

### 12.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    云端服务层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │技能仓库   │  │课程平台   │  │模型注册表 │  │舰队管理  │ │
│  │Registry  │  │Course    │  │Catalog   │  │Fleet    │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │用户认证   │  │遥测分析   │  │CDN 分发   │              │
│  │Auth      │  │Analytics │  │Storage   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS REST API
┌───────────────────────┼─────────────────────────────────┐
│              RDK Studio 客户端层                          │
│  ┌──────────────────┐ │ ┌──────────────────┐            │
│  │SkillSyncManager  │ │ │CoursePack Manager│            │
│  │ (热更新/缓存)    │ │ │ (导入/进度追踪)  │            │
│  └──────────────────┘ │ └──────────────────┘            │
│  ┌──────────────────┐ │ ┌──────────────────┐            │
│  │CatalogSync       │ │ │OTA Updater       │            │
│  │ (模型/应用同步)   │ │ │ (应用级更新)     │            │
│  └──────────────────┘ │ └──────────────────┘            │
│                       │                                  │
│  ┌────────────────────┴──────────────────────┐          │
│  │          现有 RDKClaw Agent 系统            │          │
│  │  (工具链 + 技能注册表 + 生态注册表)          │          │
│  └───────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
                        │ SSH / WebSocket
┌───────────────────────┼─────────────────────────────────┐
│                 板端设备层                                │
│  ┌──────────────────┐ │ ┌──────────────────┐            │
│  │OpenClaw Agent    │ │ │BPU + ROS2 + GPIO │            │
│  │ (技能执行/协作)  │ │ │ (硬件能力层)     │            │
│  └──────────────────┘ │ └──────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

### 12.2 关键技术选型

| 模块 | 推荐技术 | 理由 |
|------|---------|------|
| 云端 API | Node.js + Express / Fastify | 与现有后端栈一致 |
| 数据库 | PostgreSQL + Redis | 结构化数据 + 高速缓存 |
| 文件存储 | S3 兼容存储（MinIO / 阿里云 OSS） | 技能包/课程包存储 |
| CDN | 阿里云 CDN / CloudFlare | 全球加速分发 |
| 搜索引擎 | Meilisearch / Elasticsearch | 技能语义搜索 |
| 用户认证 | JWT + OAuth2 | 支持第三方登录 |
| 桌面端更新 | electron-updater | Electron 官方方案 |

---

*本文档为 PRD 系列第 5 部分，详见：*
- *[prd-01-product-overview.md](prd-01-product-overview.md) — 产品概述与功能模块*
- *[prd-02-agent-system.md](prd-02-agent-system.md) — Agent 系统深度解析*
- *[prd-03-integration-operations.md](prd-03-integration-operations.md) — 集成、安全与运维*
- *[prd-04-api-reference.md](prd-04-api-reference.md) — API 端点与数据模型*
