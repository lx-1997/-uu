# SKILLS.md — RDK Studio 技能清单

## 终端 (Terminal)
- `device_exec(command)`: 执行任意 shell 命令
- 用于: 安装软件、编译代码、查看日志、运行脚本

## 文件管理 (Files)
- `device_file_read(path)`: 读取文件
- `device_file_write(path, content)`: 写入文件
- `device_file_list(path)`: 列出目录
- `device_file_download_to_local(remotePath, localPath?)`: 从设备下载文件到本机（workspace/downloads 默认）
- `device_file_upload_from_local(localPath, remotePath)`: 从本机上传文件到设备
- 用于: 查看/编辑配置、上传代码、管理项目文件

## 硬件诊断 (Hardware)
- `device_diagnose()`: 获取 CPU 温度、BPU 负载、内存、磁盘
- 用于: 检查设备健康状态、排查性能问题

## ROS2 机器人开发 (ROS)
- `ros_topics()`: 列出 ROS2 topics
- `ros_nodes()`: 列出 ROS2 nodes
- 用于: 机器人开发、传感器调试、话题监控

## 远程桌面 (VNC)
- `vnc_start()`: 启动 VNC 服务
- `vnc_stop()`: 停止 VNC 服务
- `vnc_status()`: 检查 VNC 状态
- 用于: 查看设备图形界面、调试 GUI 应用

## 系统烧录 (Flash)
- `flash_check()`: 检查系统版本和烧录条件
- 用于: 系统升级、镜像烧录前检查

## 板端 OpenClaw (Board Agent)
- `board_openclaw(message)`: 将任务委托给板端 OpenClaw Agent
- `board_openclaw_status()`: 查看板端 OpenClaw 运行状态
- `board_openclaw_read_config(path?)`: 读取板端 OpenClaw 配置
- `board_openclaw_restart_gateway()`: 重启板端 OpenClaw 网关
- 用于: 板端专有的复杂任务（模型部署、TROS 配置等）

## 软件端自配置 (RDK Studio Claw)
- `studio_get_agent_config()`: 读取软件端 AI 配置（provider/model/baseUrl/hasApiKey）
- `studio_set_agent_config(provider, model, apiKey?, baseUrl?)`: 更新软件端 AI 配置
- 用于: 配置/切换 RDK Studio Claw 自身模型与连接信息
