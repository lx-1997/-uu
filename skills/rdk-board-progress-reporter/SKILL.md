---
name: RDK Board Progress Reporter
description: 板端 OpenClaw 执行 RDK/TROS 任务时的**可见性规范**：每一步用简短中文说明在做什么，避免长时间无输出；与 Studio 侧 tool_progress 流式展示对齐。
version: 1.0.0
trigger: 板端,openclaw,委派,进度,在做什么,没反应,看不到日志,rdk,tros,ros2 launch
risk: low
permissions: none
delegate_preference: board
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# RDK 板端进度可见性（OpenClaw）

## 目标

用户在 RDK Studio 里通过 **「板端 OpenClaw」协作块** 看你的流式输出。若你长时间只推理不说明，体验会像「卡住」。

## 必须遵守（执行中）

1. **分段标题**：每进入一个新阶段，先输出一行（可带序号）：
   - 格式：`[板端] 阶段名 · 一句话说明`  
   - 例：`[板端] 环境 · source /opt/tros/humble/setup.bash`  
   - 例：`[板端] 启动 · ros2 launch dnn_node_example ...（后台）`

2. **工具/终端前**：在运行 `exec`、安装包、或 `ros2 launch` **之前**，再输出一行「将要执行什么」（可复制命令可截断到 120 字）。

3. **长输出**：shell 若超过 ~30 行，只把**最后 15 行 + 退出码**当作摘要贴出，前面用 `[…省略…]`。

4. **官方例程快路径**：若 RDKClaw 的 `rdkclaw_guidance` 里已写明**可直接执行的完整命令**（含 `source`、`CAM_TYPE`、`ros2 launch`），**不要**再重复 `dpkg -l` / `ros2 pkg list` 探测同一包；先执行、报错再排障。

5. **时间意识**：标准演示（单 launch + Web 预览）目标在 **约 1 分钟内** 进入可验收状态（进程起来、端口监听或 topic 有数据）；安装大依赖则先说明预计耗时。

## 结束时的摘要

用 3～6 条 bullet 说明：做了什么、主进程/launch 名、如何验收（例：`curl` 端口、`ros2 topic hz`、浏览器 URL 用 **板卡实际 IP** 而非文档占位 IP）。

## 与 NEED_RDKCLAW

缺文档或需 Studio 联网时仍用 `[NEED_RDKCLAW]`；但在等待补充信息前，也应输出一行说明「正在等待 RDKClaw 补充哪类信息」。
