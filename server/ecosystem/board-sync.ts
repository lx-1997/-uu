/**
 * Board Sync — Synchronizes board-side state with the Ecosystem Registry.
 *
 * One SSH command batch-collects all relevant state from the device:
 *   - Installed TROS / APT packages
 *   - Running processes
 *   - ModelZoo model files
 *   - OpenClaw skills on board
 *   - Active ROS2 nodes
 *
 * The parsed results are fed into EcosystemRegistry.batchUpdateBoardStatus()
 * so every EcoSkill knows whether it's installed/running on each device.
 */

import type { BoardSyncResult } from '../../shared/ecosystem-types.js';
import type { EcosystemRegistry } from './registry.js';

/**
 * Build a single SSH command that collects all ecosystem-relevant state.
 * Uses section markers for reliable parsing.
 */
export function buildSyncCommand(): string {
  return `bash -lc '
echo "===TROS_PKGS==="
dpkg -l 2>/dev/null | awk "/^ii.*tros-/{print \\$2}" || true
echo "===APT_PKGS==="
dpkg -l 2>/dev/null | awk "/^ii.*hobot/{print \\$2}" || true
echo "===MODELZOO_FILES==="
ls -1 /opt/rdk_model_zoo/models 2>/dev/null || true
echo "===PROCESSES==="
ps -eo args --no-headers 2>/dev/null | grep -E "ros2|python3|hobot_|dnn_node|openclaw|yolov5|fcos|mobilenet|deeplab|whisper|body_track|gesture|dosod|slam|nav2|tts|llamacpp" | grep -v grep || true
echo "===OPENCLAW_SKILLS==="
ls -1 /opt/openclaw/skills 2>/dev/null || true
echo "===ROS2_NODES==="
(source /opt/tros/humble/setup.bash 2>/dev/null && ros2 node list 2>/dev/null) || true
echo "===SYNC_DONE==="
'`;
}

/**
 * Parse the output of buildSyncCommand() into structured data.
 */
export function parseSyncOutput(output: string): {
  installedPackages: string[];
  runningProcesses: string[];
  modelFiles: string[];
  openclawSkills: string[];
  rosNodes: string[];
} {
  const section = (marker: string): string[] => {
    const startTag = `===` + marker + `===`;
    const idx = output.indexOf(startTag);
    if (idx < 0) return [];
    const start = idx + startTag.length;
    const nextMarker = output.indexOf('===', start + 1);
    const raw = nextMarker > 0 ? output.slice(start, nextMarker) : output.slice(start);
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  };

  return {
    installedPackages: [...section('TROS_PKGS'), ...section('APT_PKGS')],
    runningProcesses: section('PROCESSES'),
    modelFiles: section('MODELZOO_FILES'),
    openclawSkills: section('OPENCLAW_SKILLS'),
    rosNodes: section('ROS2_NODES'),
  };
}

/**
 * Execute a full board sync: parse SSH output → update registry.
 *
 * @param deviceId - Device identifier in the registry
 * @param sshOutput - Raw output from running buildSyncCommand() on the device
 * @param registry - The ecosystem registry to update
 */
export function applyBoardSync(
  deviceId: string,
  sshOutput: string,
  registry: EcosystemRegistry,
): BoardSyncResult {
  const parsed = parseSyncOutput(sshOutput);

  const installed = new Set([
    ...parsed.installedPackages,
    ...parsed.modelFiles.map((f) => f.toLowerCase()),
  ]);

  const running = new Set(parsed.runningProcesses);

  const skillsUpdated = registry.batchUpdateBoardStatus(
    deviceId,
    installed,
    running,
  );

  return {
    deviceId,
    syncedAt: new Date().toISOString(),
    installedPackages: parsed.installedPackages,
    runningProcesses: parsed.runningProcesses,
    rosNodes: parsed.rosNodes,
    openclawSkills: parsed.openclawSkills,
    modelFiles: parsed.modelFiles,
    skillsUpdated,
  };
}
