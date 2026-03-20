---
name: rdk-flash
description: "烧录系统镜像到RDK开发板的SD卡或eMMC。Use when user wants to flash, burn image, install OS, 刷机, 重装系统, 烧录镜像."
version: 1.0.0
metadata: {"rdkstudio":{"category":"system","icon":"zap","requires":{"device":true},"tab":"flasher"}}
---

# 镜像烧录

## When to Use
- 用户说：烧录、刷机、flash、镜像、安装系统、重装系统
- 用户提到特定镜像：Ubuntu、TROS、ROS2 Humble
- 用户想更新开发板操作系统

## APIs

### 检查烧录环境
```
POST /api/devices/{deviceId}/flash/check
Response: { ok: boolean, output: string }
```
返回设备当前系统版本、存储空间、可用介质（eMMC/SD）和板型信息。

### 下载镜像到设备
```
POST /api/devices/{deviceId}/flash/download
Body: { imageUrl: string, targetPath?: string }
Response: { ok: boolean, output: string, path: string }
```

### 写入镜像到存储
```
POST /api/devices/{deviceId}/flash/write
Body: { imagePath: string, target?: "emmc" | "sd" | string }
Response: { ok: boolean, output: string }
```
CAUTION: 此操作会覆盖目标存储，不可逆。

### 执行完整烧录流程
```
POST /api/devices/{deviceId}/flash/execute
Body: { imageUrl: string, target?: string, board?: string, mode?: "network" | "local", wifiName?: string, wifiPass?: string, skipVerify?: boolean }
Response: { ok: boolean, output: string, strategy?: string, targetDevice?: string }
```
CAUTION: 一键烧录（下载→解压→写入→WiFi预配），必须先确认。

### 验证烧录结果
```
POST /api/devices/{deviceId}/flash/verify
Response: { ok: boolean, output: string }
```

## Client Actions
- 打开烧录页面: `navigate:flasher`

## Safety
- 执行烧录前必须获得用户明确确认
- 不能在没有连接设备的情况下执行
- 不要同时对多个设备烧录
- 写入操作会覆盖目标存储上所有数据
