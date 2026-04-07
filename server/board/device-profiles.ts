/**
 * Device Profiles — Hardware capability matrix for each RDK board variant.
 *
 * Used by RDKClaw and the board detect API to understand device capabilities.
 *
 * When a device connects, we resolve its profile from board info
 * (e.g. /sys/class/socinfo/board_id, /proc/device-tree/model, or hrut_smi).
 */

import type { RdkPlatform } from '../../shared/board-types.js';

export interface DeviceProfile {
  platform: RdkPlatform;
  /** Marketing name */
  displayName: string;
  /** SoC chip name */
  soc: string;
  /** BPU compute (TOPS) */
  bpuTops: number;
  /** CPU core description */
  cpu: string;
  /** Default RAM (GB) */
  ramGb: number;
  /** Supported model input format */
  modelFormat: string;
  /** BPU diagnostic command */
  bpuCmd: string;
  /** TROS base path */
  trosPath: string;
  /** Default Python with hobot_dnn available */
  systemPython: string;
  /** BPU infer library package name */
  bpuInferLib: string;
  /** Board detection patterns (strings found in /proc/device-tree/model or board_id) */
  detectionPatterns: string[];
  /** Known limitations that AI should be aware of */
  limitations: string[];
  /** Official documentation base URL */
  docBaseUrl: string;
  /** Capability notes for RDKClaw's inner wisdom (injected into system prompt) */
  capabilityNotes: string[];
}

