/**
 * AI Orchestrator — Capability Registry
 *
 * Each Capability describes one thing the app can do.
 * The registry is the "brain" that tells the AI what actions are available.
 */

import type { Capability, IntentId } from './types';

/** Full catalog of app capabilities */
export const CAPABILITIES: Capability[] = [
  {
    id: 'flash',
    label: '镜像烧录',
    description: '烧录系统镜像到SD卡或eMMC',
    phase: 'confirm',
    keywords: ['烧录', 'flash', '镜像', '刷机', '系统安装'],
    tab: 'flasher',
  },
  {
    id: 'terminal',
    label: '打开终端',
    description: '创建新终端会话并连接设备',
    phase: 'immediate',
    keywords: ['终端', 'terminal', 'ssh', '命令行', '控制台'],
    tab: 'terminal',
  },
  {
    id: 'terminal_cmd',
    label: '执行命令',
    description: '在设备终端执行指定命令',
    phase: 'immediate',
    keywords: ['执行', '运行', 'run', 'exec', '命令'],
    tab: 'terminal',
  },
  {
    id: 'file_upload',
    label: '文件上传',
    description: '通过SFTP上传文件到设备',
    phase: 'background',
    keywords: ['上传', 'upload', '传文件', '推送', '同步'],
    tab: 'files',
  },
  {
    id: 'file_download',
    label: '文件下载',
    description: '从设备下载文件到本地',
    phase: 'background',
    keywords: ['下载', 'download', '拉取', '获取文件'],
    tab: 'files',
  },
  {
    id: 'vnc',
    label: '远程桌面',
    description: '通过VNC连接设备远程桌面',
    phase: 'background',
    keywords: ['vnc', '桌面', '远程', '屏幕', '画面'],
    tab: 'vnc',
  },
  {
    id: 'openclaw_start',
    label: '启动 OpenClaw',
    description: '启动 OpenClaw Agent 网关服务',
    phase: 'background',
    keywords: ['openclaw', '小龙虾', '网关', 'agent', '启动'],
    tab: 'openclaw',
  },
  {
    id: 'openclaw_status',
    label: 'OpenClaw 状态',
    description: '查看 OpenClaw 网关运行状态',
    phase: 'immediate',
    keywords: ['openclaw', '小龙虾', '网关', '状态'],
    tab: 'openclaw',
  },
  {
    id: 'openclaw_switch',
    label: '切换模型',
    description: '切换 OpenClaw 底层推理模型',
    phase: 'confirm',
    keywords: ['切换模型', '换模型', 'switch model'],
    tab: 'openclaw',
  },
  {
    id: 'hardware_check',
    label: '硬件诊断',
    description: '检测BPU、温度、内存、网络等硬件状态',
    phase: 'background',
    keywords: ['硬件', 'bpu', '温度', 'cpu', '体检', '诊断', '检查', '散热'],
    tab: 'hardware',
  },
  {
    id: 'ros_scan',
    label: 'ROS2 话题扫描',
    description: '扫描枚举活跃 ROS2 话题',
    phase: 'background',
    keywords: ['ros', 'topic', '话题', '扫描话题'],
    tab: 'ros',
  },
  {
    id: 'ros_record_start',
    label: '开始 ROS 录制',
    description: '开始录制 ROS2 话题数据',
    phase: 'immediate',
    keywords: ['录制', 'record', '开始录'],
  },
  {
    id: 'ros_record_stop',
    label: '停止 ROS 录制',
    description: '停止 ROS2 话题录制',
    phase: 'immediate',
    keywords: ['停止录制', '结束录制', 'stop record'],
  },
  {
    id: 'model_deploy',
    label: '模型部署',
    description: '转换并部署AI模型到BPU',
    phase: 'confirm',
    keywords: ['部署', 'deploy', '转换', 'onnx', 'yolo', '模型部署'],
    tab: 'models',
  },
  {
    id: 'model_list',
    label: '模型列表',
    description: '查看已部署和待转换的模型',
    phase: 'immediate',
    keywords: ['模型', 'model', '推理', '列表'],
    tab: 'models',
  },
  {
    id: 'example_run',
    label: '运行示例',
    description: '运行内置示例应用（视觉跟随等）',
    phase: 'confirm',
    keywords: ['示例', 'demo', '跟随', '手势', '例子'],
    tab: 'examples',
  },
  {
    id: 'workflow',
    label: '流程编排',
    description: '管理和验证低代码流程编排',
    phase: 'background',
    keywords: ['流程', '编排', 'node-red', '工作流', 'lowcode'],
    tab: 'lowcode',
  },
  {
    id: 'device_scan',
    label: '设备扫描',
    description: '扫描局域网发现RDK设备',
    phase: 'background',
    keywords: ['扫描', '设备', '发现', '搜索设备'],
  },
  {
    id: 'nav',
    label: '页面导航',
    description: '跳转到指定功能页面',
    phase: 'immediate',
    keywords: ['打开', '跳转', '进入', '切换到', '去'],
  },
  {
    id: 'settings',
    label: '系统设置',
    description: '打开设置面板',
    phase: 'immediate',
    keywords: ['设置', 'settings', '偏好', '配置'],
  },
  {
    id: 'general',
    label: '通用对话',
    description: '无特定操作的对话回复',
    phase: 'immediate',
    keywords: [],
  },
];

