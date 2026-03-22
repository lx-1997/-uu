# RDK Studio 客户端化规划

## 1. 当前项目现状

当前项目本质上是一个“前后端一体的 Web 工作台”：

- 前端：React + Vite
- 后端：Express + Socket.IO + ws + ssh2
- 能力：设备管理、SSH 终端、VNC 远程桌面、文件管理、模型与 ROS 能力、AI Chat/OpenClaw
- 当前运行方式：
  - 前端开发服务运行在 `5173`
  - 后端服务运行在 `8787`
  - 浏览器通过 `/api` 代理访问后端

现阶段它已经不是“纯静态页面”，而是一个依赖本地 Node 服务的桌面工作台雏形。所以从工程成本和稳定性看，优先改造成桌面客户端是合理的。

---

## 2. 客户端化目标

我们要把它从“浏览器里打开的网站”升级为“安装即用的客户端软件”，目标建议分三层：

### 2.1 用户层目标

- 用户双击图标即可启动，不再手动开两个服务
- 软件具备独立窗口、托盘、版本号、自动更新能力
- 设备列表、配置、日志落到本地用户目录，不依赖项目运行目录
- 后续可扩展本地串口、USB、文件拖拽、系统通知等桌面能力

### 2.2 产品层目标

- 保留现有 Web UI，避免重写前端
- 保留现有 Node 服务能力，避免重写 SSH/VNC/Socket.IO 逻辑
- 让前后端都由客户端进程托管，形成可打包交付的桌面产品

### 2.3 工程层目标

- 开发态仍保持高效热更新
- 生产态前后端打包后可独立运行
- 尽量少改业务代码，优先做“外壳式桌面化”

---

## 3. 方案对比

## 方案 A：Electron + 内置本地 Express 服务（推荐）

### 优点

- 与当前技术栈最匹配
- 现有 `server/index.ts`、`ssh2`、`socket.io`、`ws` 基本都能复用
- VNC、终端、文件传输等 Node 能力接入成本最低
- Windows 首发最稳妥

### 缺点

- 包体积会比 Web/Tauri 大
- 需要注意 Electron 安全边界

### 适合度

非常高，适合当前项目立即落地。

---

## 方案 B：Tauri + Rust 壳 + Node sidecar

### 优点

- 包体积更小
- 系统资源占用通常更优

### 缺点

- 当前后端是 Node/Express，迁移复杂度高
- 需要额外处理 Node sidecar 生命周期、端口、跨平台打包
- 调试链路比 Electron 更复杂

### 适合度

中等，更适合第二阶段优化，而不是第一版客户端化。

---

## 方案 C：彻底改写为原生客户端

### 结论

不建议。价值低、周期长、风险高，会严重拖慢产品迭代。

---

## 4. 推荐架构

推荐采用：

**Electron 主进程 + 内置本地 Node 服务 + React 渲染进程 + Preload 安全桥**

### 4.1 架构分层

#### 1）主进程 Main Process

负责：

- 创建桌面窗口
- 启动/关闭内置后端服务
- 管理应用生命周期
- 托盘、菜单、日志、异常处理
- 暴露少量 IPC 给前端

#### 2）Preload 层

负责：

- 用 `contextBridge` 暴露安全 API
- 提供应用版本、平台信息、服务端口、日志路径等信息
- 后续可接入原生能力（打开文件夹、系统通知、自动更新）

#### 3）Renderer 渲染层

即当前 React 前端，继续负责：

- 页面交互
- 设备操作 UI
- 调用本地服务 API

#### 4）Local Service 本地服务层

即当前 Express/Socket.IO/ws 服务，继续负责：

- `/api/*`
- 终端 SSH websocket
- VNC websockify 代理
- 文件上传下载
- AI 调用代理

---

## 5. 关键改造点

## 5.1 数据目录从 `process.cwd()` 改为用户目录

当前：

- `server/storage.ts` 把设备数据写到 `data/devices.json`
- 路径依赖 `process.cwd()`

问题：

- 打包后工作目录不稳定
- 安装目录通常不适合写用户数据

建议：

- 客户端运行后，把数据统一写入：
  - Windows：`%AppData%/RDK Studio/`
  - 或 `userData` 目录，如 Electron 的 `app.getPath('userData')`
- 例如：
  - `devices.json`
  - `logs/`
  - `cache/`
  - `downloads/`

结论：

这是第一优先级改造项。

---

## 5.2 后端服务不能再依赖浏览器代理

当前：

- Vite 用 `/api -> http://localhost:8787` 代理
- 前端大量写法默认同源访问 `/api/*`

客户端化后建议：

- 开发态：仍保留 Vite 代理，提升开发效率
- 生产态：Electron 启动内置服务，例如监听 `127.0.0.1:8787` 或动态端口
- 前端通过“运行时注入配置”获取真实 API 地址，而不是写死 `localhost:8787`

建议统一抽象：

- `getApiBaseUrl()`
- `getSocketBaseUrl()`
- `getVncBaseUrl()`

这样可以同时兼容：

- 浏览器开发
- Electron 开发
- Electron 生产

---

## 5.3 VNC 与终端连接地址要做运行时配置

当前已发现的客户端化敏感点：

- `src/components/Terminal.tsx`
  - dev 下写死 `http://localhost:8787`
- `src/components/Vnc.tsx`
  - 手工拼接 `http://${host}:${backendPort}`

问题：

- 桌面端如果后端端口改为动态分配，这类写死地址会失效
- 如果后续启用 HTTPS / 自定义协议，也会受影响

建议：

