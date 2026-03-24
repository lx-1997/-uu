---
name: RDK Flash
description: 烧录系统镜像到 RDK 开发板的 SD 卡或 eMMC。触发词：烧录、刷机、flash、burn image、安装系统、重装系统、镜像备份。
version: 1.0.0
trigger: 烧录,刷机,flash,burn,镜像,安装系统,重装系统,install OS,backup image,镜像备份
risk: high
permissions: device_exec,network
delegate_preference: local
requires_board: true
approval_level: strict
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# RDK Flash

## 适用场景
- 用户说：烧录、刷机、flash、镜像、安装系统、重装系统。
- 用户提到特定镜像：Ubuntu、TROS、ROS2 Humble。
- 用户想更新开发板操作系统。
- 用户想备份当前系统镜像。

## 执行流程

### 烧录流程（必须按序）
1. **环境检查**：调用 `POST /api/devices/{deviceId}/flash/check` 获取当前系统版本、存储空间、可用介质（eMMC/SD）和板型信息。
2. **用户确认（必须）**：向用户展示检查结果，明确告知烧录将覆盖目标存储上所有数据，获得用户明确授权后方可继续。
3. **下载镜像**：调用 `POST /api/devices/{deviceId}/flash/download` 将镜像下载到设备。
4. **写入存储**：调用 `POST /api/devices/{deviceId}/flash/write` 将镜像写入目标存储。
5. **验证结果**：调用 `POST /api/devices/{deviceId}/flash/verify` 确认烧录成功。

### 一键烧录（快捷流程）
- 调用 `POST /api/devices/{deviceId}/flash/execute` 执行完整流程（下载→解压→写入→WiFi 预配）。
- 此接口同样需要先完成步骤 1–2 的环境检查与用户确认。

### 备份流程
1. **检查备份能力**：调用 `POST /api/devices/{deviceId}/flash/backup/check` 确认 rdk-backup 是否可用。
2. **启动备份**：调用 `POST /api/devices/{deviceId}/flash/backup/start` 创建备份任务。
3. **轮询状态**：调用 `GET /api/devices/{deviceId}/flash/backup/status?jobId=xxx` 监控进度。
4. **下载备份**：调用 `POST /api/devices/{deviceId}/flash/backup/download` 获取镜像文件。

## 工具映射

| API | 用途 | 必需 |
|-----|------|------|
| `POST .../flash/check` | 检查烧录环境（系统版本、存储、板型） | 是 |
| `POST .../flash/download` | 下载镜像到设备 | 是 |
| `POST .../flash/write` | 写入镜像到存储 | 是 |
| `POST .../flash/execute` | 一键烧录（下载→解压→写入→WiFi 预配） | 否（替代手动分步） |
| `POST .../flash/verify` | 验证烧录结果 | 是 |
| `POST .../flash/backup/check` | 检查板端备份能力 | 备份时必需 |
| `POST .../flash/backup/start` | 启动镜像备份任务 | 备份时必需 |
| `GET .../flash/backup/status` | 查询备份任务状态 | 备份时必需 |
| `POST .../flash/backup/download` | 下载备份镜像 | 备份时必需 |

### API 详细参数

**检查烧录环境**
```
POST /api/devices/{deviceId}/flash/check
Response: { ok: boolean, output: string }
```

**下载镜像到设备**
```
POST /api/devices/{deviceId}/flash/download
Body: { imageUrl: string, targetPath?: string }
Response: { ok: boolean, output: string, path: string }
```

**写入镜像到存储**
```
POST /api/devices/{deviceId}/flash/write
Body: { imagePath: string, target?: "emmc" | "sd" | string }
Response: { ok: boolean, output: string }
```

**执行完整烧录流程**
```
POST /api/devices/{deviceId}/flash/execute
Body: { imageUrl: string, target?: string, board?: string, mode?: "network" | "local", wifiName?: string, wifiPass?: string, skipVerify?: boolean }
Response: { ok: boolean, output: string, strategy?: string, targetDevice?: string }
```

**验证烧录结果**
```
POST /api/devices/{deviceId}/flash/verify
Response: { ok: boolean, output: string }
```

**检查备份能力**
```
POST /api/devices/{deviceId}/flash/backup/check
Response: { ok: boolean, available: boolean, output: string }
```

**启动备份**
```
POST /api/devices/{deviceId}/flash/backup/start
Body: { outputPath?: string, sourceDevice?: string }
Response: { ok: boolean, jobId: string, outputPath: string, output?: string, error?: string }
```

**查询备份状态**
```
GET /api/devices/{deviceId}/flash/backup/status?jobId=xxx
Response: { ok: boolean, job: { id, status, outputPath, output, error } }
```

**下载备份镜像**
```
POST /api/devices/{deviceId}/flash/backup/download
Body: { outputPath: string }
Response: { ok: boolean, path: string, contentBase64: string }
```

### Client Actions
- 打开烧录页面: `navigate:flasher`

## 输出要求
- 烧录前必须展示：目标设备、目标存储、镜像来源、将覆盖的数据警告。
- 烧录后必须报告：是否成功、写入的存储介质、验证结果。
- 备份操作需报告：任务进度、输出路径、文件大小。

## 禁止事项
- **绝对不可跳过用户确认**：烧录是不可逆操作，执行前必须获得用户明确同意。
- **不在未连接设备时执行**：设备离线或 SSH 不可达时不得调用任何烧录 API。
- **不同时对多个设备烧录**：避免并发烧录导致数据损坏。
- **不在未检查环境时直接写入**：必须先调用 check 确认存储空间和介质可用性。
- **备份前必须确认目标路径与磁盘空间**：避免空间不足导致备份失败或覆盖重要文件。