/** Lookup capability by ID */
export function getCapability(id: IntentId): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

/** Match user text to a capability via keyword overlap (fallback when AI fails) */
export function matchCapabilityByKeyword(text: string): { id: IntentId; param?: string } {
  const lc = text.toLowerCase();

  // ─── Shell command detection (highest priority) ───
  // If user types a raw shell command, route to terminal_cmd with the command
  const shellCmdRe = /^(ls|cat|cd|top|free|df|ps|grep|tail|head|chmod|mkdir|rm|cp|mv|pip|apt|ros2|hrut_smi|hbdk|hobot|bputop|dmesg|ifconfig|ip |ping |ssh |scp )\b/i;
  const shellMatch = text.match(shellCmdRe);
  if (shellMatch) {
    return { id: 'terminal_cmd', param: text };
  }
  // "执行/运行 xxx" with an actual command
  const execMatch = text.match(/(?:执行|运行|跑一下|跑)\s+(.+)/);
  if (execMatch && /^[a-z/]/.test(execMatch[1].trim())) {
    return { id: 'terminal_cmd', param: execMatch[1].trim() };
  }

  // ─── Priority-ordered compound checks ───

  // Recording stop must come before general recording
  if ((lc.includes('录制') || lc.includes('record')) && (lc.includes('停') || lc.includes('stop') || lc.includes('结束'))) {
    return { id: 'ros_record_stop' };
  }
  if (lc.includes('录制') || lc.includes('record') || lc.includes('rosbag')) {
    return { id: 'ros_record_start' };
  }

  // OpenClaw sub-intents (order: start/switch before generic status)
  if ((lc.includes('openclaw') || lc.includes('小龙虾') || lc.includes('网关')) && (lc.includes('启动') || lc.includes('start') || lc.includes('打开'))) {
    return { id: 'openclaw_start' };
  }
  if ((lc.includes('openclaw') || lc.includes('小龙虾') || lc.includes('网关')) && (lc.includes('切换') || lc.includes('换') || lc.includes('switch'))) {
    return { id: 'openclaw_switch' };
  }
  if (lc.includes('openclaw') || lc.includes('小龙虾') || lc.includes('agent')) {
    return { id: 'openclaw_status' };
  }

  // Model-specific (deploy before list)
  if ((lc.includes('模型') || lc.includes('yolo') || lc.includes('resnet') || lc.includes('onnx') || lc.includes('model')) && (lc.includes('部署') || lc.includes('转换') || lc.includes('deploy') || lc.includes('编译'))) {
    return { id: 'model_deploy' };
  }

  // File-specific (upload before generic)
  if (lc.includes('上传') || lc.includes('同步') || (lc.includes('文件') && (lc.includes('传') || lc.includes('推') || lc.includes('发送')))) {
    return { id: 'file_upload' };
  }
  if (lc.includes('下载') || lc.includes('拉取') || lc.includes('拉日志') || lc.includes('下日志')) {
    return { id: 'file_download' };
  }

  // Hardware — catch more chinese patterns
  if (lc.includes('温度') || lc.includes('散热') || lc.includes('发烫') || lc.includes('过热') || lc.includes('体检') || lc.includes('诊断')) {
    return { id: 'hardware_check' };
  }
  if ((lc.includes('bpu') || lc.includes('cpu') || lc.includes('内存') || lc.includes('硬件')) && (lc.includes('情况') || lc.includes('检查') || lc.includes('看看') || lc.includes('多少'))) {
    return { id: 'hardware_check' };
  }

  // Navigation — "去/打开/进入 xxx 页面"
  const navMatch = lc.match(/(?:打开|去|进入|到|切换到|看看)\s*(?:(.+?)(?:页面|页|面板|模块))/);
  if (navMatch) {
    const tabMap: Record<string, IntentId> = {
      '仪表盘': 'nav', '首页': 'nav', '终端': 'nav', '烧录': 'nav',
      '文件': 'nav', '桌面': 'nav', '编排': 'nav', '硬件': 'nav',
      '示例': 'nav', 'ros': 'nav', '模型': 'nav',
    };
    const key = Object.keys(tabMap).find(k => navMatch[1]?.includes(k));
    if (key) return { id: 'nav', param: key };
  }

  // Try each capability's keywords
  for (const cap of CAPABILITIES) {
    if (cap.id === 'general' || cap.id === 'nav') continue;
    if (cap.keywords.some((kw) => lc.includes(kw))) {
      return { id: cap.id };
    }
  }

  return { id: 'general' };
}
