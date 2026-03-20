/**
 * Device Profiles — Hardware capability matrix for each RDK board variant.
 *
 * Used by the Ecosystem Registry to filter skills by device compatibility,
 * and by AI Dock to understand what the current device can / cannot do.
 *
 * When a device connects, we resolve its profile from board info
 * (e.g. /sys/class/socinfo/board_id, /proc/device-tree/model, or hrut_smi).
 */

import type { RdkPlatform } from '../../shared/ecosystem-types.js';

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
}

export const DEVICE_PROFILES: Record<RdkPlatform, DeviceProfile> = {
  'rdk-x3': {
    platform: 'rdk-x3',
    displayName: 'RDK X3',
    soc: 'Sunrise 3 (X3J3)',
    bpuTops: 5,
    cpu: 'Quad-core Cortex-A53',
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
  },

  'rdk-x5': {
    platform: 'rdk-x5',
    displayName: 'RDK X5',
    soc: 'Sunrise 5',
    bpuTops: 10,
    cpu: 'Dual-core Cortex-A55',
    ramGb: 4,
    modelFormat: 'NV12 BIN (Bayes)',
    bpuCmd: 'hrut_smi',
    trosPath: '/opt/tros/humble',
    systemPython: '/usr/bin/python3.10',
    bpuInferLib: 'bpu_infer_lib_x5',
    detectionPatterns: ['x5', 'X5', 'sunrise5', 'Sunrise 5'],
    limitations: [
      'Dual-core CPU — multi-threaded workloads may bottleneck',
      'LLM limited to ≤2B parameter quantized models on-device',
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
  },

  'rdk-s100': {
    platform: 'rdk-s100',
    displayName: 'RDK S100',
    soc: 'S100',
    bpuTops: 128,
    cpu: 'Octa-core',
    ramGb: 8,
    modelFormat: 'NV12 BIN',
    bpuCmd: 'hrut_smi',
    trosPath: '/opt/tros/humble',
    systemPython: '/usr/bin/python3.10',
    bpuInferLib: 'bpu_infer_lib_s100',
    detectionPatterns: ['s100', 'S100', 'RDK S100'],
    limitations: [],
  },
};

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
