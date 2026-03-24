---
name: RDK Files
description: SFTP 文件管理——浏览、读取、写入、上传、下载设备文件。触发词：上传、下载、传文件、查看文件、编辑文件、拉取日志、文件管理、browse files、upload、download。
version: 1.0.0
trigger: 上传,下载,传文件,查看文件,编辑文件,拉取日志,文件管理,browse files,upload,download
risk: low
permissions: workspace_read,device_exec,network
delegate_preference: local
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
disableModelInvocation: true
---

# RDK Files

## 适用场景
- 用户说：上传、下载、传文件、同步、推送文件。
- 用户说：查看文件、打开文件、编辑文件。
- 用户说：拉取日志、获取文件、download。
- 需要通过 SFTP 对设备进行文件操作。

## 执行流程
1. **确认路径**：确认用户目标路径（默认 `/userdata`），调用 `GET /api/devices/{deviceId}/files/list?path=<path>` 列出目录内容。
2. **读取文件**：调用 `GET /api/devices/{deviceId}/files/read?path=<path>&lines=200` 获取文件内容（支持行数限制）。
3. **写入文件**：调用 `POST /api/devices/{deviceId}/files/write`，body 为 `{ path, content, append? }`，覆盖或追加写入。
4. **上传文件**：调用 `POST /api/devices/{deviceId}/files/upload`，body 为 `{ path, contentBase64 }`，通过 SFTP 上传到设备。
5. **下载文件**：调用 `GET /api/devices/{deviceId}/files/download?path=<path>`，返回 base64 内容；目录自动打包为 tar.gz。
6. **导航到文件页面**：需要时发出 `navigate:files` 客户端动作打开文件管理 UI。

## 工具映射

| 工具 / API | 用途 | 必需 |
|------------|------|------|
| `GET /api/devices/{deviceId}/files/list` | 列出目录（ls -al 格式） | 否 |
| `GET /api/devices/{deviceId}/files/read` | 读取文件内容 | 否 |
| `POST /api/devices/{deviceId}/files/write` | 写入/追加文件 | 否 |
| `POST /api/devices/{deviceId}/files/upload` | SFTP 上传文件（base64） | 否 |
| `GET /api/devices/{deviceId}/files/download` | 下载文件（目录自动 tar.gz） | 否 |
| `navigate:files` | 打开文件管理页面 | 否 |

## 输出要求
- 列目录时以可读表格或列表展示文件名、大小、权限。
- 读取文件内容后摘要关键信息，不要原样倾倒大段文本。
- 写入/上传完成后确认路径和状态（ok / 失败原因）。
- 下载时告知用户文件大小，目录下载说明为 tar.gz 压缩包。

## 禁止事项
- **不在未确认路径时写入文件**：写入操作会覆盖内容，必须先确认目标路径。
- **不忽略 50MB 上传限制**：超限时需提前告知用户并建议分片或压缩。
- **不静默吞掉失败**：任何 API 返回 `ok: false` 时必须将错误信息呈现给用户。
