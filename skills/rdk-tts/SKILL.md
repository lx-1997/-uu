---
name: TTS 文字转语音
description: 将文字转换为语音音频。支持离线（板端 hobot_tts）和在线（云端 API）两种模式。当用户要求朗读、语音合成、TTS、文字转语音时激活。
version: 1.1.0
trigger: tts,语音合成,文字转语音,朗读,播报,text to speech,语音播放,语音输出,说话,读出来,hobot_tts
risk: low
permissions:
  deviceExec: true
delegate_preference: collaborative
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# TTS 文字转语音

## 适用场景
- 用户要求将文字内容转为语音（"帮我读出来"、"语音播报这段话"）
- 需要设备端语音输出能力（机器人播报、语音提示）
- 批量生成音频文件
- 与 STT 配合实现语音对话

## 执行流程
1. **检查设备连接**：确认设备在线且 SSH 可达
2. **选择 TTS 模式**
   - 设备已安装 hobot_tts → 走离线模式（推荐）
   - 设备未安装 hobot_tts → 检查在线 API 可用性 → 走在线模式
   - 两者都不可用 → 提示用户安装依赖
3. **离线模式执行**
   - 检查依赖：`device_exec` 运行 `which hobot_tts_node || dpkg -l | grep hobot-tts`
   - 未安装则安装：`device_exec` 运行 `apt update && apt install -y tros-humble-hobot-tts`
   - 执行合成：`text_to_speech` 工具，参数 text + output_path
   - 音频保存在设备 `/tmp/tts_output.wav`
4. **在线模式执行**
   - 调用 `text_to_speech` 工具（online 模式），通过云端 API 合成
   - 结果下载到本机 `workspace/downloads/`
5. **返回结果**
   - 告知用户音频路径和时长
   - 如需在设备播放：`device_exec` 运行 `aplay /tmp/tts_output.wav`

## 工具映射
| 工具 | 用途 |
|------|------|
| `text_to_speech` | 核心 TTS 执行（离线/在线） |
| `device_exec` | 检查依赖、安装包、播放音频 |
| `device_file_download_to_local` | 将板端音频下载到本机 |
| `device_diagnose` | 检查设备状态（可选，确认设备正常） |

## 输出要求
- 明确告知使用了哪种模式（离线/在线）
- 给出音频文件路径（设备路径或本机路径）
- 告知音频时长（如可获取）
- 如果用户想在设备播放，给出播放命令或直接执行

## 禁止事项
- 不在未检查依赖的情况下直接执行 TTS 命令
- 不静默覆盖用户已有的音频文件（先检查路径是否存在）
- 不在设备断连时尝试离线 TTS
- 不将用户敏感内容发送到在线 API 而不告知
- 不跳过安装确认直接 apt install（需告知用户将安装什么）
