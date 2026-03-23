# RDK Studio 汇报附录（证据 / 术语 / Q&A）

## 1. 关键证据清单（按汇报主题组织）

## 1.1 项目定位与启动方式

| 主题 | 证据文件 | 重点信息 |
|---|---|---|
| 产品定位 | `README.md` | RDK Studio 面向机器人设备的 AI Native 工作台，覆盖聊天、设备接入、OpenClaw |
| 启动与构建 | `package.json` | `dev` / `desktop` / `build` / `build:desktop:*` 脚本完整 |
| 端口与联调 | `README.md` | 前端 `5173`，后端 `8787`，包含实机联调建议 |

## 1.2 架构与模块边界

| 主题 | 证据文件 | 重点信息 |
|---|---|---|
| 后端总入口 | `server/index.ts` | 集中挂载设备、RDKCLAW、OpenClaw、生态、飞书等路由 |
| RDKCLAW 编排核心 | `server/rdkclaw/app.ts` | `streamChat`、工具装配、策略决策、审批包装、事件映射 |
| 设备执行与部署 | `server/managers/OpenClawDeploymentManager.ts` | SSH 连接池、安装/升级/健康/日志/对话网关桥接 |
| 生态技能供给 | `server/ecosystem/providers/openclaw-skills.ts` | 种子技能（含 STT/TTS）转换为可注册能力 |

## 1.3 前端体验与可观测性

| 主题 | 证据文件 | 重点信息 |
|---|---|---|
| API 封装与安全透传 | `src/api.ts` | 设备密码会话级保存并通过 `x-device-password` 透传 |
| SSE 消费与执行可视化 | `src/hooks/useAIChatStore.ts` | `meta/tool/approval/error` 全流程事件可视化 |
| RDKCLAW 接口全集 | `src/api.ts` | persona/policy/approval/run/task/feishu 等管理接口 |

## 1.4 语音与工具关系

| 主题 | 证据文件 | 重点信息 |
|---|---|---|
| 设备工具 STT/TTS | `server/agent/tools/rdk-tools.ts` | `text_to_speech` 与 `speech_to_text` 作为 Agent 工具 |
| 生态种子 STT/TTS | `server/ecosystem/providers/openclaw-skills.ts` | `openclaw.tts` 与 `openclaw.stt` 元数据能力 |
| 附件音频转写 | `server/rdkclaw/app.ts` | 会话附件先转写再进推理链路 |

## 2. 术语表（汇报时统一口径）

- `RDK Studio`：面向机器人设备研发与运维的一体化工作台（Web/Electron）。
- `RDKCLAW`：Studio 侧任务编排内核，负责策略决策、工具调用、审批与事件回传。
- `OpenClaw`：板端 AI 运行与能力执行体，可被 RDKCLAW 委派任务。
- `board_openclaw_assess`：板端可执行性评估工具。
- `board_openclaw_delegate`：板端任务委派工具。
- `RDK 工具`：通过 SSH 在设备执行命令/文件/服务/语音等能力的工具集合。
- `生态技能`：可注册、可下发到板端的能力目录（非等同于即时工具调用）。
- `SSE`：前后端流式事件通道，用于返回文本增量、工具进度、审批状态等。
- `审批模式`：对高风险工具调用的人工确认机制。

## 3. 常见问题与标准答复（管理层版）

### Q1：这个项目现在是“实验性质”还是“可对外演示/试点”？

建议答复：
当前已具备可演示和试点能力，尤其在设备接入、AI 编排、OpenClaw 部署链路上已形成闭环。下一步重点是质量门禁与架构解耦，以支持规模化交付。

### Q2：RDKCLAW 和 OpenClaw 会不会重复建设？

建议答复：
两者定位不同。RDKCLAW 是调度和治理层，OpenClaw 是板端执行层。一个负责“决定怎么做”，一个负责“在设备上做成”。

### Q3：最大的短板是什么？

建议答复：
不是功能不足，而是工程化护栏不足（测试、CI、可观测性）和服务边界耦合，需要在下一阶段优先治理。

### Q4：为什么要强调审批机制？

建议答复：
因为设备操作存在高风险命令，审批机制是把“自动化能力”变成“可控生产能力”的关键。

### Q5：投入优先级如何排？

建议答复：
先做 P0（测试+解耦+观测），再做 P1（链路收敛+语音离线化探索），最后推进平台化（多设备/多租户/生态治理）。

## 4. 常见问题与标准答复（技术版）

### Q1：当前主聊天链路是哪条？

建议答复：
主链路是 `/api/agent/chat` + `RDKClawApp.streamChat()`（SSE 事件流）。`/api/chat` 仍存在兼容路径，建议逐步收敛。

### Q2：板端优先策略如何生效？

建议答复：
由 `selectDelegateDecision()` 综合用户 mode、文本规则、skill policy、persona/policy 计算，输出 `forceBoard/preferBoard`。

### Q3：工具审批在哪里做？

建议答复：
在 `wrapToolWithApproval()`。所有工具在执行前都可被策略拦截并触发审批事件。

### Q4：STT/TTS 走哪条链路？

建议答复：
有三条互补链路：附件转写链路、设备工具链路、生态技能链路。分别对应会话理解、即时执行、能力供给。

### Q5：如何解释“本地执行 vs 板端执行”的结果差异？

建议答复：
前端可通过 SSE 元数据和工具时间线看到执行主体（`rdkclaw_local`/`board_openclaw`）、决策原因与实际工具调用。

## 5. 汇报时建议准备的现场演示清单

- 演示 A：设备连接 + 健康检查（证明基础链路可用）。
- 演示 B：RDKCLAW 对话触发工具 + 审批流程（证明治理能力）。
- 演示 C：板端委派（assess -> delegate）+ 回退（证明鲁棒性）。
- 演示 D：语音附件转写进入对话上下文（证明多模态实用化）。
- 演示 E：飞书绑定与镜像消息（证明跨渠道协同）。

## 6. 演示风险预案（避免现场翻车）

- 预案 1：板端网关异常时，先走本地工具链路演示核心能力。
- 预案 2：网络受限时，关闭联网工具并演示离线可完成任务。
- 预案 3：语音服务不稳定时，改用已上传音频与预转写文本。
- 预案 4：飞书未就绪时，展示 Studio 端同等事件时间线与审批能力。

## 7. 附录索引（本次输出文档）

- `docs/rdkstudio-project-review-report.md`
- `docs/rdkclaw-deep-dive-report.md`
- `docs/rdkstudio-risk-roadmap-report.md`
- `docs/rdkstudio-appendix-and-qa.md`
