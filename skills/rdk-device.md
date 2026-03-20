---
name: rdk-device
description: "设备管理：连接、验证、扫描、删除RDK开发板。Use when user mentions device, connect, scan, 设备, 连接, 扫描, 搜索设备."
version: 1.0.0
metadata: {"rdkstudio":{"category":"system","icon":"hard-drive","requires":{}}}
---

# 设备管理

## When to Use
- 用户说：扫描设备、搜索设备、连接设备
- 用户想添加或删除设备
- 用户想检查设备在线状态

## APIs

### 获取设备列表
```
GET /api/devices
Response: { devices: Device[] }
```
Device: { id, host, port, username, status, lastCheckedAt }

### 连接设备
```
POST /api/devices/connect
Body: { host: string, port?: number, username: string, password: string }
Response: { device: Device }
```

### 验证连接
```
POST /api/devices/verify
Body: { host: string, port?: number, username: string, password: string }
Response: { ok: boolean }
```

### 检测设备在线
```
GET /api/devices/{deviceId}/ping
Response: { ok: boolean, status: "connected" | "offline" }
```

### 删除设备
```
DELETE /api/devices/{deviceId}
Response: { removedId: string }
```

### 局域网扫描
```
POST /api/devices/scan
Response: { ok: boolean, devices: Array<{ ip: string, port: number }>, subnets: string[] }
```
扫描本机所在子网的 SSH 端口（22）。

## Client Actions
- 扫描设备: `scanDevices`

## Notes
- 默认 SSH 端口 22
- 密码通过 `x-device-password` header 或已缓存的凭证传递
