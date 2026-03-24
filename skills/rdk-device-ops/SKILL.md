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

## 执行策略
1. 先识别任务类型并选择最小必要工具。
2. 文件操作优先精确路径，避免覆盖未知内容。
3. 涉及系统状态时先做只读检查，再做可能有副作用的操作。
4. 输出必须包含：执行了什么、结果如何、失败时下一步建议。

## 推荐工具
- `device_exec`
- `device_file_read` / `device_file_write`
- `device_file_download_to_local` / `device_file_upload_from_local`
- `ros_topics` / `ros_nodes`
- `vnc_status` / `vnc_start` / `vnc_stop`
- `device_diagnose`
