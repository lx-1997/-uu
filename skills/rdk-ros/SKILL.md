---
name: RDK ROS
description: ROS2 话题管理与 rosbag 录制：扫描话题、列出节点、录制/停止。触发词：ROS、话题、节点、rosbag、录制、rosbridge。
version: 1.0.0
trigger: ros,topic,话题,节点,rosbag,录制,rosbridge,ROS2,扫描话题
risk: low
permissions: device_exec
delegate_preference: local
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
disableModelInvocation: true
---

# RDK ROS

## 适用场景
- 用户说：ROS、topic、话题、节点、扫描话题。
- 用户想录制或回放 rosbag。
- 用户想查看 ROS2 节点状态。

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
- **ROS2 依赖环境**：命令依赖 `/opt/tros/humble/setup.bash`，如返回 ROS2_NOT_INSTALLED 需告知用户安装 TROS。
- **不在 TROS 未安装时强行执行 ROS 命令**：应先引导用户安装 TROS。
- **Webviz 可视化依赖 rosbridge**：如需可视化需先确认 rosbridge 服务运行。
