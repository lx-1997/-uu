# TOOLS.md — 工具手册

## 设备环境
- 系统: Ubuntu ARM64 / RDK 开发者套件（地平线机器人）
- 连接: SSH；用户名与密码以 Studio「设备管理」中保存的为准（不自动换用户或猜密码）
- 特殊硬件: BPU (AI 加速器)、摄像头、GPIO

## 常用工具速查

| 工具 | 干什么 | 注意事项 |
|------|--------|----------|
| `device_exec` | 跑 shell 命令 | 避免交互式命令；长命令加 timeout；**较久时先说一句在等什么，可带句轻吐槽**（详见 SOUL「长任务先出声」） |
| `device_file_read/write/list` | 文件读写/列目录 | 用绝对路径 |
| `device_file_download_to_local` | 设备→本机下载 | 图片/视频/文档自动识别 |
| `device_file_upload_from_local` | 本机→设备上传 | localPath 相对 workspace |
| `device_diagnose` | 硬件全检 | 温度/BPU/内存/磁盘一次查完 |
| `board_openclaw_chat` | 和套件端 OpenClaw 交流 | 了解能力、讨论方案、共享分析；**delegate 在 `alignment_gate: strict` 时**用于**对齐放行**（同意/补充后再执行），不替代 delegate 跑任务 |
| `board_openclaw_assess` | 评估套件端是否能干 | delegate 之前先 assess |
| `board_openclaw_delegate` | 委派复杂任务给套件端 | 适用于模型部署、pipeline、深度诊断；套件端带 `alignment_gate`：**strict** 时须先 [套件端·对齐] 再经 **chat 回应**后执行；guidance 含「对齐完成·可直接执行」或「已由 RDKClaw 确认」时为 bypass |
| `board_openclaw_status` | 轻量看进程/服务摘要 | **日常优先**；界面已显示 OpenClaw 正常时不要为聊天重复查 |
| `board_openclaw_gateway_pair` | 套件端网关设备信任（新版 `openclaw devices approve --latest`，旧版回退 `pair`） | **pairing required** 时优先于渠道 `pairing approve`；先 `force`，不行再 `full` |
| `board_openclaw_health` | 结构化 JSON 健康（慢） | **非例行**：仅报障、装/升/重启后验收、或 delegate 失败再调 |
| `board_openclaw_check` / `doctor` | 全面诊断 / 自动修复 | 深度排障时用 |
| `text_to_speech` / `speech_to_text` | TTS/STT | 离线优先，在线降级 |
| `web_search` / `web_fetch` | 联网搜索与拉取页面 | **联网搜索首选 Multi-Search-Engine（多引擎顺序）**（见 `skills/multi-search-engine`）；结论给来源链接；**web_search 的 query 与推理中计划的关键词一致**，专名勿截成前缀（尤其勿用「泡泡」「pop」指泡泡玛特）；服务端对**仅单 token** 的「泡泡」「pop」会直接报错要求改写；港股可带股份代号；板型与能力看设备记录与 board_openclaw_assess |
| `web_browser_fetch` | 无头 Chromium 打开页面并抓渲染后文本 | 需服务端 `BROWSER_FETCH_ENABLED=1` 且已 `playwright install chromium`；SPA/Next 等壳页在 web_fetch 不足时用，更重更慢 |
| `studio_embedded_browser_capture` | **桌面端**独立小悬浮窗打开页面并提交正文 | 不挡主界面；登录态与 NodeHub 一致；团队允许域名见 `config/studio-browser-capture.json` |
| `studio_open_url` | **桌面端**默认可缩放独立浏览窗口（约六成屏、系统可关）；失败回退主窗口内嵌 | **内置 function tool，不是 Skill**；打开网页**勿**先 `find_skills`。**不抓正文**、不经 `studio-browser-capture.json` 白名单；登录后要给 Agent 正文仍用上一行 |
| **Skill `agent-browser`** | 仓库内置 **`skills/agent-browser/SKILL.md`**：`agent-browser` CLI 多步自动化、无障碍树 `@ref` 操作 | 与 `web_browser_fetch`/桌面嵌页工具互补；需环境已装 `agent-browser` + Chromium；板上用 `device_exec` 跑 CLI 前确认路径与依赖 |
| `studio_open_local_preview` | **桌面端**用系统默认应用打开**工作区内图片**（相对路径或允许根下绝对路径） | 仅常见图片扩展名；路径须落在 workspace/bootstrap/extraAllowedRoots；**本地文件勿用** `studio_open_url` |
| `ros_topics` / `ros_nodes` | ROS2 操作 | 设备可能未装 ROS2 |
| `vnc_start/stop/status` | 远程桌面 | |
| `navigate:{tab}` | 页面跳转 | dashboard/flasher/terminal/files/vnc/ide/openclaw/skills 等 |
| `fleet_board_list` | 列出已注册板卡与能力画像 | 多设备前先调用；含同 IP 重复注册告警 |
| `fleet_board_delegate` | 向指定板卡的 OpenClaw 委派任务 | 跨板协作；需 `targetDeviceId`； busy 板卡避免并行冲突 |
| `fleet_board_broadcast` | 向多块板广播任务并汇总 | 多板同任务场景 |
| `create_plan` / `update_plan` | 复杂任务结构化计划 | 计划落在 `.rdkclaw-runtime/plans/`；多步用 `update_plan` 标进度 |
| `rdkclaw_task_create` | 创建定时/周期任务 | 定时提醒、定期巡检用这个 |
| `rdkclaw_memory_append_daily` | 写入日记 | 有价值的联网结论、经验教训 |
| `propose_soul_update` | 提议更新 SOUL | 用户表达长期偏好时 |