export const DEVICE_PROFILES: Record<RdkPlatform, DeviceProfile> = {
  'rdk-x3': {
    platform: 'rdk-x3',
    displayName: 'RDK X3',
    soc: 'Sunrise 3 (X3J3)',
    bpuTops: 5,
    cpu: 'Quad-core Cortex-A53 @1.5GHz',
    ramGb: 2,
    modelFormat: 'NV12 BIN (Bernoulli2)',
    bpuCmd: 'hrut_smi',
    trosPath: '/opt/tros/humble',
    systemPython: '/usr/bin/python3.8',
    bpuInferLib: 'bpu_infer_lib_x3',
    detectionPatterns: ['x3', 'X3', 'sunrise3', 'j3', 'xj3'],
    limitations: [
      'Max 5 TOPS — heavy models (YOLOv5x, large LLM) will be slow',
      '2 GB RAM — cannot run models larger than ~500 MB',
      'No USB3 — USB camera bandwidth limited',
    ],
    docBaseUrl: 'https://developer.d-robotics.cc/rdk_doc/',
    capabilityNotes: [
      '5TOPS BPU 适合轻量模型 (YOLOv5s/MobileNet/FCOS)',
      '2GB 内存限制大模型使用，LLM 不可用',
      '40pin GPIO (I2C/SPI/UART/PWM)，2路MIPI CSI摄像头',
      '适用场景：教学入门、轻量视觉检测、GPIO 控制',
    ],
  },

  'rdk-x5': {
    platform: 'rdk-x5',
    displayName: 'RDK X5',
    soc: 'Sunrise 5',
    bpuTops: 10,
    cpu: 'Octa-core Cortex-A55 @1.5GHz',
    ramGb: 4,
    modelFormat: 'NV12 BIN (Bayes)',
    bpuCmd: 'hrut_smi',
    trosPath: '/opt/tros/humble',
    systemPython: '/usr/bin/python3.10',
    bpuInferLib: 'bpu_infer_lib_x5',
    detectionPatterns: ['x5', 'X5', 'sunrise5', 'Sunrise 5'],
    limitations: [
      'LLM limited to ≤2B parameter quantized models on-device',
    ],
    docBaseUrl: 'https://developer.d-robotics.cc/rdk_doc/',
    capabilityNotes: [
      '10TOPS BPU，YOLO/分类/分割/姿态估计主力平台',
      '支持 DOSOD 开放词汇检测 (~12fps)，端侧 LLM (≤2B)',
      '4K 视频编解码，CAN FD 接口，Wi-Fi 6，4路USB3.0',
      '40pin GPIO (28路GPIO/5路UART/8路PWM/3路I2C/2路SPI)',
      '适用场景：机器人视觉、TROS pipeline、端侧AI推理',
    ],
  },

  'rdk-ultra': {
    platform: 'rdk-ultra',
    displayName: 'RDK Ultra',
    soc: 'Sunrise 5 Ultra',
    bpuTops: 96,
    cpu: 'Octa-core Cortex-A55',
    ramGb: 8,
    modelFormat: 'NV12 BIN (Bayes)',
    bpuCmd: 'hrut_smi',
    trosPath: '/opt/tros/humble',
    systemPython: '/usr/bin/python3.10',
    bpuInferLib: 'bpu_infer_lib_x5',
    detectionPatterns: ['ultra', 'Ultra', 'RDK Ultra'],
    limitations: [
      'Higher power consumption — needs active cooling',
    ],
    docBaseUrl: 'https://developer.d-robotics.cc/rdk_doc/',
    capabilityNotes: [
      '96TOPS BPU，支持大规模模型推理',
      '8GB RAM，可运行较大模型',
    ],
  },

  // S100 标准版 80TOPS; S100P 为 128TOPS (2.0GHz CPU, 24GB RAM)
  'rdk-s100': {
    platform: 'rdk-s100',
    displayName: 'RDK S100',
    soc: 'S100 (Nash)',
    bpuTops: 80,
    cpu: 'Hexa-core Cortex-A78AE @1.5GHz + Quad-core Cortex-R52+ MCU @1.2GHz',
    ramGb: 12,
    modelFormat: 'NV12 BIN (Nash)',
    bpuCmd: 'hrut_smi',
    trosPath: '/opt/tros/humble',
    systemPython: '/usr/bin/python3.10',
    bpuInferLib: 'bpu_infer_lib_s100',
    detectionPatterns: ['s100', 'S100', 'RDK S100', 'rdk_s100'],
    limitations: [
      '12-20V DC 供电，功耗高于 X5',
      'Nash BPU 模型格式与 Bayes(X5) 不兼容，需重新编译',
      'MIPI/GMSL 相机需配扩展板',
    ],
    docBaseUrl: 'https://developer.d-robotics.cc/rdk_doc/rdk_s/',
    capabilityNotes: [
      '80TOPS Nash BPU (S100P=128TOPS)，支持 160+ ONNX 算子，CNN+Transformer 优化',
      'MCU (4x R52+ @1.2GHz) 支持高帧率低延迟关节实时控制，具身智能首选',
      'DOSOD 开放词汇检测 ~45fps，可运行 LLM/VLM/DeepSeek/InternVL2',
      '12GB LPDDR5 (S100P=24GB)，GMSL+MIPI 多路相机，双千兆网口',
      '适用场景：具身智能、人形机器人、大模型推理、高级视觉应用',
      'TROS 排障：root 下若无 ros2，先 source /opt/tros/humble/setup.bash；仍不对时换 sunrise 用户看 ~/.bashrc 是否已配 tros.b（部分镜像仅普通用户写入 source）',
    ],
  },
};

const DEFAULT_RESEARCH_SEEDS = [
  'https://developer.d-robotics.cc/rdk_doc/',
  'https://github.com/D-Robotics',
];

/** URLs to prioritize for web_fetch / web_search on RDK tasks. */
/**
 * 工作区健康脚本 `bpu_ready`：在套件端用 `importlib.util.find_spec` 探测，**任一条**命中即视为 BPU Python 栈可用。
 * 须覆盖 X3 / X5 / Ultra（Bayes）与 S100（Nash）等不同 `bpu_infer_lib_*` 包名。
 */
const WORKSPACE_HEALTH_BPU_IMPORTLIB_SPECS = [
  'hobot_dnn',
  'hobot_dnn_rdkx5',
  'bpu_infer_lib_x5',
  'bpu_infer_lib_x3',
  'bpu_infer_lib_s100',
] as const;

