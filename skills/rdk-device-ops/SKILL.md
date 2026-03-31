---
name: RDK Device Ops
description: 处理 RDK Studio 侧的设备运维与文件操作任务，优先走软件端工具。
version: 1.0.0
trigger: device,ssh,终端,命令执行,文件上传,文件下载,ros,vnc,诊断
risk: medium
permissions: workspace_read,workspace_write,device_exec
delegate_preference: local
requires_board: false
approval_level: confirm
cooldown_seconds: 0
scheduler_template: local_device_ops
category: DevOps
---

# RDK Device Ops

## 适用场景

- 用户要求在 RDK Studio 软件侧执行设备命令、文件读写、ROS/VNC/诊断操作
- 用户明确提供了设备上下文，并且任务不要求板端 OpenClaw 插件链路
- "帮我看一下设备磁盘还剩多少"
- "把这个文件上传到设备"
- "启动 VNC 远程桌面"

## 执行流程

### 前置：板型感知
不同板型的系统路径和命令可能不同。执行操作前注意：
- X3：默认用户 `sunrise`（非 root），Ubuntu 20.04，TROS Foxy
- X5/S100：默认用户 `root`，Ubuntu 22.04，TROS Humble
- 文件路径、包管理命令、ROS source 命令因板型而异

1. **确认设备连接**：通过 `device_diagnose` 或上下文信息确认目标设备在线且 SSH 可达
2. **选择操作工具**：根据任务类型选择最小必要工具（命令执行、文件操作、ROS、VNC、诊断）
3. **执行操作**：文件操作优先精确路径，避免覆盖未知内容；涉及系统状态时先做只读检查，再做可能有副作用的操作
4. **验证结果**：通过读取/查询确认操作是否生效（如文件写入后读回确认、服务启动后检查状态）
5. **输出摘要**：向用户汇报执行结果，包含操作内容、结果状态和后续建议

## 工具映射

| 任务类型 | 工具 | 说明 |
|----------|------|------|
| 命令执行 | `device_exec` | 在设备上执行 shell 命令 |
| 文件读取 | `device_file_read` | 读取设备端文件内容 |
| 文件写入 | `device_file_write` | 向设备端写入文件 |
| 文件下载 | `device_file_download_to_local` | 从设备下载文件到本地 |
| 文件上传 | `device_file_upload_from_local` | 从本地上传文件到设备 |
| ROS 话题 | `ros_topics` | 查看 ROS Topic 列表 |
| ROS 节点 | `ros_nodes` | 查看 ROS Node 列表 |
| VNC 状态 | `vnc_status` | 查询 VNC 远程桌面状态 |
| VNC 启动 | `vnc_start` | 启动 VNC 远程桌面 |
| VNC 停止 | `vnc_stop` | 停止 VNC 远程桌面 |
| 设备诊断 | `device_diagnose` | 综合诊断设备状态（CPU/内存/磁盘/温度） |

## 输出要求

每次操作必须包含以下三项：
- **操作结果**：明确说明执行了什么、是否成功
- **关键指标变化**：如磁盘占用变化、服务状态变化、文件大小等可量化的信息
- **下一步建议**：操作成功时给出后续可选操作；失败时给出排查方向或替代方案

输出示例：
```
✅ 文件上传成功：model.onnx → /userdata/models/model.onnx（128MB）
   磁盘剩余：1.2GB → 1.07GB
   建议：可通过 device_file_read 确认文件完整性
```

## 禁止事项

- 不在设备断连时执行命令（先确认连接状态）
- 不跳过验证步骤（写入后必须读回确认，启动后必须检查状态）
- 不执行未确认的危险命令（`rm -rf /`、`dd if=/dev/zero`、`mkfs` 等破坏性操作须用户二次确认）
- 不在未确认路径的情况下覆盖文件（优先检查目标路径是否已有内容）
- 不在单次操作中混合多个不相关的写入任务
