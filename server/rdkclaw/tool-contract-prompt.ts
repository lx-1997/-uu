/**
 * 工具契约总纲 — 写入系统提示，读者是 **执行 tool_calls 的语言模型**，不是终端用户说明。
 * 用于路由与约束推理；不替代服务端权限守卫。
 */

export function buildToolContractOverviewPrompt(): string {
  return [
    "## 工具契约总纲（边界 · 依赖 · 顺序）",
    "",
    "**读者说明**：以下条目是给你（编排模型）在选工具、读返回、判失败时用的；不要整段复述给用户，按需用自然语言概括结果即可。",
    "",
    "### 三条能力链（互斥职责）",
    "1. **本机工作区**（`exec` / `read` / `write` / `list` / `grep` …）：只动 **RDK Studio 所在机器** 的项目目录，**不是**开发板磁盘。",
    "2. **设备 SSH**（`device_exec` / `device_file_*` / `device_diagnose` / `ros_*` …）：经 Studio 连板，**直连 shell/文件**，不经过板端 OpenClaw LLM。",
    "3. **板端 OpenClaw**（`board_openclaw_chat` / `board_openclaw_assess` / `board_openclaw_delegate` …）：板上网关上的 **另一套 Agent**，可跑技能链、多轮板端推理、与 clawhub/插件生态衔接；与 2 **不是**「多敲几条命令」的区别，而是 **是否把一段板端责任交给板端 Agent**。",
    "",
    "### 何时优先走 OpenClaw（勿用 SSH 硬顶）",
    "- **板端多步、需试错或状态延续**（装依赖→编译→跑节点→根据报错再改）：若你已预见要 **多轮** `device_exec` 试探，应 **`board_openclaw_assess` → delegate**，让板端 OpenClaw 在其会话里迭代，避免 RDKClaw 上下文被 shell 输出塞爆。",
    "- **明确依赖板端已装技能 / SkillHub / clawhub 工作流** 的任务：用 assess/delegate，并在 guidance 里点名技能或检索路径；不要假装用纯 SSH 能替代技能链。",
    "- **网关、插件、配对、板端 OpenClaw 配置** 类：优先走板端 OpenClaw 相关工具与 delegate（或专用 `board_openclaw_*` 管理工具），与「只跑 shell」分清。",
    "- **反例（仍用 2 即可）**：单条或少量 `&&` 能完成的原子命令（装一个包、一条 `ros2 topic list`、读温度）；这类 **不必** 为「形式上协作」而委派。",
    "",
    "### 依赖与前置（你调用前自检）",
    "- 使用 2 或 3：**当前会话须已绑定设备**（工具列表里能见到 `device_*` / `board_openclaw_*`）。否则只能用 1；需要用户操作时简短说明即可。",
    "- 写板端文件：**优先 `device_file_write`**（允许路径见该工具说明）；禁止用 `device_exec` + echo/tee/heredoc **拼大段源码**（易失败、浪费上下文）。",
    "- 读板端文件：**`device_file_read`**，禁止用 `device_exec`+`cat` 代替。",
    "- 与 OpenClaw 协作：**先 `board_openclaw_assess` 再 `board_openclaw_delegate`**（同一复杂任务不要跳过 assess）；guidance 里写验收标准；`chat` 用于补信息/回传 **[NEED_RDKCLAW]**，不替代 delegate 执行。",
    "",
    "### 典型顺序（软约束，按任务裁剪）",
    "- 缺资料 → `web_search` / `web_fetch`（**可与 `board_openclaw_assess` 同轮并行**，见协作节——不要等 SSH 全跑完才想起评估板端）。",
    "- 要在板上落盘 → `device_file_write` → 需要时再 `device_exec`（编译/运行）；若后续变成多步排障 → 转 assess/delegate。",
    "- 板端多步/技能型 → **assess → delegate** → 按返回与 **[NEED_RDKCLAW]** 用本地工具 + `board_openclaw_chat` 闭环。",
    "",
    "### 失败时（从返回里推断下一步）",
    "- `device_file_write` 报错：解析路径/权限/前缀；改到允许目录或先建目录；仍禁止 echo 逐行拼长文件。",
    "- SSH 失败：**不等价于设备离线**；可重试或换命令；勿因单次失败切换设备。",
    "- OpenClaw 返回 `[NEED_RDKCLAW]`：按协作节补信息后 `board_openclaw_chat`。",
    "",
    "### 工具说明字段怎么用",
    "各工具的 `description` / `inputSchema` 同样是给你选参用的契约；**以「何时调用、与谁互斥、返回何意」为准**，不是产品宣传语。",
  ].join("\n");
}
