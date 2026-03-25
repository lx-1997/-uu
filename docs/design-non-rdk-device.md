# 非 RDK 设备接入方案

> 版本: 0.1 | 日期: 2026-03-25 | 状态: 预研

---

## 1. 问题

RDK Studio 当前深度绑定 D-Robotics RDK 系列板卡：

- 设备管理假设 RDK 平台属性（`RdkPlatform`：X3/X5/Ultra）
- AI 工具（`rdk-tools.ts`）专为 OpenClaw + BPU 场景设计
- 生态注册（EcosystemRegistry）按 RDK 平台过滤技能
- 烧录（Flasher）仅支持 RDK 官方镜像

但用户可能连接：
1. **其他嵌入式板卡**：Jetson、树莓派、Rockchip、RISC-V 开发板
2. **云端 VM/容器**：AWS EC2、Azure VM、Docker 容器
3. **工控设备**：工厂边缘计算节点
4. **教学用 Linux PC**：学生用台式机

这些设备共同点：**都可以通过 SSH 连接**。

---

## 2. 设计原则

1. **不改 RDK 链路**：现有 RDK 设备的体验不受影响
2. **SSH 是最小公约**：所有设备至少支持 SSH
3. **能力渐进**：设备越强，可用功能越多（SSH < SSH+Docker < SSH+ROS < SSH+OpenClaw）
4. **类型安全**：引入设备类型层，编译期防错

---

## 3. 设备类型抽象

### 3.1 DeviceType 枚举

```typescript
type DeviceType =
  | 'rdk'        // D-Robotics RDK 系列
  | 'jetson'     // NVIDIA Jetson
  | 'raspberry'  // Raspberry Pi
  | 'generic'    // 通用 Linux（云端 VM、其他 ARM/x86 板）
  | 'cloud-vm';  // 云端虚拟机（特殊标记，可能有 GPU）

interface DeviceCapability {
  ssh: boolean;          // 基础 SSH（所有设备必须 true）
  openclaw: boolean;     // 板端有 OpenClaw
  bpu: boolean;          // 有 D-Robotics BPU
  gpu: boolean;          // 有 GPU（Jetson CUDA / 云端 GPU）
  ros: boolean;          // 有 ROS 环境
  docker: boolean;       // 有 Docker
  vnc: boolean;          // 有 VNC/远程桌面
  flash: boolean;        // 支持烧录
}
```

### 3.2 设备探测流程

连接设备后自动执行探测：

```bash
# 1. 检测平台
cat /proc/device-tree/model 2>/dev/null || echo "unknown"
uname -m

# 2. 检测 D-Robotics BPU
ls /dev/bpu* 2>/dev/null && echo "HAS_BPU"
cat /sys/class/misc/ion/version 2>/dev/null

# 3. 检测 NVIDIA GPU
nvidia-smi 2>/dev/null && echo "HAS_NVIDIA_GPU"

# 4. 检测 ROS
source /opt/ros/*/setup.bash 2>/dev/null && echo "HAS_ROS"
source /opt/tros/*/setup.bash 2>/dev/null && echo "HAS_TROS"

# 5. 检测 Docker
docker --version 2>/dev/null && echo "HAS_DOCKER"

# 6. 检测 OpenClaw
openclaw --version 2>/dev/null && echo "HAS_OPENCLAW"
```

探测结果填充 `DeviceCapability`，存入设备记录。

### 3.3 数据模型变更

```typescript
// devices.json 中的设备记录扩展
interface StoredDevice {
  id: string;
  host: string;
  port: number;
  username: string;
  // ...existing fields...

  // 新增
  deviceType: DeviceType;         // 默认 'rdk' 保持兼容
  capabilities: DeviceCapability; // 探测结果
  platformLabel?: string;         // 自定义标签，如 "Jetson Orin NX 16GB"
  probeTs?: number;               // 上次探测时间
}
```

---

## 4. 功能矩阵

| 功能 | RDK | Jetson | 树莓派 | 云端 VM | 通用 Linux |
|------|-----|--------|--------|---------|-----------|
| SSH 终端 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 文件管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI 对话 | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenClaw 委派 | ✅ | ⬜ 可安装 | ⬜ 可安装 | ⬜ 可安装 | ⬜ 可安装 |
| BoardProxy 代理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| BPU 模型部署 | ✅ | ❌ | ❌ | ❌ | ❌ |
| GPU 推理 | ❌ | ✅ CUDA | ❌ | ✅ 可能 | ❌ |
| ROS 集成 | ✅ | ✅ | ✅ | ✅ | ❌ 通常 |
| VNC 桌面 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 镜像烧录 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 生态技能 | ✅ RDK | 部分 | 部分 | 通用 | 通用 |
| Fleet 多板协作 | ✅ | ✅ | ✅ | ✅ | ✅ |

⬜ = 需要额外安装

---

## 5. 实现方案

### 5.1 连接流程改造

```
用户输入 SSH 信息
    │
    ▼
SSH 连接成功
    │
    ▼
运行探测脚本
    │
    ▼
┌───────────────────────────────┐
│ 探测到 /proc/device-tree 包含 │
│ "Sunrise" / "RDK" / "Horizon"│──► deviceType = 'rdk'
│                               │
│ 探测到 "NVIDIA Jetson"        │──► deviceType = 'jetson'
│                               │
│ 探测到 "Raspberry Pi"         │──► deviceType = 'raspberry'
│                               │
│ 其他                          │──► deviceType = 'generic'
└───────────────────────────────┘
    │
    ▼
存储到 devices.json（含 capabilities）
    │
    ▼
前端根据 capabilities 显示/隐藏功能入口
```

