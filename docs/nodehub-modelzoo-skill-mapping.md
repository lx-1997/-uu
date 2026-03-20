# NodeHub / ModelZoo 能力映射为 Skills（第一版）

## 调研来源

- NodeHub 门户：`https://developer.d-robotics.cc/nodehub`
- ModelZoo 代码与文档：`https://github.com/D-Robotics/rdk_model_zoo`
- RDK 文档导航页（包含 Model Zoo 入口）：`https://developer.d-robotics.cc/information`

> 说明：`https://developer.d-robotics.cc/modelzoo` 当前返回 404，因此以官方 GitHub 仓库与文档导航为主进行能力抽取。

## 能力抽取（可转 Skill 的对象）

### A. NodeHub（应用/节点编排）

从 NodeHub 门户可见，核心能力适合抽象为“应用发现 + 安装 + 运行 + 组合”的技能：

1. 应用发现
   - 按分类筛选：大模型应用、综合应用、环境感知、人机交互、外设适配、比赛专区、强化学习。
   - 按平台筛选：RDK X3 / RDK Ultra / RDK X5 / RDK S100。

2. 应用资产操作
   - 查看项目信息（作者、简介、热度）。
   - 获取源码仓库（多数托管于 GitHub）。
   - 快速部署与运行（NodeHub 的一键/快速部署能力）。

3. 组合式开发
   - 通过配置组合多个 Node 形成高级应用（门户文案强调“无需复杂编程，通过配置组合不同 Node”）。

### B. ModelZoo（模型与样例执行）

从 `rdk_model_zoo` README 可见，核心能力可抽象为“模型发现 + 环境准备 + 样例执行 + 结果导出”：

1. 模型/样例发现
   - 视觉分类、检测、分割。
   - LLM（`samples/llm`）。
   - 解决方案（`samples/solutions`）。

2. 环境准备
   - 板端连接准备（SSH / VSCode Remote / VNC / HDMI）。
   - 依赖安装（如 `bpu_infer_lib_x5` / `bpu_infer_lib_x3`）。

3. 执行与调试
   - Jupyter 运行路径（clone 仓库、启动 lab、执行 notebook）。
   - VSCode 远程运行样例路径。

4. 常见问题辅助
   - 精度、速度、量化、输入分辨率、ONNX 转换等 FAQ 指导。

## Skill 目录建议

建议采用统一命名空间：`rdk.*`

### 1) 发现类

- `rdk.nodehub.search_apps`
  - 输入：`keyword?`, `category?`, `platform?`, `page?`
  - 输出：应用列表（名称、简介、平台、作者、repo/link）

- `rdk.modelzoo.search_samples`
  - 输入：`task?`（classification/detection/segmentation/llm/solution）, `platform?`
  - 输出：样例列表（路径、README、依赖）

### 2) 安装与环境类

- `rdk.modelzoo.prepare_env`
  - 输入：`platform`（x3/x5/s100）, `useIndexUrl?`（默认官方 sdk 源）
  - 动作：安装对应 `bpu_infer_lib_*` 与基础运行依赖
  - 输出：安装结果与版本

- `rdk.board.check_connectivity`
  - 输入：`host`, `username`, `passwordOrKey`
  - 输出：SSH 连通、系统版本、架构、可用磁盘

### 3) 执行类

- `rdk.modelzoo.run_sample`
  - 输入：`samplePath`, `args?`, `runtime`（python/jupyter/vscode-remote）
  - 输出：stdout/stderr、产物路径（图像/日志）

- `rdk.modelzoo.launch_jupyter`
  - 输入：`repoPath`, `ip`, `port?`
  - 输出：启动日志与访问地址

### 4) 编排类（NodeHub 对应）

- `rdk.nodehub.deploy_app`
  - 输入：`appIdOrRepo`, `targetDevice`, `params?`
  - 输出：部署状态、运行入口、日志位置

- `rdk.nodehub.compose_workflow`
  - 输入：`nodes[]`, `bindings[]`, `runtimeConfig?`
  - 输出：工作流定义（可持久化 JSON/YAML）

### 5) 诊断类

- `rdk.modelzoo.troubleshoot`
  - 输入：`errorText`, `context?`（模型、平台、命令）
  - 输出：可能原因 + 修复步骤（基于 FAQ 模板）

## AI Dock 路由策略建议（与 Skill 化配套）

- 默认：自动意图识别
  - “部署/运行/节点/机器人应用”优先走 `rdk.nodehub.*`
  - “模型/推理/精度/量化/sample”优先走 `rdk.modelzoo.*`

- 强制前缀（已实现）：
  - `/openclaw <content>`：强制走 OpenClaw 链路
  - `/ai <content>`：强制走本地 AI 编排链路

## 建议的下一步落地顺序

1. 先实现 Skill Registry（静态）
   - 文件建议：`src/ai/skills/rdkSkills.ts`
   - 先注册 discovery + troubleshoot 两类（低风险、快见效）。

2. 再实现执行器（可调用）
   - NodeHub：先从 `search_apps` + `deploy_app` 开始。
   - ModelZoo：先从 `search_samples` + `prepare_env` + `run_sample` 开始。

3. 最后接入 AI Dock 自动路由
   - 基于关键词 + intent 打分决定 skill。
   - 保留 `/openclaw` 与 `/ai` 人工强制覆盖。

## 最小 JSON Schema 草案

```json
{
  "id": "rdk.modelzoo.run_sample",
  "name": "运行 ModelZoo 样例",
  "description": "在目标设备上运行指定 sample 并返回结果",
  "inputSchema": {
    "type": "object",
    "properties": {
      "samplePath": { "type": "string" },
      "runtime": { "type": "string", "enum": ["python", "jupyter", "vscode-remote"] },
      "args": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["samplePath", "runtime"]
  }
}
```

---

如果需要，我可以下一步直接在代码里落地：
- `rdk` 技能注册表 + 执行器骨架
- `AIDock` 的意图到 skill 的 first-pass 路由器
- NodeHub/ModelZoo 两个最小可用技能（可真实跑通）
