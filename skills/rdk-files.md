---
name: rdk-files
description: "SFTP文件管理：浏览、编辑、上传、下载设备文件。Use when user wants to upload, download, browse files, 文件管理, 上传, 下载, 传文件."
version: 1.0.0
metadata: {"rdkstudio":{"category":"development","icon":"folder","requires":{"device":true},"tab":"files"}}
disableModelInvocation: true
---

# 文件管理

## When to Use
- 用户说：上传、下载、传文件、同步、推送文件
- 用户说：查看文件、打开文件、编辑文件
- 用户说：拉取日志、获取文件、download

## APIs

### 列出目录
```
GET /api/devices/{deviceId}/files/list?path=/userdata
Response: { ok: boolean, output: string, path: string }
```
返回 `ls -al` 格式的目录列表。默认路径 `/userdata`。

### 读取文件
```
GET /api/devices/{deviceId}/files/read?path=/path/to/file&lines=200
Response: { ok: boolean, output: string, contentBase64: string, path: string }
```

### 写入文件
```
POST /api/devices/{deviceId}/files/write
Body: { path: string, content: string, append?: boolean }
Response: { ok: boolean, output: string, path: string }
```

### 上传文件 (SFTP)
```
POST /api/devices/{deviceId}/files/upload
Body: { path: string, contentBase64: string }
Response: { ok: boolean, path: string }
```

### 下载文件
```
GET /api/devices/{deviceId}/files/download?path=/path/to/file
Response: { ok: boolean, path: string, contentBase64: string, isDir: boolean }
```
目录自动打包为 tar.gz。

## Client Actions
- 打开文件管理页面: `navigate:files`

## Safety
- 写入操作会覆盖文件内容（除非 append=true）
- 大文件上传受 50MB 限制
