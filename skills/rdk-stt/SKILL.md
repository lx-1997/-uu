---
name: RDK STT
description: 语音转文字（Speech-to-Text）。将音频文件识别为文本，支持中英文。用户说"语音识别"、"听写"、"音频转文字"、"STT"时使用。
version: 1.0.0
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

使用 Google Speech Recognition（在线）将音频文件转为文字。

## 能力

- 中文（zh-CN）、英文（en-US）、日语（ja）等多语言
- 支持 WAV、MP3、FLAC、OGG 等常见音频格式
- 非 WAV 格式自动通过 pydub + ffmpeg 转换
- 首次使用自动安装依赖（SpeechRecognition、pydub）

## 使用场景

- "识别这段音频的内容"
- "把这个录音转成文字"
- "听写 /tmp/recording.wav"
- "这段语音说了什么"

## 前置条件

- 设备需联网（使用 Google 在线语音识别）
- Python3 已安装
- 非 WAV 格式需要 ffmpeg（大多数 RDK 系统已预装）

## 工具

Agent 通过 `speech_to_text` 工具调用，参数：
- `audio_path`（必填）：设备上的音频文件路径
- `language`（可选）：识别语言，默认 zh-CN

## 支持语言

- zh-CN: 中文（简体，默认）
- en-US: 英文
- ja: 日语
- ko: 韩语
- zh-TW: 中文（繁体）

## 注意事项
- 单次识别音频建议不超过 60 秒
- 返回 JSON 包含 `text` 识别结果
