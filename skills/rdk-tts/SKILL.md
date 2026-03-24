---
name: RDK TTS
description: 文字转语音（Text-to-Speech）。将文本合成为自然语音音频，支持中英文多种音色。用户说"朗读"、"念出来"、"TTS"、"语音合成"、"播报"时使用。
version: 1.0.0
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

使用 edge-tts（微软 Edge 在线语音合成）将文本转为高质量 MP3 音频。

## 能力

- 中文：小晓(女)、云希(男)、晓伊(女温柔)、云健(男沉稳) 等 20+ 音色
- 英文：Jenny(女)、Guy(男) 等
- 支持语速调节（-50% ~ +100%）
- 输出 MP3 格式，可直接播放

## 使用场景

- "把这段文字念出来"
- "用语音播报今天的天气"
- "生成一段中文语音：你好世界"
- "朗读这篇文章"
- "用男声读一下这个"

## 前置条件

- 设备需联网（edge-tts 依赖在线服务）
- Python3 已安装
- edge-tts 会在首次使用时自动安装

## 工具

Agent 通过 `text_to_speech` 工具调用，参数：
- `text`（必填）：要合成的文字
- `voice`（可选）：音色名称，默认 zh-CN-XiaoxiaoNeural
- `speed`（可选）：语速，如 "+20%"、"-10%"

## 可用音色（常用）

- zh-CN-XiaoxiaoNeural: 中文女, 活泼自然（默认）
- zh-CN-YunxiNeural: 中文男, 清朗
- zh-CN-XiaoyiNeural: 中文女, 温柔
- zh-CN-YunjianNeural: 中文男, 沉稳
- en-US-JennyNeural: 英文女, 自然
- en-US-GuyNeural: 英文男, 自然
