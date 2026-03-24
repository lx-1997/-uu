---
name: RDK Device
description: 设备管理 REST API：连接、验证、扫描、删除 RDK 开发板。触发词：设备、连接、扫描、搜索设备、添加设备、删除设备。
version: 1.0.0
trigger: 设备,连接,扫描,搜索设备,添加设备,删除设备,device,connect,scan,ping
risk: low
permissions: network
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# RDK Device

> **互补关系**：本技能专注于设备管理 REST API（连接、验证、扫描、删除）。
> 设备运维操作（命令执行、文件读写、ROS、VNC、诊断）请参考 → `rdk-device-ops/SKILL.md`。

## 适用场景
- 用户说：扫描设备、搜索设备、连接设备。
- 用户想添加或删除设备。
- 用户想检查设备在线状态。
- 用户想获取已管理的设备列表。

## 执行流程
1. **获取设备列表**：调用 `GET /api/devices` 查看当前已管理的所有设备。
2. **扫描局域网**（可选）：调用 `POST /api/devices/scan` 扫描本机所在子网的 SSH 端口，发现可用设备。
3. **验证连接**：调用 `POST /api/devices/verify` 验证 SSH 凭证是否正确。
4. **连接设备**：调用 `POST /api/devices/connect` 将设备添加到管理列表。
5. **状态监测**：调用 `GET /api/devices/{deviceId}/ping` 检测设备在线状态。

## 工具映射

| API | 用途 | 必需 |
|-----|------|------|
| `GET /api/devices` | 获取设备列表 | 否 |
| `POST /api/devices/connect` | 连接设备（添加到管理列表） | 是 |
| `POST /api/devices/verify` | 验证 SSH 连接凭证 | 否 |
| `GET /api/devices/{deviceId}/ping` | 检测设备在线状态 | 否 |
| `DELETE /api/devices/{deviceId}` | 删除设备 | 否 |
| `POST /api/devices/scan` | 局域网扫描 | 否 |

### API 详细参数

**获取设备列表**
```
GET /api/devices
Response: { devices: Device[] }
```
Device: `{ id, host, port, username, status, lastCheckedAt }`

**连接设备**
```
POST /api/devices/connect
Body: { host: string, port?: number, username: string, password: string }
Response: { device: Device }
```

**验证连接**
```
POST /api/devices/verify
Body: { host: string, port?: number, username: string, password: string }
Response: { ok: boolean }
```

**检测设备在线**
```
GET /api/devices/{deviceId}/ping
Response: { ok: boolean, status: "connected" | "offline" }
```

**删除设备**
```
DELETE /api/devices/{deviceId}
Response: { removedId: string }
```

**局域网扫描**
```
POST /api/devices/scan
Response: { ok: boolean, devices: Array<{ ip: string, port: number }>, subnets: string[] }
```

### Client Actions
- 扫描设备: `scanDevices`

## 输出要求
- 连接成功后需展示：设备 ID、主机地址、端口、用户名、状态。
- 扫描结果需展示：发现的设备列表（IP + 端口）。
- 删除操作需确认：已删除的设备 ID。

## 禁止事项
- **不存储明文密码于日志或输出中**：密码通过 `x-device-password` header 或已缓存凭证传递，不得回显。
- **不在未验证的情况下标记设备为在线**：必须通过 ping 或 verify 确认。
- **默认 SSH 端口为 22**：除非用户指定，否则使用默认端口。
