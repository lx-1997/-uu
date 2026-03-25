# RDK Studio AI Native 自检能力 + 统一测试方案

> 版本: 0.1 | 日期: 2026-03-25 | 状态: 预研

---

## 1. 背景

RDK Studio 作为 AI Native 产品，应当具备 AI 驱动的自检能力：
- 自动检测功能可用性（前端渲染 + 后端 API + 设备连通性）
- 自动识别前后端接口不匹配（前端调用了不存在的 API，或 API 存在但前端未使用）
- 定期健康巡检并生成报告
- 用户可通过一句话触发全链路自检

---

## 2. 自检架构

### 2.1 三层自检模型

```
┌──────────────────────────────────────────┐
│          Layer 3: AI 智能诊断            │
│  "帮我检查一下系统状态"                  │
│  → 调用 system_health_check 工具         │
│  → 自然语言报告 + 修复建议               │
└────────────────────┬─────────────────────┘
                     ▼
┌──────────────────────────────────────────┐
│          Layer 2: API 合规性检查          │
│  自动化脚本扫描前后端接口一致性          │
│  → 路由注册 vs 前端 fetch 调用对比       │
│  → 发现幽灵 API / 断裂调用              │
└────────────────────┬─────────────────────┘
                     ▼
┌──────────────────────────────────────────┐
│          Layer 1: 基础连通性检查          │
│  服务端口 / WebSocket / 设备 SSH / VNC   │
│  → 纯技术层面的可达性验证                │
└──────────────────────────────────────────┘
```

### 2.2 Layer 1: 基础连通性检查清单

| 检查项 | 方法 | 预期结果 |
|--------|------|---------|
| Express 服务端口 | HTTP GET /api/health | 200 OK |
| Socket.IO 连接 | ws connect + ping | pong 响应 |
| 设备 SSH 连通 | 对每个注册设备执行 `echo OK` | OK |
| VNC 端口 | TCP connect :5900 | 连接成功 |
| OpenClaw Gateway | 对已部署设备查 ss -lntp :18789 | 端口监听 |
| RDKClaw AI | POST /api/agent/chat + 简单问题 | 流式响应 |
| 文件系统 | POST /api/devices/:id/files/list | 文件列表 |
| Monaco CDN | HTTP GET jsdelivr URL | 200 |

### 2.3 Layer 2: API 合规性扫描

**前端 fetch 调用提取：**
```bash
# 从前端源码中提取所有 API 调用
rg 'fetch\(|resolveApiUrl\(' src/ --no-heading
```

**后端路由注册提取：**
```bash
# 从 server/index.ts 提取所有路由定义
rg 'app\.(get|post|put|delete|patch)\(' server/index.ts --no-heading
```

**对比逻辑：**
```typescript
interface ApiAuditResult {
  // 前端调用但后端未定义的接口（断裂调用）
  brokenCalls: { path: string; file: string; line: number }[];
  // 后端定义但前端未使用的接口（幽灵 API）
  unusedApis: { method: string; path: string }[];
  // 匹配的健康接口
  matchedApis: { method: string; path: string }[];
}
```

### 2.4 Layer 3: AI 智能诊断工具

新增 RDKClaw 工具 `system_health_check`：

```typescript
{
  name: 'system_health_check',
  description: '对 RDK Studio 执行全链路自检，包括服务连通性、设备状态、API 可用性',
  parameters: {
    scope: {
      type: 'string',
      enum: ['quick', 'full', 'api_audit'],
      description: 'quick: 仅基础连通; full: 全链路; api_audit: 前后端接口审计'
    }
  }
}
```

---

## 3. 统一测试脚本设计

### 3.1 脚本结构

```
scripts/
  health-check.ts          # 主入口
  checks/
    connectivity.ts        # Layer 1 连通性
    api-audit.ts           # Layer 2 接口审计
    device-smoke.ts        # 设备功能烟雾测试
    ui-regression.ts       # UI 页面可访问性
```

### 3.2 命令行接口

```bash
# 快速检查（~10s）
npm run health:quick

# 完整检查（~60s）
npm run health:full

# API 接口审计
npm run health:api-audit

# 输出 JSON 报告
npm run health:full -- --json > report.json
```

### 3.3 报告格式

```typescript
interface HealthReport {
  timestamp: number;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  checks: Array<{
    name: string;
    category: 'connectivity' | 'api' | 'device' | 'ui';
    status: 'pass' | 'fail' | 'warn' | 'skip';
    message: string;
    duration: number;
  }>;
}
```

---

## 4. 已知的前后端不匹配问题（初步审计）

基于代码审查发现的潜在问题：

| 类型 | 详情 |
|------|------|
| 前端有组件但未接入主界面 | `Models.tsx`, `Examples.tsx`, `Sidebar.tsx` — Tab 类型已定义但 App.tsx 未渲染 |
| Tab 类型无对应组件 | `lowcode` tab 在类型定义中存在但无对应组件 |
| Socket.IO 重复连接 | `OpenClaw.tsx` 和 `AIDock.tsx` 同时为同一设备维持两条 Socket.IO |
| 终端多连接 | `Terminal.tsx` 每个会话独立 `io()` 连接，与共享连接约定不一致 |

---

## 5. 实现路径

### Phase 1: 基础自检脚本（1 周）

- [ ] 实现 Layer 1 连通性检查（HTTP + WS + SSH）
- [ ] 实现 API 路由对比扫描
- [ ] 输出 JSON/Markdown 报告
- [ ] 注册 npm scripts

### Phase 2: AI 集成（1 周）

- [ ] 实现 `system_health_check` RDKClaw 工具
- [ ] Agent 可通过对话触发自检
- [ ] 自检结果自然语言化

### Phase 3: 持续监控（2 周）

- [ ] 定时自检（可选：每次启动时自动快速检查）
- [ ] 异常告警推送（通过 NotificationHub）
- [ ] 检查结果历史趋势
