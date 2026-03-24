---
name: RDK Voice Chat
description: 离线语音对话。在 RDK 设备上使用 sherpa-onnx 进行本地语音识别（STT）和语音合成（TTS），无需联网即可实现流畅对话。
version: 1.0.0
trigger: 语音对话,语音聊天,voice chat,对话模式,语音助手,离线语音,sherpa,本地语音,语音交互
risk: low
permissions: device_exec
delegate_preference: local
requires_board: true
approval_level: auto
cooldown_seconds: 0
scheduler_template: none
category: AI
---

# 离线语音对话

基于 sherpa-onnx 在 RDK 设备端实现完全离线的语音识别和语音合成，无需联网。

## 技术栈

- **ASR（语音转文字）**：SenseVoice INT8（阿里开源，中英日韩粤五语言）
- **TTS（文字转语音）**：Matcha-ICEFALL 中文 Baker 模型（女声）
- **框架**：sherpa-onnx（k2-fsa 开源，11k+ stars）

## 使用场景

- "在设备上部署离线语音对话"
- "让设备能听懂我说话并回复语音"
- "设置设备端的语音助手"
- "不联网也能做语音识别"

## 前置条件

- RDK 设备已连接
- Python3 已安装
- 磁盘空间 >= 500MB（模型文件约 350MB）
- 首次使用需联网下载模型（之后完全离线）

## 执行流程

1. **环境检查与安装**：调用 `sherpa_setup`，安装 sherpa-onnx 并下载 ASR/TTS 模型（幂等，已安装则跳过）
2. **语音识别（STT）**：调用 `sherpa_stt`，将设备上的音频文件转为文字
3. **对话处理**：将识别文本交给 LLM 生成回复
4. **语音合成（TTS）**：调用 `sherpa_tts`，将回复文字转为语音并播放

## 工具映射

| 步骤 | 工具 | 说明 |
|------|------|------|
| 环境安装 | `sherpa_setup` | 一键安装 sherpa-onnx + 下载所有模型（首次约 350MB） |
| 语音识别 | `sherpa_stt` | 离线 ASR，支持 wav/mp3/flac 等格式 |
| 语音合成 | `sherpa_tts` | 离线 TTS，输出 WAV 格式音频 |

## 在线方案降级

离线工具（`sherpa_tts` / `sherpa_stt`）失败时，**必须先询问用户**是否改用在线方案，不可自动切换。

流程：
1. 调用离线工具
2. 如果返回中包含 `[离线方案失败]`，向用户说明失败原因
3. 询问用户："离线语音方案执行失败，是否改用在线方案？（需要设备联网）"
4. 用户同意后，改用对应在线工具：
   - `sherpa_tts` 失败 → 改用 `text_to_speech`（edge-tts 在线合成，音色更丰富）
   - `sherpa_stt` 失败 → 改用 `speech_to_text`（Google 在线识别）

## 模型信息

| 模型 | 大小 | 用途 |
|------|------|------|
| SenseVoice INT8 | ~228MB | 语音识别（中英日韩粤） |
| Matcha-ICEFALL zh-baker | ~72MB | 中文语音合成 |
| Vocos vocoder | ~51MB | TTS 声码器 |
| Silero VAD | ~2MB | 语音活动检测 |

## 禁止事项

- 不要在低存储空间（< 500MB 可用）设备上强行安装
- 不要同时运行多个 TTS/STT 任务（ARM 设备 CPU 有限）
- 识别音频建议不超过 120 秒（避免内存溢出）
