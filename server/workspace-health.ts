import { buildWorkspaceHealthBpuReadyPythonInline } from './board/device-profiles.js';
import { shellEscape } from './utils/shell-escape.js';

export type WorkspaceModuleHealth = {
  ready: boolean;
  installed: boolean;
  running?: boolean;
  summary: string;
  recommendedAction: string;
  missing?: string[];
};

export type DeviceWorkspaceHealth = {
  checkedAt: number;
  readyModules: number;
  totalModules: number;
  modules: {
    development: WorkspaceModuleHealth;
    codeServer: WorkspaceModuleHealth;
    vnc: WorkspaceModuleHealth;
    ros: WorkspaceModuleHealth;
    nodeHub: WorkspaceModuleHealth;
    modelZoo: WorkspaceModuleHealth;
  };
};

const WORKSPACE_HEALTH_SCRIPT = [
  '_dpkg=$(dpkg -l 2>/dev/null | awk "/^ii/{print \\$2}")',
  '_ss=$(ss -lntp 2>/dev/null)',
  '_ps=$(ps -eo args --no-headers 2>/dev/null)',
  'for _tros_setup in /opt/tros/*/setup.bash; do [ -f "$_tros_setup" ] && . "$_tros_setup" 2>/dev/null && break; done; true',
  'python_ready=$(command -v python3 >/dev/null 2>&1 && echo 1 || echo 0)',
  'git_ready=$(command -v git >/dev/null 2>&1 && echo 1 || echo 0)',
  'node_ready=$(command -v node >/dev/null 2>&1 && echo 1 || echo 0)',
  'npm_ready=$(command -v npm >/dev/null 2>&1 && echo 1 || echo 0)',
  'code_installed=$(command -v code-server >/dev/null 2>&1 && echo 1 || echo 0)',
  'code_running=$( (echo "$_ss" | grep -q ":13337" || echo "$_ps" | grep -q "code-server.*13337") && echo 1 || echo 0 )',
  'vnc_installed=$( (command -v x11vnc >/dev/null 2>&1 || command -v vncserver >/dev/null 2>&1) && echo 1 || echo 0 )',
  'vnc_running=$( (echo "$_ss" | grep -q ":5900" || echo "$_ps" | grep -qE "x11vnc|Xtigervnc|vncserver") && echo 1 || echo 0 )',
  'ros2_ready=$(command -v ros2 >/dev/null 2>&1 && echo 1 || echo 0)',
  'rosbridge_installed=$(echo "$_dpkg" | grep -q "rosbridge" && echo 1 || echo 0)',
  'rosbridge_running=$( (echo "$_ss" | grep -q ":9090" || echo "$_ps" | grep -qE "rosbridge_websocket|rosbridge_server") && echo 1 || echo 0 )',
  'tros_count=$(echo "$_dpkg" | grep -Ec "^(tros-|hobot)" || true)',
  'ros_distro=$(printenv ROS_DISTRO 2>/dev/null || ls -1 /opt/tros/ 2>/dev/null | head -1 || ls -1 /opt/ros/ 2>/dev/null | head -1 || echo humble)',
  'modelzoo_dir=$(test -d /opt/rdk_model_zoo && echo 1 || echo 0)',
  'hrt_ready=$(command -v hrt_model_exec >/dev/null 2>&1 && echo 1 || echo 0)',
  `bpu_ready=$(if [ "$python_ready" = "1" ]; then python3 -c "${buildWorkspaceHealthBpuReadyPythonInline()}" 2>/dev/null || echo 0; else echo 0; fi)`,
  'printf "checked_at=%s\\n" "$(date +%s)"',
  'printf "python_ready=%s\\n" "$python_ready"',
  'printf "git_ready=%s\\n" "$git_ready"',
  'printf "node_ready=%s\\n" "$node_ready"',
  'printf "npm_ready=%s\\n" "$npm_ready"',
  'printf "code_installed=%s\\n" "$code_installed"',
  'printf "code_running=%s\\n" "$code_running"',
  'printf "vnc_installed=%s\\n" "$vnc_installed"',
  'printf "vnc_running=%s\\n" "$vnc_running"',
  'printf "ros2_ready=%s\\n" "$ros2_ready"',
  'printf "rosbridge_installed=%s\\n" "$rosbridge_installed"',
  'printf "rosbridge_running=%s\\n" "$rosbridge_running"',
  'printf "tros_count=%s\\n" "$tros_count"',
  'printf "ros_distro=%s\\n" "$ros_distro"',
  'printf "modelzoo_dir=%s\\n" "$modelzoo_dir"',
  'printf "hrt_ready=%s\\n" "$hrt_ready"',
  'printf "bpu_ready=%s\\n" "$bpu_ready"',
].join('; ');

export const WORKSPACE_HEALTH_COMMAND = `bash -lc ${shellEscape(WORKSPACE_HEALTH_SCRIPT)}`;

export function parseWorkspaceHealthPairs(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const idx = line.indexOf('=');
      if (idx <= 0) return acc;
      acc[line.slice(0, idx)] = line.slice(idx + 1);
      return acc;
    }, {});
}

export function readHealthBool(values: Record<string, string>, key: string) {
  return values[key] === '1';
}

export function readHealthInt(values: Record<string, string>, key: string) {
  const value = Number.parseInt(values[key] || '0', 10);
  return Number.isFinite(value) ? value : 0;
}

function buildWorkspaceModuleStatus(
  ready: boolean,
  installed: boolean,
  summary: string,
  recommendedAction: string,
  missing: string[] = [],
  running?: boolean,
): WorkspaceModuleHealth {
  return {
    ready,
    installed,
    ...(typeof running === 'boolean' ? { running } : {}),
    summary,
    recommendedAction,
    ...(missing.length > 0 ? { missing } : {}),
  };
}

