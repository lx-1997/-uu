---
name: STT 语音转文字
description: 将语音音频转换为文字。支持离线（板端 Whisper/hobot_audio）和在线（云端 API）两种模式。当用户要求语音识别、转录、STT、听写时激活。
version: 1.1.0
trigger: stt,语音识别,语音转文字,转录,听写,speech to text,whisper,语音输入,录音转文字,识别语音
risk: low
permissions: device_exec
delegate_preference: collaborative
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# STT 语音转文字

## 适用场景
- 用户要求将音频文件转为文字（"帮我转录这段录音"、"识别这个语音"）
- 设备端语音输入场景（语音控制、语音笔记）
- 会议/对话录音整理
- 与 TTS 配合实现语音对话

## 执行流程
1. **确认音频来源**
   - 用户提供了音频文件路径 → 直接使用
   - 用户要求实时录制 → `device_exec` 使用 `arecord` 录制
   - 附件中有音频 → 通过 `attachment_get_audio_transcript` 获取
2. **选择 STT 模式**
   - 设备已安装 Whisper/hobot_audio → 走离线模式（推荐）
   - 设备未安装 → 检查在线 API → 走在线模式
   - 两者都不可用 → 提示安装依赖
3. **离线模式执行**
   - 检查依赖：`device_exec` 运行 `which whisper || python3 -c "import whisper"`
   - 执行识别：`speech_to_text` 工具，参数 audio_path
   - 获取转录文本
4. **在线模式执行**
   - 调用 `speech_to_text` 工具（online 模式）
   - 通过云端 API 识别
5. **返回结果**
   - 输出转录文本
   - 告知识别置信度（如可获取）
   - 建议用户核对关键内容

## 工具映射
| 工具 | 用途 |
|------|------|
| `speech_to_text` | 核心 STT 执行（离线/在线） |
| `device_exec` | 检查依赖、录音、安装包 |
| `device_file_read` | 读取已有音频文件信息 |
| `attachment_get_audio_transcript` | 处理用户上传的音频附件 |
| `device_file_upload_from_local` | 将本机音频上传到设备进行离线识别 |

## 输出要求
- 明确告知使用了哪种模式（离线/在线）
- 转录文本清晰呈现，长文本分段
- 标注识别语言（如可获取）
- 如果识别质量可能不佳（噪音、口音），主动提醒用户核对
- 长录音给出时间戳标记（如可获取）

## 禁止事项
- 不在未确认音频格式的情况下直接执行识别
- 不将用户私密音频发送到在线 API 而不告知
- 不伪造识别结果（识别失败要明确说明）
- 不忽略音频质量问题（如格式不支持、文件损坏要报告）
- 不在设备断连时尝试离线 STT
