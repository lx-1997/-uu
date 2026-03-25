# RDK Studio 多 Agent 通信 + 云端 Agent 协作方案

> 版本: 0.1 | 日期: 2026-03-25 | 状态: 预研

---

## 1. 背景

当前架构：
- **RDKClaw**（云端/桌面端 Agent）：运行在 RDK Studio 服务端，负责用户对话、任务编排
- **OpenClaw**（板端 Agent）：运行在 RDK 板卡上，负责本地命令执行、技能调度
- **Fleet 工具**：已实现基础的跨板委派和广播

需要解决的问题：
1. 多 Agent 通信模式不够成熟——当前是单向委派，缺乏双向协商
2. 云端 Agent（RDKClaw）与板端 Agent（OpenClaw）的协作链路不够稳健
3. 多用户场景下 Agent 资源隔离和并发控制
4. 缺乏标准化的 Agent 间通信协议

---

## 2. 多 Agent 通信模式调研

### 2.1 业界常见模式

| 模式 | 描述 | 适用场景 | 已有框架 |
|------|------|---------|---------|
| **Hub-Spoke** | 中心 Agent 协调，边缘 Agent 执行 | 异构设备集群管理 | OpenAI Swarm |
| **Peer-to-Peer** | Agent 之间直接通信 | 对等协作任务 | LangGraph |
| **Blackboard** | 共享状态板，Agent 读写 | 复杂问题的分治 | Autogen |
| **Pipeline** | 串行处理链 | 数据处理、审核流 | CrewAI |
| **Supervisor** | 主管 Agent 分配 + 审核子 Agent | 质量敏感任务 | LangGraph |

### 2.2 RDK Studio 推荐模式：**Hub-Spoke + Blackboard 混合**

```
                    ┌─────────────────────┐
                    │   RDKClaw (Hub)     │
                    │   中心编排 Agent     │
                    │   · 任务分解         │
                    │   · 结果聚合         │
                    │   · 用户交互         │
                    └─────────┬───────────┘
                              │
                    ┌─────────┴───────────┐
                    │   Fleet Blackboard  │
                    │   共享状态板         │
                    │   · 任务队列         │
                    │   · 设备能力表       │
                    │   · 执行结果池       │
                    └──┬──────┬──────┬────┘
                       │      │      │
                 ┌─────┴┐ ┌──┴───┐ ┌┴─────┐
                 │ Board │ │ Board│ │ Board│
                 │ Agent │ │ Agent│ │ Agent│
                 │ (X3)  │ │ (X5) │ │(Ultra)│
                 └───────┘ └──────┘ └──────┘
```

**选择理由：**
- Hub-Spoke：RDKClaw 作为中心适合异构设备管理，用户只和一个 Agent 交互
- Blackboard：解决多 Agent 共享上下文问题，避免消息传递的复杂性

---

## 3. Agent 间通信协议设计

### 3.1 消息格式

```typescript
interface AgentMessage {
  id: string;
  from: AgentIdentity;
  to: AgentIdentity | 'broadcast';
  type: AgentMessageType;
  payload: unknown;
  replyTo?: string;         // 回复某条消息
  priority: 'low' | 'normal' | 'high';
  timestamp: number;
  ttl?: number;             // 消息过期时间（ms）
}

type AgentIdentity = {
  agentType: 'rdkclaw' | 'openclaw';
  deviceId?: string;        // 板端 Agent 的设备 ID
  sessionId?: string;       // RDKClaw 的会话 ID
};

type AgentMessageType =
  | 'task_delegate'         // 委派任务
  | 'task_result'           // 返回结果
  | 'task_progress'         // 进度更新
  | 'task_cancel'           // 取消任务
  | 'capability_query'      // 查询能力
  | 'capability_report'     // 报告能力
  | 'context_share'         // 共享上下文
  | 'suggestion'            // 建议（Agent 主动提出）
  | 'heartbeat';            // 心跳
```

### 3.2 通信通道

| 通道 | 技术 | 用途 | 延迟 |
|------|------|------|------|
| RDKClaw → OpenClaw | SSH + 板端 HTTP | 任务委派、命令执行 | ~1-3s |
| OpenClaw → RDKClaw | WebSocket (反向连接) | 结果回传、主动上报 | ~500ms |
| Board → Board | 通过 Hub 中转 | 跨板协作 | ~2-5s |
| Cloud → RDKClaw | REST API / WebSocket | 远程管理指令 | ~100-500ms |

### 3.3 Blackboard 共享状态设计