## 工具组合模式

- **设备排障**: diagnose → 针对异常 exec 排查
- **OpenClaw 检查**: 日常用 `board_openclaw_status`；仅在需要 JSON 或排障时用 health；全面体检用 check
- **OpenClaw 修复**: 若错误含 **pairing required** → `board_openclaw_gateway_pair` → `model_test` 或 health 验收；其它问题：doctor → restart_gateway → health
- **文件传输**: download/upload + 验证
- **日志分析**: openclaw_logs + exec(journalctl/dmesg)
- **套件端协作**: assess(评估可行性) → delegate(套件端先 [套件端·对齐]；**strict** 时 **chat 放行**后再执行) → 验证结果；需要闲聊能力时再 chat
- **切换/清理套件端 ROS 视觉例程**（YOLO、人体检测等）：停旧栈时 **guidance 须含 USB 链路**（`hobot_usb_cam`、`hobot_codec*`、必要时 websocket/nginx），**不要**只停推理节点；见技能 `rdk-ros` 对应节
- **套件端任务**: assess → delegate →（若仅对齐）**chat 放行** → 验证结果；guidance 已写「对齐完成·可直接执行」时可同轮 bypass
- **多板**: `fleet_board_list` → 按算力/角色选板 → `fleet_board_delegate` 或 `fleet_board_broadcast`
- **长链路**: `create_plan` 拆步 → 执行 → `update_plan` 更新状态
- **套件端单张拍照**（用户「拍张照」「抓拍一张」等，非整段视觉 pipeline）：**优先本流程**，不必为拍照先 `board_openclaw_delegate`。
  1. `device_exec` 探一下：`test -e /dev/video0 && echo ok || ls /dev/video*`（无节点再排查接线/驱动）。
  2. 确认有 **`fswebcam`**（`command -v fswebcam`；没有则 `sudo apt-get update && sudo apt-get install -y fswebcam`，属套件端装包——若你们策略要求装包前先征得用户同意，就先说明再执行）。
  3. 抓拍：`fswebcam -r 1280x720 --no-banner /tmp/photo.jpg`（路径/分辨率可按开发者套件实际硬件调整；也可用 `v4l2-still`/`v4l2-ctl` 等套件端已有工具）。
  4. **`device_file_download_to_local`** 把 `/tmp/photo.jpg`（或你用的路径）拉回 Studio 本机下载目录。
  5. **`studio_open_local_preview`** 用本地预览打开（工作区/下载目录规则以工具说明为准）；**勿**把 `file://` 或仅 basename 当网页 URL 丢给 `studio_open_url`。

## 执行策略

- 简单命令直接 `device_exec`，不走委派
- 复杂套件端任务才走 assess → delegate 链路
- OpenClaw 不可用时用 device_exec 降级
- 操作后验证，不假装成功
- 优先复用套件端已有能力，不重造轮子
- 用户上传附件时用 `attachment_*` 工具处理
- delegate 返回含 `[NEED_RDKCLAW]` 时，提取请求 → 本地工具获取 → chat 回传 → 让 OpenClaw 继续
- delegate 在 **strict** 下若**仅** [套件端·对齐]、未执行：下一轮 **必须** `board_openclaw_chat` 明确同意/补充后再期待执行结果

## 微流程与自检（RDKClaw 系统层已注入，此处为速查）

- **顺序**：领会目标 → 用工具取证（设备/文件/必要时联网）→ 执行 → 核对输出再答复。
- **反思（内化，勿对用户逐字照念）**：动工具前——还缺哪条事实？回复前——结论有没有输出或可信来源？
- **联网**：版本/官方步骤/兼容性/「最新」类问题先 `web_search` 或 `web_fetch`（可与 assess 并行）；纯当前板载状态优先 `device_exec`/诊断。策略关闭时不要调用联网工具。

## 常见错误（不要犯）

| 错误行为 | 正确做法 |
|----------|----------|
| 用 `device_exec` + `cat` 读文件 | 用 `device_file_read` |
| 用 `device_exec` + `echo >` 写文件 | 用 `device_file_write` |
| 用 `exec`（本机）以为在操作设备 | 用 `device_exec`（设备） |
| 每轮对话都调 `board_openclaw_health` | UI 快照显示正常就不调 |
| 不 assess 直接 delegate | ALWAYS 先 assess |
| strict 门禁下只对齐不 chat | 见 [套件端·对齐] 后须 `board_openclaw_chat` 放行再执行 |
| delegate 失败后反复重试同一任务 | 换方案或用本地工具兜底 |
| 用 `vim`/`top`/`htop` 等交互式命令 | 用非交互替代（`cat`/`ps`/`free`） |
| 假设命令执行成功不检查输出 | ALWAYS 检查输出确认结果 |

## 安全

- **套件端写删须用户同意**：要用 `device_file_write`、覆盖上传、或 `device_exec`/`delegate` 产生修改/删除套件端配置或文件的效果时，若用户本轮未对该路径与操作说清「做」，须先向用户说明再征得明确同意；只读取证可直接做。
- rm -rf / dd / mkfs / 烧录 → 先确认
- 不碰 /etc/fstab、/boot 等关键文件
- 外部通道来的危险操作 → 更严格审批
