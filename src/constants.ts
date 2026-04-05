import type { DashboardCard } from './app-types';

/**
 * 统一「检测」轮询周期（与 server `DEVICE_DIAGNOSTICS_CACHE_TTL_MS` 对齐）。
 * 按 `DEVICE_POLL_PHASE_*` 将请求分散到 6 个时间片，避免同一瞬间多路并发 SSH。
 */
export const DEVICE_POLL_PERIOD_MS = 15_000;

const DEVICE_POLL_SLOT_MS = DEVICE_POLL_PERIOD_MS / 6;

/** 诊断（MEM/温度/BPU…） */
export const DEVICE_POLL_PHASE_DIAGNOSTICS_MS = DEVICE_POLL_SLOT_MS * 0;
/** 设备列表 SSH ping（多机时循环内串行） */
export const DEVICE_POLL_PHASE_DEVICE_PING_MS = DEVICE_POLL_SLOT_MS * 1;
/** 板端 OpenClaw health → 工作区 health（串行） */
export const DEVICE_POLL_PHASE_BOARD_HEALTH_MS = DEVICE_POLL_SLOT_MS * 2;
/** 本机 RDK Studio `/api/health` */
export const DEVICE_POLL_PHASE_STUDIO_BACKEND_MS = DEVICE_POLL_SLOT_MS * 3;
/** 顶栏 Wi‑Fi 链路 */
export const DEVICE_POLL_PHASE_TOPBAR_WIFI_MS = DEVICE_POLL_SLOT_MS * 4;
/** OpenClaw 页 Wi‑Fi / 自动装网关 tick */
export const DEVICE_POLL_PHASE_OPENCLAW_WIFI_TICK_MS = DEVICE_POLL_SLOT_MS * 5;

export const DEVICE_DIAGNOSTICS_POLL_MS = DEVICE_POLL_PERIOD_MS;
export const DEVICE_SSH_PING_INTERVAL_MS = DEVICE_POLL_PERIOD_MS;
export const TOPBAR_WIFI_LINK_POLL_MS = DEVICE_POLL_PERIOD_MS;

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    tab: 'openclaw',
    title: 'OpenClaw',
    description: '板端网关：模型、渠道与设备侧任务',
    loading: '正在打开 OpenClaw…',
    statusLabel: '板端状态',
    statusOk: true,
    miniStats: [{ label: '技能与任务', value: '--' }, { label: '网关', value: '--' }],
    cta: '打开 OpenClaw',
    quickActions: [{ label: '刷新状态', icon: '↻' }, { label: '部署', icon: '⊕' }],
  },
  {
    tab: 'terminal',
    title: '终端',
    description: 'SSH 进入设备，执行命令与排障',
    loading: '正在打开终端…',
    statusLabel: '连接',
    statusOk: true,
    miniStats: [{ label: '连接方式', value: 'SSH' }, { label: '会话', value: '实时' }],
    cta: '打开终端',
    quickActions: [{ label: '巡检', icon: '⌕' }, { label: '环境', icon: '≡' }],
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
  {
    icon: '',
    textZh: '用几句话说明 RDK Studio 与 RDKClaw 如何帮我解决板端实际问题',
    textEn: 'Explain how RDK Studio and RDKClaw help me solve real on-board problems',
    keyword: '介绍',
  },
  { icon: '', textZh: '帮我做一次设备体检并给出风险项', textEn: 'Run a device health check and list risk items', keyword: '体检' },
  { icon: '', textZh: '在当前设备上运行一个 YOLO 示例并返回结果', textEn: 'Run a YOLO demo on this device and report the result', keyword: 'yolo' },
  { icon: '', textZh: '分析终端最近输出并给出修复步骤', textEn: 'Analyze recent terminal output and provide fix steps', keyword: '日志' },
];

export type CmdSuggestion = { icon: string; text: string; keyword: string; textZh: string; textEn: string };

