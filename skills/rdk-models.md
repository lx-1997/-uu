---
name: rdk-models
description: "AI模型部署与管理：ModelZoo模型部署、运行、列出。Use when user mentions model, deploy, yolo, onnx, 模型, 部署, 推理, model zoo."
version: 1.0.0
metadata: {"rdkstudio":{"category":"ai","icon":"cpu","requires":{"device":true},"tab":"models"}}
---

# 模型部署

## When to Use
- 用户说：模型部署、deploy、转换、ONNX、YOLO、模型
- 用户想查看已部署的模型列表
- 用户想运行推理示例

## APIs

### 列出已部署模型
```
GET /api/devices/{deviceId}/models/list
Response: { ok: boolean, output: string }
```
扫描 /opt/rdk_model_zoo/models、/userdata 中的 .bin/.onnx 文件，以及运行中的推理进程。

### 执行模型部署命令
```
POST /api/devices/{deviceId}/models/deploy
Body: { command: string }
Response: { ok: boolean, output: string }
```
CAUTION: 部署命令在设备上直接执行，需确认命令内容。

## Client Actions
- 打开模型页面: `navigate:models`

## Safety
- 部署命令直接在设备执行，需要用户确认
- 大模型下载可能耗时较长
- BPU 编译需要足够的内存和存储空间
