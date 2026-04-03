# RDK Studio

RDK Studio 是一个面向机器人设备的 AI Native Web 工作台，包含三条主流程：

- 类 ChatGPT 的聊天工作区
- 首次进入自动检查 SSH 设备并弹出连接对话框
- 针对已连接设备执行 OpenClaw 下载与配置命令

## 本地启动

```powershell
npm install
npm run dev
```

前端默认地址：`http://localhost:5173`

后端默认地址：`http://localhost:8787`

## 实机联调（推荐流程）

1. 打开设备添加弹窗，默认已填 `root` / `root`；若板卡仍用其他账户（如历史镜像的 `sunrise/sunrise`），再按实机修改。
2. 默认有线网络常见 IP 为 `192.168.127.10`，若不通请先确认 PC 与板卡同网段。
3. 连接成功后先在终端执行：

```bash
cat /etc/version
rdkos_info
ip addr
```

4. 再进入各模块验证：终端、文件、VNC、OpenClaw 等。

## 全模块验证

项目内置一键验证脚本：

```powershell
npm run verify:modules
```

可选环境变量：

- `RDK_API_BASE_URL`：后端地址（默认 `http://127.0.0.1:8787`）
- `RDK_DEVICE_ID`：指定验证设备
- `RDK_DEVICE_PASSWORD`：需要密码的接口校验

## 常见问题排查

- SSH 连接失败：优先检查用户名密码（默认 `root`/`root`）、端口（默认 `22`）、同网段配置。
- ROS 无话题：如果输出 `ROS2_NOT_INSTALLED`，请先在设备安装 ROS2 基础包后重试。
- VNC 不可用：先在板端用 `srpi-config -> Interface Options -> VNC` 使能，再检查 `x11vnc/vncserver` 服务。
- Node-RED 不可用：先看服务状态，再执行启动命令并复查状态。

## 环境变量

当前项目通过后端代理调用 OpenAI 兼容协议接口，避免把模型密钥暴露到浏览器。

`.env` 中已放入以下变量：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PORT`

## 打包版预置 RDKClaw 大模型

从当前版本开始，桌面包支持在首启时自动读取预置模型配置：

- 默认文件：`config/rdkclaw-provider.defaults.json`
- 可通过环境变量覆盖文件路径：`RDK_PROVIDER_BOOTSTRAP_FILE`
- `apiKey` / `model` / `baseUrl` 支持 `${ENV_NAME}` 占位符（运行时替换）

示例（PowerShell）：

```powershell
$env:RDK_PROVIDER_API_KEY = "your_api_key"
npm run build:desktop:win
```

说明：

- 当用户本地还没有 `~/.rdkstudio/agent-config.json` 时，会自动使用预置配置。
- 用户后续在设置页保存的新配置优先级更高，不会被预置文件覆盖。

## 设备与 OpenClaw

设备连接接口会实际尝试 SSH 登录校验，成功后把设备基本信息写入 `data/devices.json`。

OpenClaw 相关功能已接入真实板端命令（install/start/status/switch/logs），执行结果以设备返回输出为准。

## 构建

```powershell
npm run build
```