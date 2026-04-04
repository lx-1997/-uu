# 公网穿透（frp）与 RDK Studio 使用说明

本文说明如何在**云端**部署 frps、在**开发板**上部署 frpc，以及 **RDK Studio** 如何配合使用（SSH、IDE、VNC 等）。  
说明：应用内「远程穿透」向导页已移除，可按本文**手动配置**或通过 **HTTP API** 完成相同能力。

---

## 1. 架构简述

- **frps**：跑在你自有 **VPS / 云服务器** 上，提供控制通道（默认 TCP **7000**）与 **TCP 代理**（将公网端口映射到板端）。
- **frpc**：跑在 **RDK 板端**，主动连接 frps，把本机 **SSH（127.0.0.1:22）** 暴露为 frps 上的某个 **remotePort**（实现里从 **6000** 起递增分配）。
- **RDK Studio**：运行在你电脑上，通过 **SSH** 连板子。经 frp 时，设备档案里应使用 **公网 IP/域名 + 映射端口**（例如 `公网IP:6000`），而不是局域网 IP:22。

Studio 会把全局 frp 参数写在数据目录下的 `**frp-studio-settings.json`**（见下文），并在板端部署成功后更新 `**devices.json**` 中的 `host` / `port` / `sshReachability` / `frpRemotePort` / `lanSshHost` 等字段。

---

## 2. 云端（frps）配置

### 2.1 端口与安全组

至少需在云厂商 **安全组 / 防火墙** 放行：


| 端口                    | 用途                           |
| --------------------- | ---------------------------- |
| **TCP 7000**（可改）      | frp **控制通道**（frpc ↔ frps）    |
| **TCP 6000–6100**（示例） | 每台设备一个 **SSH 映射端口**（实际以分配为准） |


具体映射端口在板端部署成功后由后端分配并写入设备记录（`frpRemotePort`）。

### 2.2 frps 配置示例（fatedier/frp）

与仓库后端生成逻辑一致的核心项：

- `bindPort = 7000`（与 Studio 全局里的 **serverPort** 一致）
- `auth.method = "token"`，`auth.token` 为强随机字符串，且与 Studio 全局设置、板端 frpc **完全一致**

可在服务器上自行安装 frp，参考官方文档；或使用 Studio 提供的 **服务端一键部署 API**（需你向 Studio 提供**云服务器的 SSH**，见第 4 节）。

---

## 3. Studio 本机全局设置（与 frps 对齐）

全局配置持久化路径（与 `devices.json` 同数据目录）：

- `**$RDK_DATA_DIR/frp-studio-settings.json`**（未设置 `RDK_DATA_DIR` 时，默认在用户目录下 `.rdk-studio/data/`）

字段含义：


| 字段              | 说明                                                               |
| --------------- | ---------------------------------------------------------------- |
| `serverAddr`    | frps **公网 IP 或域名**（板端 frpc 的 `serverAddr`）                       |
| `serverPort`    | frps 控制端口，默认 **7000**                                            |
| `token`         | 与 frps / frpc **相同**的认证 token                                    |
| `publicSshHost` | 你通过 frp **SSH 映射**访问板子时使用的公网地址，通常与 `serverAddr` 相同；若经独立入口域名可单独填写 |


可通过 **HTTP API** 写入（需已登录/SSO 等与本项目其它 `/api` 一致）：

```http
POST /api/frp/settings
Content-Type: application/json

{
  "serverAddr": "你的公网IP或域名",
  "serverPort": 7000,
  "publicSshHost": "你的公网IP或域名",
  "token": "与 frps.toml 中 auth.token 一致"
}
```

查询：

```http
GET /api/frp/settings
```

---

## 4. 板端（frpc）配置

### 4.1 前置条件

1. 已在 Studio **添加设备**，且当前能在 **局域网**下 **SSH 成功**（终端页可连）。
2. 已在第 3 节保存 **完整的 frp 全局设置**（至少 `serverAddr` + `token`）。

### 4.2 一键部署（推荐）

由 Studio **SSH 登录板子**，在 `/opt/rdk-studio-frp` 安装 frp 客户端、写入 `frpc.toml`、注册并启动 `rdk-frpc` systemd 服务，并把设备切换为 **远程（tunnel）** 连接方式。

```http
POST /api/frp/device/deploy
Content-Type: application/json
X-Device-Password: 设备SSH密码（若未在会话中缓存）

{
  "deviceId": "设备 UUID"
}
```

成功响应中会包含 `**remotePort**`、更新后的 `**device**` 等；请在云端安全组放行 `**TCP remotePort**`。

### 4.3 手动部署思路（与后端一致）

- frpc 将 `**127.0.0.1:22**` 以 **tcp** 方式映射到 frps 上的 `**remotePort`**。
- `serverAddr` / `serverPort` / `auth.token` 与 frps、Studio 全局设置一致。

---

## 5. 局域网 / 远程 切换

若部署时已将局域网地址备份为 `lanSshHost` / `lanSshPort`，可在两种连接目标间切换：

```http
POST /api/frp/device/switch-mode
Content-Type: application/json
X-Device-Password: 如需

{
  "deviceId": "设备 UUID",
  "mode": "direct"
}
```

- `**direct**`：使用局域网备份地址（`lanSshHost`）与端口。
- `**tunnel**`：使用 `publicSshHost`（或 `serverAddr`）与 `**frpRemotePort**`。

---

## 6. RDK Studio 侧如何使用

### 6.1 设备档案

经 frp 连接时，设备应表现为：

- **主机（host）**：公网 IP 或域名（与 `publicSshHost` / 映射一致）
- **端口（port）**：**frp 映射的 SSH 端口**（如 **6000**），不是 22
- `**sshReachability`**：在数据中为 `**tunnel**` 时，IDE / VNC 等会走 **Studio 后端 SSH 隧道**，避免浏览器直连板子局域网端口失败

若你**手动编辑** `devices.json`，请与上述字段保持一致。

### 6.2 功能行为摘要

- **终端 / 文件 / OpenClaw / WiFi 等**：均通过 **SSH** 访问板端，端口正确即可。
- **IDE（code-server）**：公网或隧道场景下，前端会改为请求 Studio 的 `**/api/devices/:id/code-server-proxy/`**，由后端经 SSH 转发到板端 `127.0.0.1:9888`。
- **VNC（noVNC）**：隧道模式下 WebSocket 使用 `**websockify?deviceId=...&remotePort=5900`**，由后端经 SSH 转发到板端 VNC。
- **聊天中的本地媒体**：`/api/local-files/...` 由本机 Studio 进程提供，与 frp 无关。

### 6.3 常见问题

- **连接被拒绝（ECONNREFUSED）**：检查云安全组是否放行 **7000** 与 **对应 SSH 映射端口**；检查 frpc 是否运行（`systemctl status rdk-frpc`）。
- **Studio 仍连局域网 IP**：确认设备已切换为 **tunnel** 且 `host`/`port` 为公网与映射端口，或重新执行部署/切换 API。

---

## 7. 其它 API（可选）

- `**POST /api/frp/server/deploy`**：向 Studio 提供**云服务器 SSH**，由后端在云机上一键安装并启动 frps（具体请求体见 `server/frp-routes.ts`）。

更完整的字段校验与错误码以实现为准；开发时可对照仓库内 `**server/frp-routes.ts`**、`**server/frp-settings.ts**`。

---

## 8. 参考

- 官方 frp：[https://github.com/fatedier/frp](https://github.com/fatedier/frp)
- 数据目录与设备列表：与本项目 `RDK_DATA_DIR`、`devices.json` 说明一致