### 5.2 工具注册按能力过滤

```typescript
function registerToolsForDevice(device: StoredDevice): Tool[] {
  const tools: Tool[] = [];

  // SSH 基础工具（所有设备）
  tools.push(boardExecTool(device.id));
  tools.push(boardFileReadTool(device.id));
  tools.push(boardFileWriteTool(device.id));

  // OpenClaw 工具（仅 openclaw 可用时）
  if (device.capabilities.openclaw) {
    tools.push(boardOpenClawDelegateTool(device.id, ...));
    tools.push(boardOpenClawStatusTool(device.id));
  } else {
    // 降级到 BoardProxy
    tools.push(boardProxyDelegateTool(device.id));
  }

  // BPU 工具（仅 RDK）
  if (device.capabilities.bpu) {
    tools.push(boardBpuDeployTool(device.id));
    tools.push(boardBpuStatusTool(device.id));
  }

  // GPU 工具（Jetson / 云端 GPU）
  if (device.capabilities.gpu) {
    tools.push(boardGpuStatusTool(device.id));
  }

  // ROS 工具
  if (device.capabilities.ros) {
    tools.push(boardRosTopicsTool(device.id));
    tools.push(boardRosNodesTool(device.id));
  }

  // Docker 工具
  if (device.capabilities.docker) {
    tools.push(boardDockerListTool(device.id));
    tools.push(boardDockerRunTool(device.id));
  }

  return tools;
}
```

### 5.3 前端适配

```typescript
// 侧边栏设备图标
function getDeviceIcon(type: DeviceType): LucideIcon {
  switch (type) {
    case 'rdk': return Cpu;
    case 'jetson': return Gpu;
    case 'raspberry': return CircuitBoard;
    case 'cloud-vm': return Cloud;
    default: return Server;
  }
}

// 功能面板根据 capabilities 显示
function shouldShowFlasher(device: StoredDevice): boolean {
  return device.deviceType === 'rdk' && device.capabilities.flash;
}

function shouldShowRos(device: StoredDevice): boolean {
  return device.capabilities.ros;
}
```

### 5.4 AI 系统提示词适配

在构建 system prompt 时注入设备上下文：

```typescript
function buildDeviceContext(device: StoredDevice): string {
  const caps = device.capabilities;
  return [
    `当前设备: ${device.platformLabel || device.deviceType}`,
    `设备类型: ${device.deviceType}`,
    `能力: ${Object.entries(caps).filter(([,v]) => v).map(([k]) => k).join(', ')}`,
    device.deviceType !== 'rdk'
      ? '注意: 这不是 RDK 设备，BPU 相关工具不可用。请使用通用 Linux 方式操作。'
      : '',
    caps.gpu ? '该设备有 GPU，可执行 CUDA/TensorRT 推理。' : '',
    !caps.openclaw ? '板端未安装 OpenClaw，将使用 SSH Proxy 模式执行任务。' : '',
  ].filter(Boolean).join('\n');
}
```

---

## 6. 迁移策略

### Phase 0: 兼容层（0 改动）

现有 `devices.json` 中的设备默认 `deviceType = 'rdk'`，所有功能照旧。

### Phase 1: 设备类型字段 + 探测（1 周）

- [ ] `StoredDevice` 增加 `deviceType` 和 `capabilities` 字段
- [ ] 连接时运行探测脚本
- [ ] 已有设备迁移：无 `deviceType` 字段的设备默认 `'rdk'`
- [ ] 前端设备列表显示设备类型标签

### Phase 2: 工具按能力注册（1 周）

- [ ] `registerToolsForDevice` 按 capabilities 过滤
- [ ] 非 RDK 设备隐藏 Flasher 入口
- [ ] 非 ROS 设备隐藏 ROS 入口

### Phase 3: BoardProxy 整合（与 design-sub-agent.md 同步）

- [ ] 非 OpenClaw 设备自动走 BoardProxy
- [ ] Fleet 系统支持混合设备类型

### Phase 4: 云端 VM 专项（2 周）

- [ ] 云端设备连接向导（支持密钥认证、跳板机）
- [ ] GPU 设备工具集（nvidia-smi 监控、CUDA 推理）
- [ ] 云端 Docker 容器管理

---

## 7. 连接方式扩展

### 当前支持

- SSH 密码认证
- SSH 密钥认证（通过页面导入）

### 计划扩展

| 方式 | 场景 | 优先级 |
|------|------|--------|
| SSH 跳板机 | 云端设备在 VPN/内网 | P1 |
| SSH 密钥 Agent | 本地 ssh-agent 集成 | P2 |
| WireGuard/Tailscale | 远程设备 P2P | P2 |
| WebSocket 隧道 | 浏览器版远程连接 | P3 |

---

## 8. 风险与 Trade-off

| 风险 | 影响 | 缓解 |
|------|------|------|
| 平台差异大 | 命令兼容性问题 | 探测 + 条件分支 |
| BusyBox 环境 | 嵌入式设备缺少命令 | 最小化依赖 |
| 网络环境复杂 | 云端连接不稳定 | 断线重连 + SSH keepalive |
| 功能碎片化 | UI 复杂度上升 | 按能力渐进展示 |
| 生态技能不通用 | RDK 技能不适用其他板 | 技能 platform tag |

---

## 9. 与其他文档的关系

- **design-sub-agent.md**：BoardProxy 是非 RDK 设备的核心执行层
- **design-multi-agent-cloud.md**：混合设备 Fleet 协作
- **prd-05-cloud-integration.md**：云端 VM 是此方案的一个实例
- **prd-01-product-overview.md**：需新增"通用设备支持"章节
