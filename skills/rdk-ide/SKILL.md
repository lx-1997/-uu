---
name: RDK IDE
description: 嵌入式 code-server 在线 IDE 管理——安装、启动、状态检查。触发词：写代码、编辑代码、打开编辑器、IDE、code-server、开发。
version: 1.0.0
trigger: 写代码,编辑代码,打开编辑器,IDE,code-server,开发
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

# RDK IDE

## 适用场景
- 用户说：写代码、编辑代码、打开编辑器、IDE、code-server。
- 用户想在设备上进行在线代码开发。
- 需要安装、启动或检查 code-server 服务状态。

## 执行流程
1. **检查状态**：调用 `POST /api/devices/{deviceId}/exec`，命令 `pgrep -af code-server || echo NOT_RUNNING`，确认 code-server 是否已运行。
2. **安装**（首次）：若未安装，调用 `POST /api/devices/{deviceId}/exec`，命令 `curl -fsSL https://code-server.dev/install.sh | sh`。
3. **启动服务**：调用 `POST /api/devices/{deviceId}/exec`，命令 `code-server --bind-addr 0.0.0.0:8080 --auth none &`。
4. **导航到 IDE 页面**：发出 `navigate:ide` 客户端动作，通过 iframe 嵌入 code-server 界面。

## 工具映射

| 工具 / API | 用途 | 必需 |
|------------|------|------|
| `POST /api/devices/{deviceId}/exec` | 安装 / 启动 / 检查 code-server | 是 |
| `navigate:ide` | 打开 IDE 页面（iframe 嵌入） | 否 |

## 输出要求
- 启动前先告知当前状态（已运行 / 未安装 / 已安装未启动）。
- 安装过程较长时提醒用户耐心等待。
- 启动成功后告知访问地址（设备 IP:8080）。

## 禁止事项
- **不跳过状态检查直接安装**：避免重复安装，先 `pgrep` 确认。
- **不使用带密码的启动方式**：统一使用 `--auth none`，安全由网络层保障。
- **不忽略安装失败**：安装命令返回非 0 时必须告知用户并建议手动排查。
