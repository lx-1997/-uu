---
name: rdk-stt
description: "语音转文字（STT）。Use when user wants speech-to-text, 语音识别, 听写, 音频转文字, transcribe, STT."
version: 1.0.0
metadata: {"rdkstudio":{"category":"AI","icon":"mic","requires":{"device":true}}}
---

# STT 语音转文字

## When to Use
- 用户说：语音识别、听写、音频转文字、STT、transcribe
- 用户说：识别这段音频、这个录音说了什么
- 用户上传了音频文件并要求识别内容

## Tool

### speech_to_text
Agent 工具，通过 SSH 在设备上运行 SpeechRecognition + Google API 识别音频。

参数：
- `audio_path` (string, required): 设备上的音频文件绝对路径
- `language` (string, optional): 识别语言，默认 zh-CN

返回 JSON，含 `text` 识别结果。

## 支持格式

WAV（直接识别）、MP3/FLAC/OGG/WebM（自动通过 pydub 转换为 WAV）

## 支持语言

| 代码 | 语言 |
|------|------|
| zh-CN | 中文（简体） |
| en-US | 英文 |
| ja | 日语 |
| ko | 韩语 |
| zh-TW | 中文（繁体） |

## 注意事项
- 需要设备联网（Google Speech Recognition API）
- 首次使用自动 pip install SpeechRecognition pydub
- 非 WAV 格式需要 ffmpeg（RDK 系统通常已预装）
- 单次识别音频建议不超过 60 秒