- 新增统一环境适配模块，例如 `src/runtime.ts`
- 所有 API、Socket、VNC 地址统一从运行时配置生成

---

## 5.4 noVNC 静态资源路径要稳定化

当前：

- `server/index.ts` 使用：
  - `app.use('/vnc', express.static(process.cwd() + '/node_modules/@novnc/novnc'))`

问题：

- 打包后 `node_modules` 位置可能变化
- asar 包内静态资源访问需要特别处理

建议：

- 第一版优先把 noVNC 资源复制到可控目录，例如：
  - `resources/novnc/`
  - 或构建时复制到 `dist/novnc/`
- 服务端改为根据“资源根路径”挂载静态目录

结论：

这是客户端打包时的高风险点之一，必须提前处理。

---

## 5.5 本地服务生命周期由 Electron 托管

建议由 Electron 主进程负责：

- 应用启动 -> 启动本地服务
- 服务健康检查完成 -> 加载主窗口
- 应用退出 -> 优雅关闭服务
- 服务异常退出 -> 弹出错误提示/自动拉起

建议增加：

- `/api/health` 启动探活
- 主进程日志
- 服务启动超时处理

---

## 5.6 安全边界要从第一天建立

桌面端虽然是本地软件，但仍需遵循安全基线：

- BrowserWindow 启用 `contextIsolation: true`
- 禁用 `nodeIntegration`
- 只通过 preload 暴露有限能力
- 前端不直接获得 Node/文件系统全权限
- API Key 仍只保留在本地服务层，不暴露给前端页面

---

## 6. 建议目录演进

建议未来演进为：

```text
electron/
  main.ts           # 主进程
  preload.ts        # 安全桥
  logger.ts         # 桌面日志
  server-manager.ts # 托管本地服务

server/
  index.ts
  storage.ts
  ssh.ts

src/
  runtime/
    env.ts          # API/Socket/VNC 地址统一获取
  components/
  hooks/
  ...

docs/
  desktop-client-plan.md
```

---

## 7. 分阶段实施路线

## Phase 1：桌面化最小闭环

目标：先把现有 Web 能力跑进桌面壳。

包含：

- 引入 Electron
- 主进程创建窗口
- 主进程启动本地 Express 服务
- 前端可正常访问 API / Socket.IO / VNC
- 设备数据落到用户目录
- 完成 Windows 本地打包

交付结果：

- 一个可安装/可启动/可连接设备的 Windows 客户端

---

## Phase 2：体验增强

包含：

- 托盘
- 开机自启（可选）
- 自动更新
- 崩溃恢复
- 原生日志查看
- 文件拖拽上传
- 下载目录管理

---

## Phase 3：桌面能力深度集成

包含：

- 串口/USB 设备识别
- 局域网发现增强
- 原生通知
- 本地模型/工具链管理
- 离线诊断包导出

---

## 8. 主要风险清单

## 高风险

1. noVNC 静态资源打包路径
2. `process.cwd()` 导致的数据/资源路径错误
3. Electron 生产环境下端口和地址拼接不一致
4. `socket.io`、`ws`、Express 同时托管时的启动顺序问题

## 中风险

1. Windows 防火墙对本地监听端口的影响
2. SSH/VNC 大量连接时的稳定性
3. 打包后 `ssh2` 等原生依赖的兼容性验证

## 低风险

1. React 页面迁移本身
2. 普通 REST API 调用适配

---

## 9. 我建议的决策结论

如果目标是：

- 尽快从 Web 工作台变成可交付客户使用的桌面软件
- 保持研发速度
- 尽量复用现有代码

那么建议直接选择：

**Electron 方案，先做第一版桌面壳，不要一开始就追求重构为纯原生。**

这是当前最短路径，也是最符合项目现状的路线。

---

## 10. 下一步实施建议

建议下一轮进入开发时按下面顺序推进：

1. 搭 Electron 基础骨架（main/preload）
2. 抽离运行时地址配置（API、Socket、VNC）
3. 改造 `server/storage.ts`，切到用户目录
4. 改造 noVNC 静态资源路径
5. 增加桌面开发脚本与打包脚本
6. 完成 Windows 首版打包验证

---

## 11. 本轮规划的结论摘要

本项目并不是从零做客户端，而是把“已有 Web + Node 工作台”桌面化。最佳路径不是重写，而是给它加一个 Electron 外壳，并把本地服务、数据目录、运行时地址、静态资源路径这四个关键点收拢起来。

只要这四个点处理好，现有终端、VNC、文件、AI、OpenClaw 基本都能平滑迁移到客户端形态。

---

## 12. desktop 启动冲突排障（5173 端口）

当运行 `npm run desktop` 时，如果页面显示为其他项目（例如 DressUp 页面），通常是 `5173` 端口被外部 Vite 服务占用导致。

### 12.1 快速诊断（Windows）

1. 查看谁占用了端口：

```powershell
Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess -Unique
```

2. 查看该 PID 对应命令行：

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = <PID>" | Select-Object Name, CommandLine
```

3. 结束占用进程：

```powershell
Stop-Process -Id <PID> -Force
```

### 12.2 代码层防护（已落地）

- `scripts/dev-client.mjs`
  - 启动前会打印端口占用 PID、尝试清理并输出清理结果；
  - 清理后会复检端口，如果仍被占用则直接失败退出，避免误启动。
- `scripts/wait-and-launch.mjs`
  - 在启动 Electron 前会校验 `http://localhost:5173` 返回页面是否为 RDK 页面；
  - 若检测到非 RDK 指纹，会中止启动并提示排障命令。