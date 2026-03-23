# RDK Studio 导出 Linux / macOS 版本操作手册

本文目标：在不改动主要 UI/UX 的前提下，稳定导出 `Linux` 与 `macOS` 安装包，并降低发布阶段踩坑概率。

## 1. 当前项目结论

- 桌面框架：`Electron + electron-builder`
- 已有脚本：
  - `npm run build:desktop:mac`
  - `npm run build:desktop:linux`
- 构建配置：`package.json` 的 `build` 字段
  - `mac` 目标：`dmg`（`x64`, `arm64`）
  - `linux` 目标：`AppImage`, `deb`（`x64`）
- 稳定性护栏：`scripts/build-desktop.mjs`
  - 自动先执行 `npm run build`
  - 默认先清理 `release/`，避免旧产物干扰本轮打包
  - 自动执行 `scripts/prepare-build-resources.mjs`，确保基础图标资源就绪
  - 强制目标平台一致（`mac` 仅允许在 `darwin`，`linux` 仅允许在 `linux`）
  - 预警 `build-resources` 为空（图标资源缺失）
  - 打包后自动执行 `scripts/desktop-smoke-check.mjs`（产物完整性检查）
  - 统一覆盖 `build:desktop:win:dir`，不再走旧的独立命令链路

## 2. 非常重要的跨平台事实

1. **不能在 Windows 上直接产出可发布的 macOS 包**  
   macOS 包建议在 macOS 主机构建（尤其涉及签名、公证时）。
2. **Linux 包建议在 Linux 主机构建**  
   可减少交叉构建导致的系统库与打包差异问题。
3. **签名和公证是 macOS 分发关键**  
   未签名/未公证会被 Gatekeeper 拦截或高风险警告。

## 3. 发布前检查清单（两平台通用）

1. Node 版本与锁文件一致（建议使用团队统一版本）。
2. 执行安装与编译：
   - `npm ci`
   - `npm run build`
3. 确认桌面入口可启动：
   - `npm run desktop`
4. 确认产物目录：
   - `release/`
5. 检查本地可写数据目录是否正确（已改为 `app.getPath('userData')/data`）。
6. 可选启用运行时冒烟（同机目标平台）：
   - `RDK_DESKTOP_SMOKE_RUNTIME=1 npm run build:desktop:<target>`
   - 该检查会短暂启动打包产物，并探测 `http://127.0.0.1:8787/api/health`
   - 检查结束后会验证端口 `8787` 已释放，避免后台残留进程
   - 可用 `RDK_DESKTOP_SMOKE_HEALTH_RETRIES` 调整健康检查重试次数（默认 40）
   - 可用 `RDK_DESKTOP_CLEAN_RELEASE=0` 关闭打包前 release 清理（默认开启）
   - 可用 `RDK_DESKTOP_STRICT_RESOURCES=1` 开启资源强校验（缺图标直接失败）

## 4. Linux 导出流程（推荐在 Ubuntu 22.04+）

1. 安装依赖
   - `sudo apt update`
   - `sudo apt install -y build-essential python3 make g++ libarchive-tools rpm`
2. 安装 Node 并进入项目
   - `npm ci`
3. 打包
   - `npm run build:desktop:linux`
4. 产物验证（`release/`）
   - `*.AppImage`
   - `*.deb`
5. 冒烟测试
   - AppImage：`chmod +x <file>.AppImage && ./<file>.AppImage`
   - deb：`sudo dpkg -i <file>.deb`
6. 核验关键能力
   - 启动应用
   - 设备列表读写
   - API 联通（`/api/health`）
   - SSH / VNC 基本可用

## 5. macOS 导出流程（必须在 macOS 主机）

### 5.1 仅内部测试包（不签名）

1. 安装依赖
   - `npm ci`
2. 打包
   - `npm run build:desktop:mac`
3. 产物验证（`release/`）
   - `*.dmg`

### 5.2 对外分发包（签名 + 公证）

需要先准备 Apple 证书与以下环境变量（CI 或本机）：

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

再执行：

1. `npm ci`
2. `npm run build:desktop:mac`
3. 使用 `xcrun stapler staple` 对产物做公证票据附加（若流程未自动处理）。
4. 在全新 macOS 机器验证安装与首次启动。

## 6. 当前风险与建议

1. 建议补齐品牌级平台图标资源（当前使用自动准备的最小图标以保证可打包稳定性）。
2. 若要稳定发布，建议新增 CI 矩阵：
   - `ubuntu-latest` 构建 Linux 包
   - `macos-latest` 构建 macOS 包
3. Windows 专属功能（本机物理烧录）在 Linux/macOS 需保持“能力降级提示”，避免误判为故障。

## 7. 推荐执行顺序

1. 先在 Linux 主机跑通 `build:desktop:linux` 与冒烟测试。
2. 再在 macOS 主机跑通未签名 `dmg`。
3. 最后接入 macOS 签名公证流程并做最终发布验证。

## 8. CI 门禁（已接入）

- 工作流：`.github/workflows/desktop-build-smoke.yml`
- 覆盖：
  - `windows-latest`：`npm run build:desktop:win`
  - `ubuntu-latest`：`npm run build:desktop:linux`
  - `macos-latest`：`npm run build:desktop:mac`
- 说明：
  - 每个 job 均包含打包后冒烟检查（产物完整性）
  - 自动上传 `release/` 下对应平台产物
  - 当前默认关闭签名自动发现（`CSC_IDENTITY_AUTO_DISCOVERY=false`），先保障可重复产包稳定性
  - `workflow_dispatch` 支持 `runtime_smoke` 开关（默认关闭）
    - 关闭：只做产物完整性冒烟（更稳、更快）
    - 开启：会启动打包产物并探测 `/api/health`
  - 每次 CI 都会上传 `.smoke/*.log`，用于失败后定位
  - 每次 CI 都会追加 Job Summary（`scripts/smoke-log-summary.mjs`）
  - 每次 CI 都会生成并上传发布清单与 SHA256：
    - `.smoke/release-manifest.json`
    - `.smoke/release-sha256.txt`
  - 每次 CI 都会执行 release guard（阈值与完整性门禁）：
    - 配置：`.ci/release-baselines.json`
    - 报告：`.smoke/release-guard.json`
  - 每次 CI 都会执行 release drift check（与参考 manifest 比较）：
    - 配置：`.ci/release-drift-policy.json`
    - 参考：`.ci/release-reference-manifests/{linux|mac|win}.json`
    - 报告：`.smoke/release-drift.json`
    - PR 默认可 `skipped`；主分支 push 默认要求参考存在（缺失会失败）
  - 推荐用脚本初始化/更新参考：
    - 初始化：`verify:desktop:reference:init:*`
    - 更新：`verify:desktop:reference:update:*`
  - `workflow_dispatch` 可启用 `baseline_suggest`：
    - 根据本轮产物生成基线建议 `release-baseline-suggested-*.json`
    - 用于人工评审后再更新 `.ci/release-baselines.json`
  - `workflow_dispatch` 可启用 `require_reference`：
    - 开启后即使手动触发也会强制参考存在

