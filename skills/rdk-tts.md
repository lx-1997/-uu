---
name: rdk-tts
description: "文字转语音（TTS）。Use when user wants text-to-speech, 朗读, 念出来, 播报, 语音合成, TTS, voice synthesis."
version: 1.0.0
metadata: {"rdkstudio":{"category":"AI","icon":"volume-2","requires":{"device":true}}}
---

# TTS 文字转语音

## When to Use
- 用户说：朗读、念出来、读一下、TTS、语音合成、播报
- 用户说：把这段话转成语音、生成语音、text to speech
- 用户说：用语音说、读给我听

## Tool

### text_to_speech
Agent 工具，通过 SSH 在设备上运行 edge-tts 合成音频。

参数：
- `text` (string, required): 要合成的文字
- `voice` (string, optional): 音色。中文: zh-CN-XiaoxiaoNeural(女), zh-CN-YunxiNeural(男); 英文: en-US-JennyNeural(女)
- `speed` (string, optional): 语速，如 "+20%", "-10%"

返回 JSON，含 `audioUrl` 可播放链接和 `message` 描述。

## 可用音色（常用）

| 音色 | 语言 | 性别 | 风格 |
|------|------|------|------|
| zh-CN-XiaoxiaoNeural | 中文 | 女 | 活泼自然 |
| zh-CN-YunxiNeural | 中文 | 男 | 清朗 |
| zh-CN-XiaoyiNeural | 中文 | 女 | 温柔 |
| zh-CN-YunjianNeural | 中文 | 男 | 沉稳 |
| en-US-JennyNeural | 英文 | 女 | 自然 |
| en-US-GuyNeural | 英文 | 男 | 自然 |

## 注意事项
- 需要设备联网
- 首次使用会自动 pip install edge-tts
- 输出 MP3 文件，下载到 Studio 后通过 /api/local-files/ 提供播放
