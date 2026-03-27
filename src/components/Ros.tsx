import { useState, useRef, useEffect, useCallback } from 'react';
import { useDeviceStore } from '../hooks/useDeviceStore';
import { useToastStore } from '../hooks/useToastStore';
import { executeDeviceCommand } from '../api';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';

/* ── ROS 可视化 — 内嵌 Webviz + 自动启动 rosbridge ── */
const WEBVIZ_BASE = 'https://webviz.io/app/';
const ROSBRIDGE_PORT = 9090;

type Phase = 'idle' | 'checking' | 'starting' | 'connecting' | 'connected' | 'error';

/** 板端 TROS setup.bash 路径（仅允许 /opt/tros 或 /opt/ros 下） */
function isAllowedTrosSetupPath(p: string): boolean {
  return /^\/opt\/(tros|ros)\/[a-zA-Z0-9._/-]+\/setup\.bash$/.test(p);
}

export type RosInstallInfo = {
  ros2: boolean;
  tros: boolean;
  rosbridge: boolean;
  /** 探测到的 setup.bash，用于写入 bashrc */
  setupFile: string;
  /** ~/.bashrc 中是否已有 TROS source */
  bashrcSourcesTros: boolean;
};

export default function Ros() {
  const { currentDevice } = useDeviceStore();
  const { addToast } = useToastStore();
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState('');
  const [showIframe, setShowIframe] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [rosbridgeUrl, setRosbridgeUrl] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** 最近一次环境检测结果，用于错误态下展示「写入 bashrc」等 */
  const lastInstallRef = useRef<RosInstallInfo | null>(null);

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogLines(prev => [...prev, `[${ts}] ${line}`]);
  };

  /* 构建带 rosbridge 连接的 Webviz URL */
  const buildWebvizUrl = useCallback((deviceIp: string) => {
    const wsUrl = `ws://${deviceIp}:${ROSBRIDGE_PORT}`;
    // Webviz 支持通过 URL 参数指定 rosbridge 数据源
    return `${WEBVIZ_BASE}?rosbridge-websocket-url=${encodeURIComponent(wsUrl)}`;
  }, []);

  /* 检查 rosbridge 是否在运行 */
  const checkRosbridge = useCallback(async (deviceId: string): Promise<boolean> => {
    try {
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc "
          if command -v ss >/dev/null 2>&1; then
            ss -lntp 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && echo ROSBRIDGE_ACTIVE || echo ROSBRIDGE_INACTIVE
          elif command -v netstat >/dev/null 2>&1; then
            netstat -lnt 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && echo ROSBRIDGE_ACTIVE || echo ROSBRIDGE_INACTIVE
          elif command -v lsof >/dev/null 2>&1; then
            lsof -iTCP:${ROSBRIDGE_PORT} -sTCP:LISTEN 2>/dev/null | grep -q LISTEN && echo ROSBRIDGE_ACTIVE || echo ROSBRIDGE_INACTIVE
          else
            pgrep -af 'rosbridge_websocket|rosbridge_server' >/dev/null 2>&1 && echo ROSBRIDGE_ACTIVE || echo ROSBRIDGE_INACTIVE
          fi
        "`
      );
      const output = result.output || '';
      appendLog(output.trim());
      return output.includes('ROSBRIDGE_ACTIVE');
    } catch {
      return false;
    }
  }, []);

  /* 启动 rosbridge_websocket */
  const startRosbridge = useCallback(async (deviceId: string): Promise<boolean> => {
    try {
      // 尝试多种方式启动 rosbridge
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc "
          probe_port() {
            if command -v ss >/dev/null 2>&1; then ss -lntp 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && return 0; fi
            if command -v netstat >/dev/null 2>&1; then netstat -lnt 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && return 0; fi
            if command -v lsof >/dev/null 2>&1; then lsof -iTCP:${ROSBRIDGE_PORT} -sTCP:LISTEN 2>/dev/null | grep -q LISTEN && return 0; fi
            return 1
          }
          for sf in /opt/tros/*/setup.bash /opt/ros/*/setup.bash; do [ -f "\$sf" ] && . "\$sf" 2>/dev/null; done
          # 尝试 ROS2 方式启动
          if command -v ros2 &>/dev/null; then
            nohup ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=${ROSBRIDGE_PORT} &>/tmp/rosbridge.log &
            sleep 3
          # 尝试 ROS1 方式启动
          elif command -v roslaunch &>/dev/null; then
            for sf in /opt/tros/*/setup.bash /opt/ros/*/setup.bash; do [ -f "\$sf" ] && . "\$sf" 2>/dev/null; done
            nohup roslaunch rosbridge_server rosbridge_websocket.launch port:=${ROSBRIDGE_PORT} &>/tmp/rosbridge.log &
            sleep 3
          fi
          # 检查是否启动成功
          probe_port && echo ROSBRIDGE_STARTED || echo ROSBRIDGE_FAILED
        "`
      );
      const output = result.output || '';
      output.split(/\r?\n/).filter(Boolean).forEach(l => appendLog(l));
      return output.includes('ROSBRIDGE_STARTED');
    } catch (err) {
      appendLog(tf('ros.log.startFail', '启动失败: {{msg}}', { msg: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  }, [t]);

  /* 安装 rosbridge_server（ROS2） */
  const installRosbridge = useCallback(async (deviceId: string): Promise<boolean> => {
    try {
      appendLog(t('ros.log.installStart', '开始安装 rosbridge_server...'));
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc "
          for sf in /opt/tros/*/setup.bash /opt/ros/*/setup.bash; do [ -f "\$sf" ] && . "\$sf" 2>/dev/null; done
          ROS_DISTRO=\$(printenv ROS_DISTRO 2>/dev/null || ls /opt/ros/ 2>/dev/null | head -1 || ls /opt/tros/ 2>/dev/null | head -1 || echo humble)
          echo INSTALLING_FOR_DISTRO=\$ROS_DISTRO
          if [ \"\$(id -u)\" = \"0\" ]; then
            SUDO=''
          elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
            SUDO='sudo -n'
          else
            SUDO=''
            echo NEED_SUDO_PRIVILEGE
          fi
          if [ -n \"\$SUDO\" ] || [ \"\$(id -u)\" = \"0\" ]; then
            i=0
            while fuser /var/lib/dpkg/lock >/dev/null 2>&1 || fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
              i=\$((i+1))
              [ \$i -gt 60 ] && break
              echo WAITING_APT_LOCK_\$i
              sleep 2
            done
            \${SUDO} apt-get update -qq 2>/dev/null || true
          fi
          if [ -n \"\$SUDO\" ] || [ \"\$(id -u)\" = \"0\" ]; then
            if \${SUDO} apt-get install -y -qq ros-\$ROS_DISTRO-rosbridge-server 2>/dev/null; then
              echo ROSBRIDGE_INSTALL_OK
            else
              echo ROSBRIDGE_APT_INSTALL_FAILED
            fi
          elif python3 -m pip install --user rosbridge-suite 2>/dev/null; then
            echo ROSBRIDGE_INSTALL_OK
          else
            echo ROSBRIDGE_INSTALL_FAILED
          fi
        "`
      );
      const output = result.output || '';
      output.split(/\r?\n/).filter(Boolean).forEach(l => appendLog(l));
      if (output.includes('NEED_SUDO_PRIVILEGE')) {
        appendLog(t('ros.log.sudoHint', '当前用户无免密 sudo，apt 安装可能失败，请在设备端授权 sudo 或改用 root 用户。'));
      }
      return output.includes('ROSBRIDGE_INSTALL_OK');
    } catch (err) {
      appendLog(tf('ros.log.installFail', '安装失败: {{msg}}', { msg: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  }, [t]);

  /**
   * 检查 ROS2/TROS 与 rosbridge。
   * RDK 官方环境为 TROS（兼容 ros2 CLI），不能用「未装标准 ROS」简单判断；
   * 用循环 source 替代 `source /opt/tros/*`（多发行版并存时 glob 行为不稳定）。
   */
  const checkInstallation = useCallback(async (deviceId: string): Promise<RosInstallInfo> => {
    const empty: RosInstallInfo = {
      ros2: false,
      tros: false,
      rosbridge: false,
      setupFile: '',
      bashrcSourcesTros: false,
    };
    try {
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc 'ros2_ok=0; tros_ok=0; setup_file=""; bashrc_flag=0;
for f in /opt/tros/*/setup.bash /opt/ros/*/setup.bash; do [ -f "\$f" ] || continue; . "\$f" 2>/dev/null || true; if command -v ros2 >/dev/null 2>&1; then ros2_ok=1; [ -z "\$setup_file" ] && setup_file="\$f"; break; fi; done;
if [ "\$ros2_ok" != 1 ]; then while IFS= read -r f; do [ -f "\$f" ] || continue; . "\$f" 2>/dev/null || true; if command -v ros2 >/dev/null 2>&1; then ros2_ok=1; [ -z "\$setup_file" ] && setup_file="\$f"; break; fi; done < <(find /opt/tros /opt/ros -maxdepth 6 -name setup.bash 2>/dev/null | head -16); fi;
if [ "\$ros2_ok" != 1 ]; then for r in /opt/tros/*/bin/ros2 /opt/ros/*/bin/ros2; do [ -x "\$r" ] && ros2_ok=1 && break; done; fi;
[ -d /opt/tros ] && tros_ok=1;
dpkg -l 2>/dev/null | grep -qE "^ii[[:space:]]+tros-" && tros_ok=1;
for f in /opt/tros/*/setup.bash; do [ -f "\$f" ] && { tros_ok=1; break; }; done;
[ -z "\$setup_file" ] && setup_file=\$(find /opt/tros -maxdepth 6 -name setup.bash 2>/dev/null | head -1);
[ -n "\${HOME:-}" ] && [ -f "\$HOME/.bashrc" ] && grep -qE "(tros|/opt/tros).*setup\\.bash" "\$HOME/.bashrc" 2>/dev/null && bashrc_flag=1;
[ "\$ros2_ok" = 1 ] && echo ROS2_OK || echo ROS2_MISSING;
[ "\$tros_ok" = 1 ] && echo TROS_OK || echo TROS_MISSING;
[ -n "\$setup_file" ] && echo "SETUP_FILE=\$setup_file" || echo "SETUP_FILE=";
echo "BASHRC_TROS=\$bashrc_flag";
dpkg -l 2>/dev/null | grep -qi rosbridge && echo ROSBRIDGE_PKG_OK || (pip3 list 2>/dev/null | grep -qi rosbridge && echo ROSBRIDGE_PKG_OK || echo ROSBRIDGE_PKG_MISSING)'`
      );
      const out = result.output || '';
      let setupFile = '';
      const setupLine = out.split(/\r?\n/).find(l => l.startsWith('SETUP_FILE='));
      if (setupLine) setupFile = setupLine.slice('SETUP_FILE='.length).trim();
      const bashrcLine = out.split(/\r?\n/).find(l => l.startsWith('BASHRC_TROS='));
      const bashrcSourcesTros = bashrcLine?.includes('BASHRC_TROS=1') ?? false;
      return {
        ros2: out.includes('ROS2_OK'),
        tros: out.includes('TROS_OK'),
        rosbridge: out.includes('ROSBRIDGE_PKG_OK'),
        setupFile,
        bashrcSourcesTros,
      };
    } catch {
      return empty;
    }
  }, []);

  /** 将 TROS source 块追加到设备 ~/.bashrc（便于 SSH 交互终端中直接使用 ros2） */
  const appendTrosToBashrc = useCallback(async (deviceId: string, setupPath: string): Promise<boolean> => {
    if (!isAllowedTrosSetupPath(setupPath)) {
      appendLog(t('ros.log.bashrcBadPath', '拒绝：setup 路径不在允许范围内'));
      return false;
    }
    const markBegin = '# >>> RDK Studio TROS';
    const block = `\n${markBegin}\n[ -f ${JSON.stringify(setupPath)} ] && . ${JSON.stringify(setupPath)}\n# <<< RDK Studio TROS\n`;
    const b64 = btoa(block);
    try {
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc 'f="$HOME/.bashrc"; touch "$f"; grep -qF ${JSON.stringify(markBegin)} "$f" 2>/dev/null && echo BASHRC_ALREADY || { echo ${JSON.stringify(b64)} | base64 -d >> "$f"; echo BASHRC_OK; }'`
      );
      const o = result.output || '';
      if (o.includes('BASHRC_ALREADY')) {
        appendLog(t('ros.log.bashrcExists', '~/.bashrc 中已有 RDK Studio 追加的 TROS 块'));
        return true;
      }
      if (o.includes('BASHRC_OK')) {
        appendLog(t('ros.log.bashrcOk', '已写入 ~/.bashrc，重新登录 SSH 或执行 source ~/.bashrc 后可在终端使用 ros2'));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [appendLog, t]);

  /* 完整连接流程：检查安装 → 安装 → 启动 → 连接 Webviz */
  const handleConnect = useCallback(async () => {
    if (!currentDevice) {
      addToast(t('ros.toast.connectDevice', '请先连接设备'), 'warning');
      return;
    }

    setLogLines([]);
    setPhase('checking');
    setStatusText(t('ros.phase.checkRos', '检查 ROS 环境...'));
    appendLog(t('ros.log.checkStart', '开始检查 ROS 环境...'));

    const install = await checkInstallation(currentDevice.id);
    lastInstallRef.current = install;

    const rosLabel = install.tros ? t('ros.tros', 'TROS') : t('ros.ros2', 'ROS2');
    const rosState = install.ros2 ? rosLabel : t('ros.detect.noRos', '未安装 ROS2/TROS');
    appendLog(tf('ros.log.detected', '检测到: {{ros}}, rosbridge: {{rb}}', {
      ros: rosState,
      rb: install.rosbridge ? t('ros.rb.installed', '已安装') : t('ros.rb.notInstalled', '未安装'),
    }));

    if (!install.ros2 && install.tros) {
      setPhase('error');
      setStatusText(t('ros.err.trosNoRos2', '已检测到 TROS 目录或相关包，但未能加载 ros2。请检查 /opt/tros 下安装是否完整，或在终端执行: source /opt/tros/<发行版>/setup.bash'));
      appendLog(t('ros.log.trosNoRos2', 'TROS 已探测到，但 source 后仍无 ros2 命令'));
      addToast(t('ros.toast.trosNoRos2', 'TROS 环境异常，无法启动 rosbridge'), 'warning');
      return;
    }

    if (!install.ros2 && !install.tros) {
      setPhase('error');
      setStatusText(t('ros.err.noRos', '未检测到 ROS2/TROS（相关包未安装或路径异常）。RDK 官方镜像通常使用 TROS（兼容 ros2 CLI，并非未装「标准 ROS」）；可尝试: sudo apt install tros-humble-ros-base（以镜像文档为准）。'));
      appendLog(t('ros.log.noRos', '未检测到 ROS2/TROS'));
      appendLog(t('ros.log.rdkTrosHint', '说明：板端多为 TROS，若已刷官方镜像仍提示未安装，请在设备上确认 /opt/tros 是否存在、dpkg 是否含 tros- 包。'));
      addToast(t('ros.toast.noRos', '设备未检测到 ROS2/TROS'), 'warning');
      return;
    }

    if (!install.rosbridge) {
      setPhase('starting');
      setStatusText(t('ros.phase.installRb', 'rosbridge_server 未安装，正在自动安装...'));
      appendLog(t('ros.log.rbMissing', 'rosbridge 未安装，开始自动安装...'));
      addToast(t('ros.toast.installingRb', '正在为设备安装 rosbridge_server...'), 'info');

      const installOk = await installRosbridge(currentDevice.id);
      if (!installOk) {
        setPhase('error');
        setStatusText(t('ros.err.rbInstall', 'rosbridge 自动安装失败，请手动安装: sudo apt install ros-<distro>-rosbridge-server（将 <distro> 替换为你的 ROS 发行版名）'));
        appendLog(t('ros.log.autoInstallFail', '自动安装失败'));
        addToast(t('ros.toast.rbInstallFail', 'rosbridge 自动安装失败'), 'error');
        return;
      }
      appendLog(t('ros.log.rbOk', 'rosbridge 安装成功'));
      addToast(t('ros.toast.rbOk', 'rosbridge_server 安装成功'), 'success');
    }

    setStatusText(t('ros.phase.checkRb', '检查 rosbridge 服务状态...'));
    appendLog(t('ros.log.checkRb', '检查 rosbridge 是否运行中...'));

    let active = await checkRosbridge(currentDevice.id);

    if (!active) {
      setPhase('starting');
      setStatusText(t('ros.phase.startRb', '正在启动 rosbridge_websocket...'));
      appendLog(t('ros.log.rbDown', 'rosbridge 未运行，尝试启动...'));
      addToast(t('ros.toast.startingRb', '正在启动 rosbridge_websocket...'), 'info');

      active = await startRosbridge(currentDevice.id);

      if (!active) {
        setPhase('error');
        setStatusText(t('ros.err.rbStart', 'rosbridge 启动失败，请检查设备 ROS 环境配置'));
        addToast(t('ros.toast.rbStartFail', 'rosbridge 启动失败'), 'warning');
        appendLog(t('ros.log.rbStartFail', 'rosbridge 启动失败'));
        return;
      }
    }

    setPhase('connecting');
    setStatusText(t('ros.phase.loadWebviz', 'rosbridge 就绪，正在加载 Webviz...'));
    appendLog(tf('ros.log.rbUp', 'rosbridge 运行中 (端口 {{port}})', { port: ROSBRIDGE_PORT }));
    addToast(t('ros.toast.rbReady', 'rosbridge 已就绪，正在连接 Webviz'), 'success');

    const url = buildWebvizUrl(currentDevice.ip);
    setRosbridgeUrl(url);
    setIframeLoading(true);
    setShowIframe(true);
  }, [currentDevice, addToast, checkRosbridge, startRosbridge, buildWebvizUrl, checkInstallation, installRosbridge, t, tf]);

  const handleAppendTrosBashrc = useCallback(async () => {
    const device = currentDevice;
    const setup = lastInstallRef.current?.setupFile;
    if (!device || !setup) return;
    setPhase('checking');
    setStatusText(t('ros.phase.writeBashrc', '正在写入 ~/.bashrc...'));
    const ok = await appendTrosToBashrc(device.id, setup);
    if (ok) addToast(t('ros.toast.bashrcOk', '已写入 ~/.bashrc'), 'success');
    else addToast(t('ros.toast.bashrcFail', '写入失败，请在设备上手动编辑 ~/.bashrc'), 'error');
    setPhase('idle');
    setStatusText('');
  }, [appendTrosToBashrc, currentDevice, addToast, t]);

  /* 断开连接 */
  const handleDisconnect = () => {
    setShowIframe(false);
    setIframeLoading(false);
    setPhase('idle');
    setRosbridgeUrl('');
  };

  /* 停止 rosbridge */
  const handleStopRosbridge = async () => {
    if (!currentDevice) return;
    appendLog(t('ros.log.stopRb', '正在停止 rosbridge...'));
    try {
      await executeDeviceCommand(
        currentDevice.id,
        `bash -lc "pkill -f rosbridge_websocket || pkill -f rosbridge_server || true; sleep 1; ss -lntp 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && echo STILL_RUNNING || echo STOPPED"`
      );
      appendLog(t('ros.log.stopped', 'rosbridge 已停止'));
      addToast(t('ros.toast.stopped', 'rosbridge 已停止'), 'info');
    } catch {
      appendLog(t('ros.log.stopFail', '停止 rosbridge 失败'));
    }
    handleDisconnect();
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setPhase('connected');
    appendLog(t('ros.log.webvizLoaded', 'Webviz 加载完成'));
  };

  const handleReload = () => {
    if (iframeRef.current && rosbridgeUrl) {
      setIframeLoading(true);
      iframeRef.current.src = rosbridgeUrl;
      appendLog(t('ros.log.reload', '刷新 Webviz...'));
    }
  };

  /* 全屏切换 */
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* 设备切换时断开 */
  useEffect(() => {
    handleDisconnect();
    lastInstallRef.current = null;
  }, [currentDevice?.id]);

  return (
    <div className="immersive" ref={containerRef}>
      {/* ── 顶部工具栏 ── */}
      <div className="immersive-bar">
        <div className="immersive-bar-left">
          
          <span className="immersive-bar-title">{t('ros.title', 'ROS 可视化')}</span>
          <span className="badge badge-muted">Webviz</span>
          {currentDevice && (
            <span className="immersive-bar-meta">{currentDevice.name} · {currentDevice.ip}</span>
          )}
        </div>

        <div className="immersive-bar-center">
          {showIframe && (
            <span className="immersive-bar-status">
              <span className={`status-dot ${phase === 'connected' ? 'online' : ''}`} />
              {phase === 'connected' ? t('ros.status.connected', '已连接') : phase === 'connecting' ? t('ros.status.connecting', '连接中') : t('ros.status.disconnected', '未连接')}
            </span>
          )}
        </div>

        <div className="immersive-bar-right">
          {showIframe && (
            <>
              <button className="btn-icon" onClick={handleReload} title={t('ros.title.refresh', '刷新')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>

              <button className="btn-icon" onClick={() => window.open(rosbridgeUrl, '_blank')} title={t('ros.title.openNew', '新窗口打开')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>

              <button className="btn-icon" onClick={toggleFullscreen} title={t('ros.title.fullscreen', '全屏 (F11)')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isFullscreen ? (
                    <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
                  ) : (
                    <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                  )}
                </svg>
              </button>

              <button className="btn-icon" onClick={() => setShowLogs(!showLogs)} title={t('ros.title.logs', '日志')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>

              <div className="immersive-bar-sep" />

              <button className="btn btn-danger btn-sm" onClick={handleStopRosbridge}>
                {t('ros.stopDisconnect', '停止并断开')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 主视口 ── */}
      <div className="immersive-viewport">
        {showIframe ? (
          <>
            {iframeLoading && (
              <div className="immersive-loading">
                <div className="spinner" />
                <span className="immersive-loading-text">{t('ros.loadingWebviz', '正在加载 Webviz...')}</span>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={rosbridgeUrl}
              title="Webviz ROS Visualization"
              onLoad={handleIframeLoad}
              allow="clipboard-read; clipboard-write; fullscreen"
            />
            {/* 日志抽屉 */}
            {showLogs && (
              <div className="immersive-logs">
                <div className="immersive-logs-head">
                  <span>{t('ros.connLogs', '连接日志')}</span>
                  <button className="btn-icon" onClick={() => setShowLogs(false)}>×</button>
                </div>
                <div className="immersive-logs-body">
                  {logLines.map((line, i) => (
                    <div key={i} className="ros-log-line">{line}</div>
                  ))}
                  {logLines.length === 0 && (
                    <div className="ros-log-line" style={{ color: '#555' }}>{t('ros.log.waiting', '等待输出...')}</div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── 欢迎/连接界面 ── */
          <div className="immersive-welcome">
            <div className="ros-welcome-visual">
              <div className="immersive-welcome-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="12" cy="4" r="1.5" /><circle cx="20" cy="12" r="1.5" />
                  <circle cx="12" cy="20" r="1.5" /><circle cx="4" cy="12" r="1.5" />
                  <line x1="12" y1="7" x2="12" y2="9" /><line x1="15" y1="12" x2="17" y2="12" />
                  <line x1="12" y1="15" x2="12" y2="17" /><line x1="7" y1="12" x2="9" y2="12" />
                </svg>
              </div>
              <div className="ros-welcome-glow" />
            </div>

            <h2 className="immersive-welcome-title">{t('ros.welcome.title', 'ROS 可视化工作台')}</h2>
            <p className="immersive-welcome-desc">
              {t('ros.welcome.desc', '自动启动 rosbridge_websocket 并通过 Webviz 实时可视化 ROS 话题、TF、点云等数据')}
            </p>
            <p className="immersive-welcome-desc ros-tros-note">
              {t('ros.welcome.trosNote', 'RDK 板卡默认使用 TROS（与 ROS2 工具链兼容）。若仅因终端未 source 而提示找不到 ros2，可在检测后选择将环境写入 ~/.bashrc。')}
            </p>

            {phase === 'checking' && (
              <div className="immersive-loading">
                <div className="spinner" />
                <span className="immersive-loading-text">{statusText}</span>
              </div>
            )}

            {phase === 'starting' && (
              <div className="immersive-loading">
                <div className="spinner" />
                <span className="immersive-loading-text">{statusText}</span>
              </div>
            )}

            {phase === 'error' && (
              <div className="immersive-error">
                <span>⚠️ {statusText}</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={handleConnect}>{t('ros.retry', '重试')}</button>
                  {lastInstallRef.current?.setupFile && !lastInstallRef.current.bashrcSourcesTros
                    && !lastInstallRef.current.ros2 && lastInstallRef.current.tros && (
                    <button type="button" className="btn btn-ghost" onClick={handleAppendTrosBashrc}>
                      {t('ros.appendBashrc', '将 TROS 写入 ~/.bashrc')}
                    </button>
                  )}
                  {statusText.includes(t('ros.marker.notInstalled', '未安装')) && (
                    <button className="btn btn-ghost" onClick={() => {
                      if (currentDevice) {
                        setPhase('starting');
                        setStatusText(t('ros.phase.installingRbShort', '正在安装 rosbridge...'));
                        installRosbridge(currentDevice.id).then(ok => {
                          if (ok) { addToast(t('ros.toast.installOkRetry', '安装成功，请点击重试'), 'success'); setPhase('idle'); }
                          else { setPhase('error'); setStatusText(t('ros.err.manualInstall', '安装失败，请手动安装')); }
                        });
                      }
                    }}>
                      {t('ros.installRosbridge', '一键安装 rosbridge')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {(phase === 'idle' || phase === 'error') && (
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={!currentDevice}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {t('ros.connect', '启动 rosbridge 并连接')}
              </button>
            )}

            {!currentDevice && (
              <p className="ros-no-device">{t('ros.pickDeviceLeft', '请先在左侧选择一个设备')}</p>
            )}

            <div className="ros-welcome-hints">
              <div className="ros-hint-item">
                <kbd>F11</kbd>
                <span>{t('ros.hint.fullscreen', '全屏模式')}</span>
              </div>
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>{t('ros.hint.autoStart', '自动启动 rosbridge')}</span>
              </div>
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>{t('ros.hint.ros12', '支持 ROS1 / ROS2')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
