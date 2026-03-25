# RDKClaw 子 Agent（板端代理）机制设计

> 版本: 0.1 | 日期: 2026-03-25 | 状态: 预研

---

## 1. 问题

当 RDK 板卡上**没有安装 OpenClaw** 时，当前系统的能力严重受限：

| 维度 | 有 OpenClaw | 无 OpenClaw |
|------|-------------|-------------|
| 命令执行 | OpenClaw Gateway 原生执行 | SSH 逐条发送 |
| 上下文保持 | 板端会话自动累积 | 每次 SSH 无状态 |
| 技能调用 | OpenClaw 自带技能系统 | 无 |
| 异步任务 | Gateway 管理长任务 | SSH 超时断开即丢失 |
| 环境感知 | OpenClaw 自动探测 ROS/Python/模型 | RDKClaw 需手动探测 |
| 安全沙箱 | OpenClaw 有权限控制 | SSH root 直连，风险高 |

用户场景：教育场景下学生板卡较多，统一安装 OpenClaw 不现实；部分开发者选择不安装。

---

## 2. 设计目标

1. **无需板端安装**：RDKClaw 自身提供"虚拟板端 Agent"能力
2. **对上层透明**：`board_openclaw_delegate` 等现有工具继续工作，自动降级
3. **计算不堆积**：避免所有推理都在 PC 端完成，合理分工
4. **可逆升级**：用户随时安装真正的 OpenClaw，系统自动切换

---

## 3. 架构方案

### 3.1 核心概念：BoardProxy

```
┌──────────────────────────────────────────────┐
│  RDK Studio (PC)                             │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐   │
│  │   RDKClaw    │◄──►│   BoardProxy      │   │
│  │  (主 Agent)  │    │  (虚拟板端Agent)  │   │
│  └──────────────┘    └────────┬──────────┘   │
│                               │              │
│                          SSH 隧道            │
│                               │              │
└───────────────────────────────┼──────────────┘
                                │
                     ┌──────────▼──────────┐
                     │    RDK Board        │
                     │  (无 OpenClaw)      │
                     │  - 命令执行          │
                     │  - 文件读写          │
                     │  - 环境数据          │
                     └─────────────────────┘
```

### 3.2 BoardProxy 职责

1. **环境探测与缓存**
   - 首次连接执行探测脚本（ROS distro、Python 版本、已安装包、硬件信息）
   - 结果缓存在 PC 端，TTL = 10 分钟
   - 缓存序列化到 `RDK_DATA_DIR/proxy-env/<deviceId>.json`

2. **命令编排**
   - 接收 RDKClaw 的任务描述，拆解为 SSH 命令序列
   - 自动注入环境变量（`source /opt/ros/*/setup.bash` 等）
   - 命令之间保持逻辑上下文（前一条输出作为下一条的输入参考）

3. **状态跟踪**
   - 维护一个轻量级会话（`ProxySession`），记录：
     - 已执行命令历史
     - 当前工作目录
     - 发现的环境信息
   - 会话在 RDKClaw 对话期间保持，对话结束回收

4. **长任务管理**
   - 对于耗时任务（编译、模型推理），使用 `nohup` + 临时脚本
   - 轮询进度文件（`/tmp/rdkproxy-<taskId>.log`）
   - 超时自动清理

### 3.3 自动降级策略

```typescript
interface DelegationStrategy {
  // 在 board_openclaw_delegate 执行前决定走哪条路
  resolve(deviceId: string): Promise<'openclaw' | 'proxy'>;
}

// 判断逻辑优先级：
// 1. OpenClaw Gateway 可达（HTTP health check） → 'openclaw'
// 2. SSH 可达 → 'proxy'
// 3. 均不可达 → 抛错
```

在 `board-openclaw-delegate.ts` 中，`execute()` 入口自动判断：

```typescript
async execute(input, ctx) {
  const strategy = await resolveDelegation(deviceId);
  if (strategy === 'openclaw') {
    return this.delegateViaOpenClaw(input, ctx);
  }
  return this.delegateViaProxy(input, ctx);
}
```

### 3.4 计算分工原则

| 任务类型 | 执行位置 | 理由 |
|---------|---------|------|
| 命令执行 | 板端（SSH） | 必须在目标设备 |
| 文件操作 | 板端（SSH） | 数据在板端 |
| 任务拆解/规划 | PC（RDKClaw） | 需要 LLM 推理 |
| 结果分析/总结 | PC（RDKClaw） | 需要 LLM 推理 |
| 模型推理 | 板端 | 需要 BPU 硬件 |
| 日志分析 | PC（读取后分析） | 板端无 LLM |

关键原则：**推理在 PC，执行在板端**。BoardProxy 不包含独立的 LLM 推理循环，它是 RDKClaw 的"远程手臂"。

---

## 4. ProxySession 数据模型

