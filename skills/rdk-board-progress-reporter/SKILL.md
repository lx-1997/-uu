---
name: RDK Board Progress Reporter
description: 板端 OpenClaw 向 RDK Studio 汇报进度时的**高质量可见性**：禁止「处理数据/执行脚本」等空泛描述；每条进度须含具体对象（包名、launch、节点、设备路径）、动作与可验证结果；与 tool_progress 流式块对齐。
version: 1.1.0
trigger: 板端,openclaw,委派,进度,在做什么,没反应,看不到日志,rdk,tros,ros2 launch,可见性,板端日志
risk: low
permissions: none
delegate_preference: board
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# RDK Board Progress Reporter（板端可见性 · 高质量）

## 为什么需要这个技能

RDK Studio 的协作区会把你的工具调用映射成「步骤 · 某某 · 执行中」——若你只产生**泛化**的 tool 名，用户会看到 **「处理数据」「执行脚本」** 等**毫无信息量**的列表，像截图里那样。

**本技能要求：除了框架自带的简短标记外，你必须主动打出带 `[板端]` 前缀的中文行**，每一行对用户都要**可读懂、可核对**，否则视为未达标。

---

## 硬性格式（每条进度至少满足其一）

### A. 阶段行（进入新阶段时必发）

单行，格式：

```text
[板端] <阶段> · <具体在做什么> [| 当前结果或状态]
```

- **阶段** 建议从下列中选：`环境` `依赖` `配置` `启动` `验证` `清理` `排障`
- **具体在做什么** 必须出现**真实标识符**之一：包名、`*.launch.py`、节点名、`/dev/video*`、`CAM_TYPE`、端口号、topic 名

**合格示例：**

- `[板端] 环境 · source /opt/tros/humble/setup.bash（已执行）`
- `[板端] 启动 · ros2 launch dnn_node_example dnn_node_example.launch.py（后台，CAM_TYPE=usb）`
- `[板端] 验证 · ss -tlnp | grep 8000 → LISTEN nginx`
- `[板端] 清理 · pkill -f hobot_usb_cam 后确认无 /dev/video0 占用`

**不合格示例（禁止作为主说明）：**

- 「处理数据」「执行脚本」「分析结果」「运行命令」——**不许**单独出现，必须说成「处理**什么**数据」「执行**哪条**脚本」。

### B. 结果行（每个重要 shell / launch 结束后紧跟）

```text
[板端] 结果 · <上一步简述> → exit <码> | <一句结论，如：端口 8000 已监听>
```

若命令后台运行，写：`→ 后台 PID 约 xxx 或见 nohup 路径`（若可知）。

---

## 推荐叙述节奏（TROS / ROS2 演示）

按顺序发 `[板端]` 行，不要跳步静默：

1. **环境**：`source` 哪套 setup、当前工作空间（若有）。
2. **输入设备**：USB/MIPI、`/dev/video*`、`CAM_TYPE` 取值依据（上一句探测结论）。
3. **启动**：完整 launch **名称**（可截断参数，但须保留包名与 launch 文件名）。
4. **验收**：`ros2 node list` / `ros2 topic list` / `ss -tlnp` / `curl -sI` 中**任选一条**与任务相关，并写出**关键一行输出**。
5. **Web 预览**：URL 必须用**板卡当前 IP**（`ip -br a` / `hostname -I`），**禁止**抄文档里的 `192.168.1.100` 等占位 IP。

---

## USB 相机 / hobot_usb 反复崩溃时

在发下一条 launch 前，应用 **一行**说明清理动作，例如：

`[板端] 清理 · 停止旧 hobot_usb_cam / 相关 launch，lsof /dev/video0 无占用后再启动`

若见 `exit code -6` / `terminate called after throwing`，在 `[板端] 排障 · …` 中说明：可能设备仍被占用或参数与分辨率不匹配，并写出**下一步**（查文档章节或改参数），不要只重复同一条 launch。

---

## 与 `[TOOL:…]` 的关系

若你的运行时仍会产生 `[TOOL:…]` 行：**必须在同一轮或下一轮**补一条 `[板端]` 行，用自然语言解释「刚才那步实际对应板上的什么事」，避免用户只看 UI 映射仍一头雾水。

---

## 收尾摘要（任务结束前必发）

用编号列表 3～6 条，每条**一行一件事**，必须包含：

- 最终采用的 **launch 全名**（`包/launch.py`）或等价命令；
- **验收方式**（命令 + 期望现象一句）；
- **浏览器预览**（若适用）：`http://<真实IP>:<端口>`，IP 与 `ip -br a` 一致。

---

## 与 `[NEED_RDKCLAW]`

若需 Studio 联网补文档：先发一行  
`[板端] 等待 · 需 RDKClaw 补充：<类型/问题>`  
再写 `[NEED_RDKCLAW]` 块。

---

## 自检清单（发最终答复前心里过一遍）

- [ ] 是否**从未**单独使用「处理数据 / 执行脚本」等模糊词作为主说明？
- [ ] 是否至少 3 条 `[板端]` 行含 **launch 或节点或 /dev/video** 等可核对标识？
- [ ] 摘要里的 URL 是否为**本机当前 IP**，而非文档示例网段？
