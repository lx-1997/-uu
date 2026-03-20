import type { DashboardCard } from './app-types';

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    tab: 'openclaw',
    title: 'OpenClaw 网关',
    description: '统一接入模型与机器人能力，快速进入对话式编排与执行',
    loading: '正在打开 OpenClaw 网关与编排面板...',
    statusLabel: '板端网关联动',
    statusOk: true,
    miniStats: [{ label: '可编排能力', value: '--' }, { label: '网关状态', value: '--' }],
    cta: '进入网关工作台',
    quickActions: [{ label: '状态联动', icon: '🔄' }, { label: '应用方案', icon: '✨' }],
  },
  {
    tab: 'terminal',
    title: '终端环境',
    description: '直接进入设备命令行，执行诊断、部署与日常运维命令',
    loading: '正在打开终端环境...',
    statusLabel: '实时连接',
    statusOk: true,
    miniStats: [{ label: '连接方式', value: 'SSH' }, { label: '执行模式', value: '实时' }],
    cta: '打开终端',
    quickActions: [{ label: '快速巡检', icon: '🔍' }, { label: '环境检查', icon: '🧪' }],
  },
  {
    tab: 'ros',
    title: 'ROS 运行诊断',
    description: '话题/节点/TF 全链路诊断，定位应用编排后的运行问题',
    loading: '正在扫描 ROS2 话题...',
    statusLabel: '实时可观测',
    statusOk: true,
    miniStats: [{ label: '活跃 Topic', value: '--' }, { label: '诊断方式', value: '实时命令' }],
    cta: '进入 ROS 诊断',
    quickActions: [{ label: '话题巡检', icon: '📡' }, { label: '节点健康', icon: '🧭' }],
  },
  {
    tab: 'hardware',
    title: '硬件监控',
    description: '持续观察 CPU/BPU/温度与系统资源，快速定位性能瓶颈',
    loading: '正在打开硬件监控面板...',
    statusLabel: '实时监控',
    statusOk: true,
    miniStats: [{ label: '关键指标', value: 'CPU/BPU/温度' }, { label: '刷新频率', value: '实时' }],
    cta: '进入硬件监控',
    quickActions: [{ label: '温度监测', icon: '🌡️' }, { label: '资源诊断', icon: '📊' }],
  },
];

export const FLASH_IMAGES = [
  { id: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS (官方推荐)', detail: '基础开发环境 + Docker runtime' },
  { id: 'ros2-humble', label: 'ROS2 Humble 预装版', detail: '预装 TogetherROS.b 与调试工具链' },
  { id: 'tros-ai', label: 'TROS AI 开发版', detail: '适合视觉算法与小龙虾示例快速验证' },
  { id: 'local', label: '浏览本地文件...', detail: '导入自定义镜像包并保留元数据校验' },
];

export const TERMINAL_PROFILES = [
  { id: 'shell', label: '系统 Shell', desc: '命令行操作日志查看与环境配置' },
  { id: 'openclaw', label: 'OpenClaw 对话', desc: 'AI 对话模式用自然语言操控设备' },
];

export const CMD_SUGGESTIONS = [
  { icon: '', text: '基于当前设备状态，给我一份可执行应用计划', keyword: '计划' },
  { icon: '', text: '汇总当前设备可用能力并生成执行建议', keyword: '同步' },
  { icon: '', text: '帮我烧录最新系统镜像并给出验证步骤', keyword: '烧录' },
  { icon: '', text: '打开 SSH 终端并检查 ROS2 与 BPU 环境', keyword: '终端' },
  { icon: '', text: '连接 VNC 并优化远程调试体验', keyword: 'vnc' },
  { icon: '', text: '查看 ROS 话题异常并给出修复命令', keyword: 'ros' },
  { icon: '', text: '部署一个可运行的视觉应用并回显结果', keyword: '示例' },
  { icon: '', text: '生成 OpenClaw 工作流模板并执行', keyword: 'openclaw' },
];

