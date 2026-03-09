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

## 环境变量

当前项目通过后端代理调用 OpenAI 兼容协议接口，避免把模型密钥暴露到浏览器。

`.env` 中已放入以下变量：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PORT`

## 设备与 OpenClaw

设备连接接口会实际尝试 SSH 登录校验，成功后把设备基本信息写入 `data/devices.json`。

OpenClaw 功能当前提供的是“远程命令执行入口”，默认命令是占位值。你需要按自己环境替换成真实的 OpenClaw 下载命令和配置命令。

## 构建

```powershell
npm run build
```