---
name: RDK STT
description: 语音转文字（Speech-to-Text）。将音频文件识别为文本，支持中英文。用户说"语音识别"、"听写"、"音频转文字"、"STT"时使用。
version: 1.1.0
trigger: stt,语音识别,听写,音频转文字,speech to text,转录,transcribe,识别语音
risk: low
permissions: device_exec
delegate_preference: local
requires_board: true
approval_level: auto
cooldown_seconds: 0
scheduler_template: none
category: AI
---

# STT 语音转文字

支持两种模式：**离线模式**（推荐）和**在线模式**。

## 模式一：离线 STT（推荐）

使用 sherpa-onnx + SenseVoice（阿里开源）在设备端本地识别语音，无需联网。

### 前置条件
- 已运行 `sherpa_setup` 安装 sherpa-onnx 和模型
- 非 WAV 格式需要 ffmpeg

### 工具
Agent 通过 `sherpa_stt` 工具调用，参数：
- `audio_path`（必填）：设备上的音频文件路径
- `language`（可选）：auto（自动检测，默认）、zh、en、ja、ko、yue

### 特点
- 完全离线，无需联网
- 中英日韩粤五语言自动检测
- 支持标点恢复（ITN）
- 中文识别精度优于 Whisper

## 模式二：在线 STT

使用 Google Speech Recognition（在线）将音频文件转为文字。

### 前置条件
- 设备需联网
- Python3 已安装
- 非 WAV 格式需要 ffmpeg + pydub

### 工具
Agent 通过 `speech_to_text` 工具调用，参数：
- `audio_path`（必填）：设备上的音频文件路径
- `language`（可选）：识别语言，默认 zh-CN

### 支持语言
- zh-CN: 中文（简体，默认）
- en-US: 英文
- ja: 日语
- ko: 韩语
- zh-TW: 中文（繁体）

## 使用场景

- "识别这段音频的内容"
- "把这个录音转成文字"
- "听写 /tmp/recording.wav"
- "这段语音说了什么"

## 选择建议

- 设备无网络 / 低延迟需求 → 使用 `sherpa_stt`（离线）
- 需要更多语言支持（繁体中文等） → 使用 `speech_to_text`（在线）

## 注意事项
- 单次识别音频建议不超过 120 秒（离线）或 60 秒（在线）
- 返回 JSON 包含 `text` 识别结果