```typescript
interface FleetBlackboard {
  // 设备能力表（定期更新）
  capabilities: Map<string, DeviceCapabilityReport>;
  
  // 活跃任务队列
  activeTasks: Map<string, FleetTask>;
  
  // 任务结果池（完成的任务结果暂存，供聚合）
  resultPool: Map<string, TaskResult[]>;
  
  // 全局约束
  constraints: {
    maxConcurrentPerDevice: number;
    maxTotalConcurrent: number;
    defaultTimeout: number;
  };
}
```

---

## 4. 云端 Agent 协作方案

### 4.1 场景

| 场景 | RDKClaw 角色 | 云端服务角色 | OpenClaw 角色 |
|------|-------------|-------------|--------------|
| 远程调试 | 用户交互代理 | 请求转发 | 命令执行 |
| 模型部署 | 任务编排 | 模型下载/CDN | 模型安装运行 |
| 技能更新 | 触发同步 | 技能仓库 | 技能安装 |
| 数据采集 | 分析汇报 | 数据存储 | 传感器数据采集 |
| OTA 更新 | 用户确认 | 更新包分发 | 系统更新 |

### 4.2 云端 Agent 接口预留

```typescript
// 云端 Agent 注册
POST /api/cloud/agent/register
Body: {
  agentType: 'rdkclaw' | 'openclaw',
  deviceId?: string,
  capabilities: string[],
  publicKey: string        // 用于消息签名验证
}

// 云端任务分发
POST /api/cloud/tasks/dispatch
Body: {
  targetDevices: string[] | 'all',
  task: AgentMessage,
  collectMode: 'all' | 'fastest' | 'majority'
}

// 云端结果收集
GET /api/cloud/tasks/:taskId/results

// 设备心跳上报
POST /api/cloud/heartbeat
Body: {
  deviceId: string,
  status: DeviceStatus,
  capabilities: DeviceCapabilityReport
}
```

---

## 5. 多用户场景设计

### 5.1 资源隔离

```
用户 A ─→ Session A ─→ RDKClaw Instance A ─→ Device Pool A
用户 B ─→ Session B ─→ RDKClaw Instance B ─→ Device Pool B
                                                    ↑
                                              共享设备需加锁
```

### 5.2 并发控制

- **设备级锁**：同一设备同一时间只允许一个用户的命令执行（复用 device-exec-scheduler）
- **会话隔离**：每个用户的对话历史、知识库、偏好独立
- **设备共享策略**：管理员可配置设备是独占还是共享

### 5.3 用户体验保障

| 维度 | 措施 |
|------|------|
| 链路畅通 | 连接断开自动重连 + 操作排队 + 超时提示 |
| 稳定性 | 进程隔离 + 错误恢复 + 断路器 |
| 鲁棒性 | 消息 ACK 确认 + 重试机制 + 幂等操作 |
| 一致性 | 设备状态同步 + 乐观锁更新 |

---

## 6. 实现路径

### Phase 1: 通信协议标准化（2 周）

- [ ] 定义 AgentMessage 协议
- [ ] 实现 Fleet Blackboard 内存存储
- [ ] 改造现有 fleet-dispatch 工具使用新协议
- [ ] 板端 Agent 增加结果回传通道

### Phase 2: 双向通信（2-3 周）

- [ ] OpenClaw 增加主动上报能力（异常、建议）
- [ ] RDKClaw 增加 Agent 建议接收和展示
- [ ] 实现 capability_query / capability_report 握手

### Phase 3: 云端接口（配合 PRD-05，3-4 周）

- [ ] 实现云端 Agent 注册 API
- [ ] 实现远程任务分发
- [ ] 设备心跳上报 + 在线状态管理

### Phase 4: 多用户支持（4-6 周）

- [ ] 用户认证 + 会话隔离
- [ ] 设备访问控制
- [ ] 并发控制 + 排队机制

---

## 7. 对标分析

| 维度 | 当前 RDK Studio | 目标状态 | 参考 |
|------|----------------|---------|------|
| Agent 间通信 | 单向 SSH 委派 | Hub-Spoke + Blackboard | LangGraph, Autogen |
| 状态共享 | 无 | Fleet Blackboard | Redis Pub/Sub 模式 |
| 云端协作 | 无 | 标准 REST + WS | OpenClaw ContextEngine |
| 多用户 | 无 | Session 隔离 + 设备锁 | Jupyter Hub 模式 |
| 容错 | 基础 try-catch | 断路器 + 重试 + ACK | Netflix Hystrix 模式 |
