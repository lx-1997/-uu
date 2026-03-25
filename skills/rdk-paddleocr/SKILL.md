---
name: PaddleOCR
description: 在 RDK 设备上部署和使用 PaddleOCR 进行文字识别（OCR）。支持图片中的中英文文字检测、识别和结构化提取。ARM64 环境使用 ONNX Runtime 推理。
version: 1.0.0
trigger: ocr,文字识别,图片识别文字,paddleocr,图片转文字,截图识别,识别图片中的文字,提取文字,扫描文字,文档识别,识别文档,图像文字
risk: low
permissions: device_exec,workspace_read
delegate_preference: collaborative
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: AI
---

# PaddleOCR — 设备端文字识别

在 RDK 设备上使用 PaddleOCR 进行图片文字识别。支持中英文混合文本、表格、文档等场景。

## 技术背景

- PaddleOCR 3.x：百度飞桨开源 OCR 工具
- ARM64 设备（RDK X3/X5）使用 ONNX Runtime 推理（PaddlePaddle 原生内核在 ARM64 有兼容问题）
- 首次运行需联网下载模型（约 15MB 检测模型 + 50MB 识别模型），之后可离线使用

## 适用场景

- "识别这张图片里的文字"
- "帮我把截图中的文字提取出来"
- "扫描这个文档的内容"
- 设备摄像头拍照 → 实时 OCR
- 批量处理图片中的文字

## 前置条件

- RDK 设备已连接
- Python3 >= 3.8
- 磁盘空间 >= 300MB（模型+依赖）
- 首次安装需联网

## 执行流程

### 1. 环境检查与安装

```bash
# 检查 Python 版本
python3 --version

# 检查是否已安装
python3 -c "from paddleocr import PaddleOCR; print('PaddleOCR OK')" 2>&1
```

若未安装，执行安装：

```bash
# 安装 PaddleOCR（ARM64 自动使用 ONNX Runtime）
pip3 install paddlepaddle paddleocr onnxruntime paddle2onnx --break-system-packages 2>&1

# 安装高性能推理依赖（可选，提升性能）
paddleocr install_hpi_deps cpu 2>&1 || true
```

工具：`device_exec`

### 2. 准备图片

- 如果图片在本机：`device_file_upload_from_local` 上传到设备 `/tmp/ocr_input.jpg`
- 如果图片在设备上：直接使用路径
- 如果需要拍照：`device_exec` 调用摄像头拍照

### 3. 执行 OCR

```bash
python3 -c "
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_angle_cls=True, lang='ch')
result = ocr.ocr('/tmp/ocr_input.jpg', cls=True)
for line in result:
    if line:
        for item in line:
            box, (text, conf) = item
            print(f'{text} ({conf:.2f})')
"
```

工具：`device_exec`

### 4. 结构化输出

解析 OCR 结果，按需提供：
- 纯文本提取
- 带坐标的文字位置
- 表格结构还原
- 置信度过滤（建议阈值 0.8）

### 5. 高级用法

#### 指定识别语言
```python
# 英文
ocr = PaddleOCR(use_angle_cls=True, lang='en')
# 日文
ocr = PaddleOCR(use_angle_cls=True, lang='japan')
# 韩文
ocr = PaddleOCR(use_angle_cls=True, lang='korean')
```

#### 仅检测文字区域（不识别）
```python
result = ocr.ocr('/tmp/input.jpg', rec=False)
```

#### 批量处理
```python
import glob
for img in glob.glob('/tmp/ocr_batch/*.jpg'):
    result = ocr.ocr(img, cls=True)
    # 处理结果...
```

## 工具映射

| 工具 | 用途 | 必需 |
|------|------|------|
| `device_exec` | 检查环境、安装依赖、执行 OCR | 是 |
| `device_file_upload_from_local` | 上传图片到设备 | 否 |
| `device_file_download_to_local` | 下载 OCR 结果到本机 | 否 |
| `device_diagnose` | 检查设备状态（磁盘空间） | 否 |

## 输出要求

- 识别结果按行展示，每行包含文字内容和置信度
- 置信度低于 0.6 的结果标注警告
- 大段文字自动分段整理
- 如果识别结果为空，说明可能的原因（图片质量、格式不支持等）

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| SIGSEGV 崩溃 | ARM64 PaddlePaddle 原生内核 bug | 确认安装了 onnxruntime，或设置 `FLAGS_enable_pir_in_executor=0` |
| 模型下载失败 | 网络问题 | 重试或手动下载模型到 `~/.paddleocr/` |
| 内存不足 | 图片太大 | 先缩放图片再识别 |
| 识别结果为空 | 图片无文字或质量差 | 检查图片格式和内容 |

## 禁止事项

- 不在磁盘空间不足（< 300MB）时强行安装
- 不对超大图片（> 20MB）直接 OCR（先缩放）
- 不忽略 ARM64 兼容问题（确保 ONNX Runtime 已安装）
- 不在未确认设备连接的情况下执行安装