/** 供 `bash` 中 `python3 -c "..."` 内联（不含外层引号） */
export function buildWorkspaceHealthBpuReadyPythonInline(): string {
  const tuple = WORKSPACE_HEALTH_BPU_IMPORTLIB_SPECS.join("','");
  return `import importlib.util; mods=('${tuple}'); print(1 if any(importlib.util.find_spec(name) is not None for name in mods) else 0)`;
}

/**
 * 套件端 SSH 脚本里一键 `source` TROS。
 *
 * 与官方文档一致：配置 tros.b 环境 → `source /opt/tros/humble/setup.bash`（RDK S100 / X5 / Ultra 等 Humble 镜像）。
 * 本函数**优先**该路径；再兼容旧版 Foxy（`/opt/tros/setup.bash` 等）与各发行版子目录通配（见下行 return 中的 shell glob，注释内避免写星号+斜杠以免截断块注释）。
 * 单行、无换行，可嵌入 bash -lc 的单引号参数字符串。
 */
export function buildTrosSourceLoopBash(): string {
  return 'for _tros_setup in /opt/tros/humble/setup.bash /opt/tros/setup.bash /opt/tros/foxy/setup.bash /opt/tros/*/setup.bash; do [ -f "$_tros_setup" ] && . "$_tros_setup" 2>/dev/null && break; done; true';
}

export function getResearchSeeds(platform: RdkPlatform | null): string[] {
  if (!platform) return [...DEFAULT_RESEARCH_SEEDS];
  const p = DEVICE_PROFILES[platform];
  if (!p) return [...DEFAULT_RESEARCH_SEEDS];
  const out = [p.docBaseUrl];
  for (const u of DEFAULT_RESEARCH_SEEDS) {
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * Detect board platform from raw board info string
 * (output of cat /proc/device-tree/model or cat /sys/class/socinfo/board_id).
 */
export function detectPlatform(boardInfo: string): RdkPlatform | null {
  const lower = boardInfo.toLowerCase();
  for (const [platform, profile] of Object.entries(DEVICE_PROFILES)) {
    if (profile.detectionPatterns.some((p) => lower.includes(p.toLowerCase()))) {
      return platform as RdkPlatform;
    }
  }
  return null;
}

/**
 * Get the profile for a platform. Returns null for unknown platforms.
 */
export function getDeviceProfile(platform: RdkPlatform): DeviceProfile | null {
  return DEVICE_PROFILES[platform] ?? null;
}

/**
 * Build the SSH command that detects board identity in one shot.
 * Returns structured markers for easy parsing.
 */
export function buildBoardDetectionCommand(): string {
  return [
    'echo "===BOARD_MODEL==="',
    'cat /proc/device-tree/model 2>/dev/null || echo unknown',
    'echo "===BOARD_ID==="',
    'cat /sys/class/socinfo/board_id 2>/dev/null || echo unknown',
    'echo "===OS_VERSION==="',
    'cat /etc/version 2>/dev/null || cat /etc/os-release 2>/dev/null | head -4 || echo unknown',
    'echo "===BPU==="',
    'hrut_smi 2>/dev/null | head -5 || echo bpu_unavailable',
  ].join('; ');
}

/**
 * Parse the output of buildBoardDetectionCommand() to get platform.
 */
export function parseBoardDetection(output: string): {
  platform: RdkPlatform | null;
  model: string;
  osVersion: string;
} {
  const section = (marker: string): string => {
    const idx = output.indexOf(marker);
    if (idx < 0) return '';
    const start = idx + marker.length;
    const nextMarker = output.indexOf('===', start);
    return (nextMarker > 0 ? output.slice(start, nextMarker) : output.slice(start)).trim();
  };

  const model = section('===BOARD_MODEL===');
  const boardId = section('===BOARD_ID===');
  const osVersion = section('===OS_VERSION===');

  const combined = `${model} ${boardId}`;
  const platform = detectPlatform(combined);

  return { platform, model: model || boardId, osVersion };
}


