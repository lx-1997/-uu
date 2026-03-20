---
name: rdk-ros
description: "ROS2话题管理与录制：扫描话题、列出节点、rosbag录制。Use when user mentions ros, topic, 话题, 节点, rosbag, 录制, rosbridge."
version: 1.0.0
metadata: {"rdkstudio":{"category":"robotics","icon":"radio","requires":{"device":true},"tab":"ros"}}
---

# ROS2

## When to Use
- 用户说：ROS、topic、话题、节点、扫描话题
- 用户想录制或回放 rosbag
- 用户想查看 ROS2 节点状态

## APIs

### 获取 ROS2 话题列表
```
GET /api/devices/{deviceId}/ros/topics
Response: { ok: boolean, topics: string[], output: string }
```

### 列出 ROS2 节点
```
GET /api/devices/{deviceId}/ros/nodes
Response: { ok: boolean, nodes: string[], output: string }
```

### 开始 rosbag 录制
```
POST /api/devices/{deviceId}/ros/record/start
Body: { topics?: string[], outputPath?: string }
Response: { ok: boolean, output: string, path: string }
```
不指定 topics 时录制所有话题（-a）。

### 停止 rosbag 录制
```
POST /api/devices/{deviceId}/ros/record/stop
Response: { ok: boolean, output: string }
```

## Client Actions
- 打开 ROS 页面: `navigate:ros`

## Notes
- ROS2 命令依赖 `/opt/tros/humble/setup.bash` 环境
- 如果返回 ROS2_NOT_INSTALLED，说明设备未安装 TROS
- Webviz 可视化需要 rosbridge 服务运行
