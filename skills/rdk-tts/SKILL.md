---
name: RDK TTS
description: 文字转语音（Text-to-Speech）。将文本合成为自然语音音频，支持中英文多种音色。用户说"朗读"、"念出来"、"TTS"、"语音合成"、"播报"时使用。
version: 1.1.0
trigger: tts,语音,朗读,念,播报,text to speech,语音合成,文字转语音,说出来,读出来,音频,voice
risk: low
permissions: device_exec
delegate_preference: local
requires_board: true
approval_level: auto
cooldown_seconds: 0
scheduler_template: none
category: AI
---

# TTS 文字转语音

支持两种模式：**离线模式**（推荐）和**在线模式**。

## 模式一：离线 TTS（推荐）

使用 sherpa-onnx + Matcha-ICEFALL 中文模型在设备端本地合成，无需联网。

### 前置条件
- 已运行 `sherpa_setup` 安装 sherpa-onnx 和模型

### 工具
Agent 通过 `sherpa_tts` 工具调用，参数：
- `text`（必填）：要合成的文字
- `speed`（可选）：语速，1.0 正常，>1 加速，<1 减速

### 特点
- 完全离线，无需联网
- 中文女声（Baker 模型）
- 输出 WAV 格式
- 支持数字、日期、电话号码的自然朗读

## 模式二：在线 TTS

使用 edge-tts（微软 Edge 在线语音合成）将文本转为高质量 MP3 音频。

### 前置条件
- 设备需联网（edge-tts 依赖在线服务）
- Python3 已安装
- edge-tts 会在首次使用时自动安装

### 工具
Agent 通过 `text_to_speech` 工具调用，参数：
- `text`（必填）：要合成的文字
- `voice`（可选）：音色名称，默认 zh-CN-XiaoxiaoNeural
- `speed`（可选）：语速，如 "+20%"、"-10%"

### 可用音色（常用）

- zh-CN-XiaoxiaoNeural: 中文女, 活泼自然（默认）
- zh-CN-YunxiNeural: 中文男, 清朗
- zh-CN-XiaoyiNeural: 中文女, 温柔
- zh-CN-YunjianNeural: 中文男, 沉稳
- en-US-JennyNeural: 英文女, 自然
- en-US-GuyNeural: 英文男, 自然

## 使用场景

- "把这段文字念出来"
- "用语音播报今天的天气"
- "生成一段中文语音：你好世界"
- "朗读这篇文章"

## 选择建议

- 设备无网络 / 低延迟需求 → 使用 `sherpa_tts`（离线）
- 需要多种音色 / 英文高质量 → 使用 `text_to_speech`（在线）
