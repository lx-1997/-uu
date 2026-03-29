Windows 烧录工具（与 rdkstudio_frontend flash/win32/x64 用法一致）

本目录应包含：
  dd.exe、ls.exe，以及 dd 运行所需的 msys-*.dll（自 Git for Windows usr\bin 复制）。

首次克隆仓库后（Windows + 已安装 Git for Windows）在项目根目录执行：

  npm run copy:win-flash

或执行构建前准备（会自动尝试复制）：

  npm run prepare:build-resources

强制从本机 Git 目录覆盖刷新：

  node scripts/copy-win-flash-tools.mjs --force

无 Git 时：请从 rdkstudio_frontend 的 extraResources 拷贝同目录文件，或手动安装 Git 后再运行上述命令。

打包给别人使用：
  - package.json 已将本目录作为 extraResources 打进安装包（resources/flash/...），终端用户无需再装 Git。
  - 你在打 Windows 包前须保证本目录已有 dd.exe、ls.exe、msys-2.0.dll；npm run build:desktop:win 会自动尝试 copy:win-flash。
  - 在 Mac/Linux 上交叉打 win 包时无法自动复制，请先在 Windows 上生成并提交本目录，或从仓库拉取已提交的完整目录。
  - 缺文件仍允许打包时会有警告；若要在 CI 里缺文件直接失败：RDK_DESKTOP_STRICT_WIN_FLASH=1
