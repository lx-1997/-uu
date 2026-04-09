# Changelog

## 1.0.3

与「关于 RDK Studio」中 **本版本更新** 列表一致（详见 `src/release-notes.ts`）。

- **设备文件**：上传/保存与 SSH 读列对齐；root 免冗余 sudo；exec 排空与超时；Electron 选文件 `sr-only` + label。
- **CORS / Socket.IO**：默认放行端口与后端 `8787` 一致，修复本机访问时 WebSocket 握手失败。
- **工作台与文件**：仪表盘静态引用修复；设备文件编码与大文件 SSH 读取。
- **桌面与连接**：Type-C 本机 IP 校验、发版脚本与添加设备流程。
- **OpenClaw / 入门**：onboarding 与 hello、SFTP 写入、工具中止与 quickActiveId；套件端 apt 锁等待等。
- **工作区 IDE**：健康检查按 `CODE_SERVER_HTTP_PORT`（9888）探测 code-server。
