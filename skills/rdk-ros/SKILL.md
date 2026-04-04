---
name: RDK ROS
description: TROS（TogetheROS.Bot，板端 ROS2 兼容栈；不是涂鸦/Tuya IoT 的「TuyaROS2」）话题与节点、rosbag。RDK 默认是 /opt/tros 下的 TROS；未 source 时 which ros2 可能为空——应先 ls /opt/tros 或 source …/setup.bash 再判断。触发：ROS、ROS2、节点、话题、rosbag、rosbridge。
version: 1.2.0
trigger: ros,topic,话题,节点,rosbag,录制,rosbridge,ROS2,扫描话题,TROS,tros,setup.bash,bashrc
risk: low
permissions: device_exec
delegate_preference: local
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
disableModelInvocation: false
---

# RDK ROS（TROS / ROS2）

## TROS 与「有没有 ROS 环境」

- RDK 板端中间件是 **TROS**（TogetheROS.Bot，常见路径 `/opt/tros/<distro>/`），与 **ROS2** 接口兼容；用户口语里的「ROS」在板上多数指 **已 source TROS 后的 ros2 CLI**。
- **误判来源**：非交互 SSH/脚本里若未 `source`，`which ros2` 可能为空、`ros2 topic list` 会失败，**不等于**未安装 TROS。应先检查是否已安装 setup 脚本，以及 **登录 shell 是否自动 source**。
- **推荐表述**：向用户说明「板上是 TROS（ROS2 兼容），需先加载 `/opt/tros/.../setup.bash`」，避免说「没有 ROS」。

### 检测 TROS 是否在 shell 中生效（`device_exec` 或本机终端）

```bash
# 典型安装路径是否存在（Humble 最常见，其它发行版可能是 foxy 等，以板上为准）
test -f /opt/tros/humble/setup.bash && echo "TROS humble setup 存在" || ls -d /opt/tros/*/setup.bash 2>/dev/null
# 当前用户 bashrc / profile 是否已自动 source TROS
grep -nE 'tros|setup\.bash|local_setup' ~/.bashrc ~/.profile 2>/dev/null || true
```

若 **`setup.bash` 存在** 但 **bashrc 中无 source**：交互式登录可临时执行 `source /opt/tros/humble/setup.bash`（路径以探测为准）。需要**持久化**时，在用户确认后可在 `~/.bashrc` 末尾追加一行，例如：

```bash
# 仅当用户明确要求写入且路径已确认存在时
echo 'source /opt/tros/humble/setup.bash' >> ~/.bashrc
```

追加后新开终端或 `source ~/.bashrc` 再测 `ros2 --help`。

## 官方文档交叉核验（必做）

在板上用 `device_exec` / `find` / `ros2 launch` 等**找到包路径、launch 文件或可运行命令后**，不要仅凭板上目录下结论：必须用 **`web_fetch`** 打开 **https://developer.d-robotics.cc/rdk_doc** 上与该场景对应的文档页（如 TROS/ROS2、算法包、NodeHub 说明），核对**当前官方推荐的 launch 参数、依赖与版本说明是否更新**，再在回复中同时写明「板上路径」与「文档要点」。本地 `/tmp/rdk_doc` 若与官网不一致，**以官网为准**并提醒用户同步镜像或文档。

## 适用场景
- 用户说：ROS、ROS2、TROS、topic、话题、节点、扫描话题。
- 用户问「板上有没有 ROS」——先按上文区分 **TROS 已装未 source** vs **未安装**。
- 用户想录制或回放 rosbag。
- 用户想查看 ROS2 节点状态。

## 切换例程或清理节点时：必须带上 USB 摄像头链路

从一类官方演示换到另一类（如 YOLO `dnn_node_example` ↔ 人体检测 `mono2d_body_detection`）、或「停掉上一批再启新 pipeline」时，**只停推理/算法包往往不够**。

- **易遗漏**：`hobot_usb_cam`、`hobot_codec_republish` / `hobot_codec`，以及同链路上的 **websocket / nginx** 等仍存活 → 多实例、`/hbmem_img` 异常、Web 无图或推流缓存堆积。
- **做法**：清理步骤中**显式纳入** USB 输入链路与推理链（按当次 launch 实际拉起的进程名 `pkill` / `ros2 lifecycle` / `ros2 daemon stop` 等，以现场为准），再启动新例程。
- **RDKClaw / 板端 OpenClaw**：在 `device_exec` 或 `board_openclaw_delegate` 的 **guidance** 里写清「先停相机与编解码相关节点，再停推理，再起新栈」，避免只写 `pkill -f dnn_node_example` 一类。

## 执行流程
1. **获取话题列表**：调用 `GET /api/devices/{deviceId}/ros/topics` 查看当前活跃的 ROS2 话题。
2. **获取节点列表**：调用 `GET /api/devices/{deviceId}/ros/nodes` 查看正在运行的 ROS2 节点。
3. **录制操作**（可选）：
   - 调用 `POST /api/devices/{deviceId}/ros/record/start` 开始录制（可指定话题或录制全部）。
   - 调用 `POST /api/devices/{deviceId}/ros/record/stop` 停止录制。

## 工具映射

| API | 用途 | 必需 |
|-----|------|------|
| `GET .../ros/topics` | 获取 ROS2 话题列表 | 是 |
| `GET .../ros/nodes` | 列出 ROS2 节点 | 否 |
| `POST .../ros/record/start` | 开始 rosbag 录制 | 否 |
| `POST .../ros/record/stop` | 停止 rosbag 录制 | 否 |

### API 详细参数

**获取 ROS2 话题列表**
```
GET /api/devices/{deviceId}/ros/topics
Response: { ok: boolean, topics: string[], output: string }
```

**列出 ROS2 节点**
```
GET /api/devices/{deviceId}/ros/nodes
Response: { ok: boolean, nodes: string[], output: string }
```

**开始 rosbag 录制**
```
POST /api/devices/{deviceId}/ros/record/start
Body: { topics?: string[], outputPath?: string }
Response: { ok: boolean, output: string, path: string }
```
不指定 topics 时录制所有话题（`-a`）。

**停止 rosbag 录制**
```
POST /api/devices/{deviceId}/ros/record/stop
Response: { ok: boolean, output: string }
```

### Client Actions
- 打开 ROS 页面: `navigate:ros`

## 输出要求
- 话题列表需格式化展示（话题名 + 消息类型）。
- 节点列表需展示节点全名。
- 录制操作需报告：录制状态、输出路径、涉及的话题。

## 禁止事项
- **ROS2 依赖环境**：底层为 **TROS**；API/命令依赖已加载的 overlay（常见 `source /opt/tros/humble/setup.bash`）。若接口返回 `ROS2_NOT_INSTALLED` 或明显失败，先区分 **未安装 TROS** vs **未 source**（见上文检测命令），勿笼统说「没有 ROS」。
- **不在 TROS 未安装时强行执行 ROS 命令**：应先引导用户按官方文档安装 TROS；若仅未写入 bashrc，说明 source 与持久化方式。
- **修改 `~/.bashrc` 须用户确认**：不静默覆盖用户环境。
- **Webviz 可视化依赖 rosbridge**：如需可视化需先确认 rosbridge 服务运行。