export function buildWorkspaceHealth(output: string): DeviceWorkspaceHealth {
  const values = parseWorkspaceHealthPairs(output);
  const pythonReady = readHealthBool(values, 'python_ready');
  const gitReady = readHealthBool(values, 'git_ready');
  const nodeReady = readHealthBool(values, 'node_ready');
  const npmReady = readHealthBool(values, 'npm_ready');
  const codeInstalled = readHealthBool(values, 'code_installed');
  const codeRunning = readHealthBool(values, 'code_running');
  const vncInstalled = readHealthBool(values, 'vnc_installed');
  const vncRunning = readHealthBool(values, 'vnc_running');
  const ros2Ready = readHealthBool(values, 'ros2_ready');
  const rosbridgeInstalled = readHealthBool(values, 'rosbridge_installed');
  const rosbridgeRunning = readHealthBool(values, 'rosbridge_running');
  const trosCount = readHealthInt(values, 'tros_count');
  const modelZooDir = readHealthBool(values, 'modelzoo_dir');
  const hrtReady = readHealthBool(values, 'hrt_ready');
  const bpuReady = readHealthBool(values, 'bpu_ready');

  const developmentMissing = [
    pythonReady ? '' : 'Python3',
    gitReady ? '' : 'Git',
    nodeReady ? '' : 'Node.js',
    npmReady ? '' : 'npm',
  ].filter(Boolean);
  const developmentReady = developmentMissing.length === 0;
  const development = buildWorkspaceModuleStatus(
    developmentReady,
    developmentReady,
    developmentReady ? 'Python / Git / Node / npm 已就绪' : `缺少 ${developmentMissing.join(' / ')}`,
    developmentReady ? '可以直接开始一句话开发' : '让 RDKClaw 先补齐缺失开发环境',
    developmentMissing,
  );

  const codeServer = buildWorkspaceModuleStatus(
    codeInstalled && codeRunning,
    codeInstalled,
    !codeInstalled ? '未安装 code-server' : codeRunning ? 'code-server 已安装并正在监听 13337 端口' : 'code-server 已安装，但当前未启动',
    !codeInstalled ? '前往 IDE 页安装 code-server' : codeRunning ? '打开 IDE 继续开发' : '前往 IDE 页启动 code-server',
    !codeInstalled ? ['code-server'] : [],
    codeRunning,
  );

  const vnc = buildWorkspaceModuleStatus(
    vncInstalled && vncRunning,
    vncInstalled,
    !vncInstalled ? '未检测到 VNC 组件' : vncRunning ? 'VNC 服务已运行，可直接连接桌面' : 'VNC 组件已安装，但当前未运行',
    !vncInstalled ? '前往 VNC 页尝试安装 / 启动服务' : vncRunning ? '打开远程桌面' : '前往 VNC 页启动桌面服务',
    !vncInstalled ? ['x11vnc / vncserver'] : [],
    vncRunning,
  );

  const ros = buildWorkspaceModuleStatus(
    ros2Ready,
    ros2Ready,
    !ros2Ready
      ? 'ROS2/TROS 未安装'
      : rosbridgeRunning
        ? 'TROS 与 rosbridge 均就绪'
        : rosbridgeInstalled
          ? 'TROS 已就绪，rosbridge 未运行'
          : trosCount > 0
            ? `TROS 已就绪（${trosCount} 个组件）`
            : 'ROS2 已就绪',
    !ros2Ready
      ? '安装 TROS: sudo apt install tros-humble-ros-base'
      : !rosbridgeRunning
        ? '前往 ROS 页可启动 rosbridge 进行可视化'
        : '打开 ROS 可视化',
    ros2Ready ? [] : ['ROS2/TROS'],
    rosbridgeRunning,
  );

  const nodeHubMissing = [
    ros2Ready ? '' : 'ROS2',
    trosCount > 0 ? '' : 'tros / hobot 生态包',
  ].filter(Boolean);
  const nodeHub = buildWorkspaceModuleStatus(
    ros2Ready && trosCount > 0,
    trosCount > 0,
    ros2Ready && trosCount > 0 ? `已检测到 ${trosCount} 个 tros / hobot 组件` : `缺少 ${nodeHubMissing.join(' / ')}`,
    ros2Ready && trosCount > 0 ? '打开 NodeHub 同步板端能力' : '先补齐 RDK 官方生态包，再同步 NodeHub',
    nodeHubMissing,
  );

  const modelZooMissing = [
    modelZooDir ? '' : 'ModelZoo 仓库目录',
    hrtReady ? '' : 'hrt_model_exec',
    bpuReady ? '' : 'BPU Python 运行时',
  ].filter(Boolean);
  const modelZoo = buildWorkspaceModuleStatus(
    modelZooDir && hrtReady && bpuReady,
    modelZooDir,
    modelZooDir && hrtReady && bpuReady ? 'ModelZoo 仓库与 BPU 运行时已就绪' : `缺少 ${modelZooMissing.join(' / ')}`,
    modelZooDir && hrtReady && bpuReady ? '打开 ModelZoo 管理模型' : '先补齐 ModelZoo 仓库与 BPU 运行环境',
    modelZooMissing,
  );

  const modules = {
    development,
    codeServer,
    vnc,
    ros,
    nodeHub,
    modelZoo,
  };
  const checkedAtSeconds = readHealthInt(values, 'checked_at');
  return {
    checkedAt: checkedAtSeconds > 0 ? checkedAtSeconds * 1000 : Date.now(),
    readyModules: Object.values(modules).filter((item) => item.ready).length,
    totalModules: Object.keys(modules).length,
    modules,
  };
}