```typescript
interface ProxySession {
  id: string;
  deviceId: string;
  createdAt: number;
  lastActiveAt: number;

  // 板端环境缓存
  env: {
    rosDistro?: string;
    pythonVersion?: string;
    arch: string;
    memoryMB: number;
    hasBPU: boolean;
    bpuModel?: string;
    installedPackages: string[];
    openclaw: 'installed' | 'not-installed' | 'unknown';
  };

  // 命令历史（滑动窗口，保留最近 50 条）
  history: Array<{
    cmd: string;
    exitCode: number;
    stdout: string;  // 截断到 4KB
    ts: number;
  }>;

  // 虚拟工作目录
  cwd: string;

  // 活跃长任务
  activeTasks: Map<string, {
    pid: number;
    logPath: string;
    startedAt: number;
  }>;
}
```

---

## 5. 与现有工具的整合

### 5.1 board_openclaw_delegate 改造

```typescript
// 当前：直连 OpenClaw Gateway
// 改造：增加 proxy 分支

async function delegateViaProxy(
  deviceId: string,
  task: string,
  guidance?: string,
): Promise<string> {
  const session = getOrCreateProxySession(deviceId);

  // 将任务 + 板端环境 + 历史上下文 交给 RDKClaw 规划
  const plan = await rdkclaw.planBoardTask({
    task,
    guidance,
    boardEnv: session.env,
    recentHistory: session.history.slice(-10),
  });

  // 按步骤执行
  const results: string[] = [];
  for (const step of plan.steps) {
    const result = await execOnDevice(deviceId, [step.command]);
    session.history.push({
      cmd: step.command,
      exitCode: result.exitCode ?? -1,
      stdout: result.output?.slice(0, 4096) ?? '',
      ts: Date.now(),
    });
    results.push(result.output ?? '');

    // 步骤失败时允许 RDKClaw 重新规划
    if (result.exitCode !== 0 && step.continueOnError !== true) {
      const recovery = await rdkclaw.handleStepFailure({
        failedStep: step,
        error: result.output,
        boardEnv: session.env,
      });
      if (recovery.abort) break;
      // 插入恢复命令
      plan.steps.splice(plan.steps.indexOf(step) + 1, 0, ...recovery.steps);
    }
  }

  return results.join('\n---\n');
}
```

### 5.2 新增工具

| 工具名 | 描述 |
|--------|------|
| `board_proxy_env` | 获取/刷新板端环境信息（走探测脚本） |
| `board_proxy_upload` | 上传文件到板端（base64 → SSH echo → decode） |
| `board_proxy_download` | 从板端下载文件（cat → base64） |
| `board_proxy_long_task` | 启动后台长任务，返回 taskId |
| `board_proxy_task_status` | 查询长任务进度 |

---

## 6. 安全考虑

1. **命令白名单**：proxy 模式下限制危险命令（`rm -rf /`、`dd if=/dev/zero`）
2. **资源限制**：单个 proxy session 最多 50 条命令/分钟
3. **超时保护**：单条命令默认 60 秒超时，长任务走 nohup
4. **审计日志**：所有 proxy 执行的命令记录到 `RDK_DATA_DIR/proxy-audit.jsonl`

---

## 7. 实现路线

### Phase 1: 基础 Proxy（1-2 周）

- [ ] 实现 `BoardProxyManager`（session 管理、环境探测、命令执行）
- [ ] 在 `board_openclaw_delegate` 中增加自动降级
- [ ] 环境探测脚本（`scripts/probe-board-env.sh`）
- [ ] 单元测试

### Phase 2: 长任务与文件传输（1 周）

- [ ] nohup + 轮询机制
- [ ] 文件上传/下载工具
- [ ] Proxy session 持久化

### Phase 3: 智能编排（2 周）

- [ ] 任务拆解 prompt 优化
- [ ] 错误恢复策略
- [ ] 与 Fleet 系统整合（proxy 设备也能参与多板协作）

### Phase 4: 可选安装引导（1 周）

- [ ] 在 proxy 模式下定期提示用户安装 OpenClaw 以获得更好体验
- [ ] 一键安装流程保持现有逻辑

---

## 8. 风险与 Trade-off

| 风险 | 影响 | 缓解 |
|------|------|------|
| SSH 连接不稳定 | 命令中断 | 重试 + checkpoint |
| PC 端 LLM 推理成本高 | 多板时 token 消耗大 | 任务规划结果缓存 |
| 无 OpenClaw 技能系统 | 复杂任务效率低 | 内置常见任务模板 |
| 安全风险（SSH root） | 误操作 | 命令白名单 + 确认流程 |

---

## 9. 与现有文档的关系

- **design-multi-agent-cloud.md**：子 Agent 是 Hub-Spoke 中 Spoke 的 proxy 实现
- **prd-05-cloud-integration.md**：proxy 机制可扩展到云端 VM
- **design-knowledge-brain.md**：proxy 执行的成功方案可沉淀为知识
