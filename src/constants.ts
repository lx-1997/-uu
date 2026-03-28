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
  {
    id: 'ubuntu-22.04',
    label: 'Ubuntu 22.04 LTS (官方推荐)',
    labelEn: 'Ubuntu 22.04 LTS (recommended)',
    detail: '基础开发环境 + Docker runtime',
    detailEn: 'Base dev environment + Docker runtime',
  },
  {
    id: 'ros2-humble',
    label: 'ROS2 Humble 预装版',
    labelEn: 'ROS2 Humble (preinstalled)',
    detail: '预装 TogetherROS.b 与调试工具链',
    detailEn: 'TogetherROS.b and debug toolchain preinstalled',
  },
  {
    id: 'tros-ai',
    label: 'TROS AI 开发版',
    labelEn: 'TROS AI dev',
    detail: '适合视觉算法与小龙虾示例快速验证',
    detailEn: 'Vision algorithms and quick sample validation',
  },
  {
    id: 'local',
    label: '浏览本地文件...',
    labelEn: 'Browse local file…',
    detail: '导入自定义镜像包并保留元数据校验',
    detailEn: 'Import a custom image with metadata checks',
  },
];

export function getFlashImageLabel(id: string, isEn: boolean): string {
  const row = FLASH_IMAGES.find((i) => i.id === id);
  if (!row) return id;
  return isEn ? row.labelEn : row.label;
}

export const TERMINAL_PROFILES = [
  {
    id: 'shell',
    label: '系统 Shell',
    labelEn: 'System shell',
    desc: '命令行操作日志查看与环境配置',
    descEn: 'CLI logs and environment setup',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw 对话',
    labelEn: 'OpenClaw chat',
    desc: 'AI 对话模式用自然语言操控设备',
    descEn: 'Natural-language device control via AI chat',
  },
];

export function getTerminalProfileLabel(profileId: string, isEn: boolean): string {
  const row = TERMINAL_PROFILES.find((p) => p.id === profileId);
  if (!row) return isEn ? 'System shell' : '系统 Shell';
  return isEn ? row.labelEn : row.label;
}

/** 命令建议：中英双语，筛选时同时匹配 zh/en/keyword */
export const CMD_SUGGESTIONS: Array<{ icon: string; textZh: string; textEn: string; keyword: string }> = [
  { icon: '', textZh: '基于当前设备状态，给我一份可执行应用计划', textEn: 'Based on the current device, give me an executable app plan', keyword: '计划' },
  { icon: '', textZh: '汇总当前设备可用能力并生成执行建议', textEn: 'Summarize device capabilities and suggest next actions', keyword: '同步' },
  { icon: '', textZh: '帮我烧录最新系统镜像并给出验证步骤', textEn: 'Flash the latest system image and list verification steps', keyword: '烧录' },
  { icon: '', textZh: '打开 SSH 终端并检查 ROS2 与 BPU 环境', textEn: 'Open SSH terminal and check ROS2 and BPU environment', keyword: '终端' },
  { icon: '', textZh: '连接 VNC 并优化远程调试体验', textEn: 'Connect VNC and tune remote debugging', keyword: 'vnc' },
  { icon: '', textZh: '查看 ROS 话题异常并给出修复命令', textEn: 'Inspect ROS topic issues and suggest fix commands', keyword: 'ros' },
  { icon: '', textZh: '部署一个可运行的视觉应用并回显结果', textEn: 'Deploy a runnable vision app and show results', keyword: '示例' },
  { icon: '', textZh: '生成 OpenClaw 工作流模板并执行', textEn: 'Generate an OpenClaw workflow template and run it', keyword: 'openclaw' },
];

export type CmdSuggestion = { icon: string; text: string; keyword: string; textZh: string; textEn: string };

