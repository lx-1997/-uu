import { useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword, runOpenClawAgentAction } from '../api';

interface ModelPreset {
  id: string;
  provider: string;
  name: string;
}

interface EcosystemSnapshot {
  nodehub?: { installed?: string[]; running?: string[]; deviceIp?: string; updatedAt?: string };
  modelzoo?: { deployed?: string[]; running?: string[]; deviceIp?: string; updatedAt?: string };
  updatedAt?: string;
}

const MODEL_PRESETS: ModelPreset[] = [
  { id: 'qwen35', provider: 'Dashscope', name: 'qwen3.5-plus' },
  { id: 'qwenplus', provider: 'Dashscope', name: 'qwen-plus' },
  { id: 'gpt4o', provider: 'OpenAI', name: 'gpt-4o' },
  { id: 'deepseek', provider: 'DeepSeek', name: 'deepseek-chat' },
];

export default function OpenClaw() {
  const { currentDevice, addToast, setActiveTab, setChatExpanded, setCmd } = useAppState();

  const [activeModelName, setActiveModelName] = useState('qwen3.5-plus');
  const [serviceRunning, setServiceRunning] = useState(false);
  const [openClawInstalled, setOpenClawInstalled] = useState(false);
  const [portListening, setPortListening] = useState(false);
  const [gatewayReachable, setGatewayReachable] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState('--');

  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [ecosystem, setEcosystem] = useState<EcosystemSnapshot>({});

  const gatewayUrl = currentDevice ? `http://${currentDevice.ip}:18789` : '';
  const nodehubSyncedForCurrentDevice = !currentDevice || !ecosystem.nodehub?.deviceIp || ecosystem.nodehub.deviceIp === currentDevice.ip;
  const modelzooSyncedForCurrentDevice = !currentDevice || !ecosystem.modelzoo?.deviceIp || ecosystem.modelzoo.deviceIp === currentDevice.ip;

  const pushLog = (title: string, output: string) => {
    setStatusLog((prev) => [...prev.slice(-80), `[${title}] ${new Date().toLocaleTimeString()}`, output || '[无输出]', '']);
  };

  const readEcosystemSnapshot = () => {
    try {
      const raw = localStorage.getItem('rdk-ecosystem-sync');
      if (!raw) return;
      const parsed = JSON.parse(raw) as EcosystemSnapshot;
      setEcosystem(parsed);
    } catch {
      setEcosystem({});
    }
  };

  const pushToMainChat = (text: string, autoSubmit = true) => {
    setActiveTab('dashboard');
    setChatExpanded(true);
    setCmd(text);
    if (!autoSubmit) {
      addToast('命令已填入主聊天框，按回车即可执行', 'info');
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const form = document.querySelector('.input-box') as HTMLFormElement | null;
        form?.requestSubmit();
      });
    });
  };

  const parseStatusOutput = (output: string) => {
    const installed = !/(command not found|openclaw-unavailable|clawctl: not found|not installed)/i.test(output);
    const running = /(active|running|gateway start|openclaw.*start|clawctl.*start|port.*18789)/i.test(output);
    const modelMatch = output.match(/(?:active\s*model|model)\s*[:=]\s*([\w.-]+)/i);
    return {
      installed,
      running,
      model: modelMatch?.[1] ?? activeModelName,
    };
  };

  const probeGateway = async () => {
    if (!currentDevice) return;
    const pwd = getRememberedDevicePassword(currentDevice.id);
    const result = await executeDeviceCommand(
      currentDevice.id,
      'bash -lc "(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E \":18789\\b\" || echo port-18789-closed; (curl -fsS --max-time 2 http://127.0.0.1:18789/health || curl -fsS --max-time 2 http://127.0.0.1:18789/ || echo gateway-http-unreachable) 2>&1"',
      pwd,
    );
    const output = result.output || '';
    pushLog('网关探测', output);
    setPortListening(/:18789\b/.test(output) && !/port-18789-closed/i.test(output));
    setGatewayReachable(!/gateway-http-unreachable|connection refused|timed out|failed|could not|not resolve/i.test(output));
  };

  const handleCheckStatus = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setChecking(true);
    try {
      const result = await runOpenClawAgentAction('status', {
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      pushLog('状态检查', output);
      const parsed = parseStatusOutput(output);
      setOpenClawInstalled(parsed.installed);
      setServiceRunning(parsed.running);
      setActiveModelName(parsed.model);
      await probeGateway();
      setLastCheckedAt(new Date().toLocaleTimeString());
      addToast(parsed.running ? 'OpenClaw 服务运行中' : 'OpenClaw 服务未启动', parsed.running ? 'success' : 'info');
    } catch {
      addToast('状态检查失败，请确认设备连接', 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setInstalling(true);
    addToast('正在安装 OpenClaw，请稍候...', 'info');
    try {
      const result = await runOpenClawAgentAction('install', {
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      pushLog('安装', output);
      setShowLog(true);
      setOpenClawInstalled(true);
      addToast('OpenClaw 安装完成', 'success');
      await handleCheckStatus();
    } catch {
      addToast('安装失败，请检查网络连接', 'error');
    } finally {
      setInstalling(false);
    }
  };

  const toggleService = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }

    setChecking(true);
    try {
      if (serviceRunning) {
        const pwd = getRememberedDevicePassword(currentDevice.id);
        const result = await executeDeviceCommand(
          currentDevice.id,
          'bash -lc "(openclaw stop || clawctl stop || pkill -f openclaw || true)"',
          pwd,
        );
        pushLog('停止', result.output);
        setServiceRunning(false);
        setPortListening(false);
        setGatewayReachable(false);
        addToast('OpenClaw 服务已停止', 'info');
      } else {
        const result = await runOpenClawAgentAction('start', {
          host: currentDevice.ip,
          username: 'root',
        });
        const output = (result as { output?: string }).output ?? '';
        pushLog('启动', output);
        setShowLog(true);
        const running = /(active|running|start|port.*18789)/i.test(output);
        setServiceRunning(running);
        addToast(running ? 'OpenClaw 服务已启动' : '启动命令已发送，请检查日志', running ? 'success' : 'warning');
        await probeGateway();
      }
      setLastCheckedAt(new Date().toLocaleTimeString());
    } catch {
      addToast(serviceRunning ? '停止失败' : '启动失败，请先安装 OpenClaw', 'error');
    } finally {
      setChecking(false);
    }
  };

  const switchModel = async (id: string) => {
    const target = MODEL_PRESETS.find((item) => item.id === id);
    if (!target) return;

    setActiveModelName(target.name);
    if (!currentDevice || !serviceRunning) {
      addToast(`已选择模型 ${target.name}，服务启动后会执行切换`, 'info');
      return;
    }

    try {
      const result = await runOpenClawAgentAction('switch', {
        modelName: target.name,
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      pushLog('模型切换', output || `model=${target.name}`);
      setLastCheckedAt(new Date().toLocaleTimeString());
      addToast(`已切换到 ${target.name}`, 'success');
    } catch {
      addToast(`模型切换失败：${target.name}`, 'warning');
    }
  };

  const handleUninstall = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    if (!confirm('确定要卸载 OpenClaw 吗？')) return;

    setUninstalling(true);
    addToast('正在卸载 OpenClaw...', 'info');
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      await executeDeviceCommand(currentDevice.id, 'bash -lc "(openclaw stop || clawctl stop || pkill -f openclaw || true) 2>&1"', pwd);
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "(pip3 uninstall -y openclaw 2>&1 || apt remove -y openclaw 2>&1 || rm -rf /opt/openclaw 2>&1) && echo UNINSTALL_OK"',
        pwd,
      );
      pushLog('卸载', result.output);
      setShowLog(true);
      setOpenClawInstalled(false);
      setServiceRunning(false);
      setPortListening(false);
      setGatewayReachable(false);
      setLastCheckedAt(new Date().toLocaleTimeString());
      addToast('OpenClaw 已卸载', 'success');
    } catch {
      addToast('卸载失败', 'error');
    } finally {
      setUninstalling(false);
    }
  };

  const handleViewLogs = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setChecking(true);
    try {
      const result = await runOpenClawAgentAction('logs', {
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      pushLog('日志', output);
      setShowLog(true);
    } catch {
      addToast('获取日志失败', 'error');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (currentDevice) {
      handleCheckStatus();
      readEcosystemSnapshot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'rdk-ecosystem-sync') {
        readEcosystemSnapshot();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="oc-install-hero">
          <span style={{ fontSize: '4rem' }} className="oc-crayfish-idle">🦞</span>
          <div>
            <h1 className="oc-hero-title">OpenClaw</h1>
            <p className="oc-hero-sub">大模型网关与 AI Agent 编排平台<br />连接设备后即可开始配置</p>
          </div>
        </div>
        <div className="isolated-widget" style={{ marginTop: 24 }}>
          <div className="widget-header">快速开始</div>
          <p className="desc-text">OpenClaw 是地瓜机器人的 AI 网关，连接设备后即可执行安装、启动、切换模型与日志诊断。</p>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>在左侧添加并连接 RDK 开发板</div>
            <div className="oc-step"><span className="oc-step-n">2</span>点击安装/更新部署 OpenClaw</div>
            <div className="oc-step"><span className="oc-step-n">3</span>启动服务并探测 18789 网关</div>
            <div className="oc-step"><span className="oc-step-n">4</span>使用主聊天框执行诊断并获取反馈</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center-stage wide-stage">
      <div className={`oc-bar ${serviceRunning ? 'live' : ''}`}>
        <div className="oc-bar-left">
          <span style={{ fontSize: '1.4rem' }}>🦞</span>
          <span className="oc-bar-name">OpenClaw</span>
          <span className="oc-bar-ver">v2.1</span>
          <span className={`oc-bar-badge ${serviceRunning ? 'on' : ''}`}>
            <span className="oc-live-dot" />
            {serviceRunning ? '运行中' : '未启动'}
          </span>
        </div>
        <div className="oc-bar-right">
          <span className="oc-bar-stat"><b>{openClawInstalled ? '已安装' : '未安装'}</b></span>
          <span className="oc-bar-stat"><b>{lastCheckedAt}</b></span>
          <button className="oc-bar-btn" onClick={handleInstall} disabled={installing}>{installing ? '安装中...' : '安装/更新'}</button>
          <button className="oc-bar-btn" onClick={handleCheckStatus} disabled={checking}>{checking ? '检测中...' : '刷新状态'}</button>
          <button className={`oc-bar-btn ${serviceRunning ? '' : 'primary'}`} onClick={toggleService} disabled={checking}>{serviceRunning ? '停止服务' : '启动服务'}</button>
          <button className="oc-bar-btn" onClick={handleUninstall} disabled={uninstalling}>{uninstalling ? '卸载中...' : '卸载'}</button>
        </div>
      </div>

      <div className="isolated-widget" style={{ marginTop: 16 }}>
        <div className="oc-config-bar">
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">当前模型</span>
            <span className="oc-cfg-val mono">{activeModelName}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">网关地址</span>
            <span className="oc-cfg-val mono">{gatewayUrl}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">设备</span>
            <span className="oc-cfg-val ok">{currentDevice.ip}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">端口监听</span>
            <span className={`oc-cfg-val ${portListening ? 'ok' : 'dim'}`}>{portListening ? '18789 Open' : '18789 Closed'}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">HTTP 连通</span>
            <span className={`oc-cfg-val ${gatewayReachable ? 'ok' : 'dim'}`}>{gatewayReachable ? 'Reachable' : 'Unreachable'}</span>
          </div>
        </div>
      </div>

      <div className="workspace-grid three-column" style={{ marginTop: 16 }}>
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>🛠️ 核心动作</span>
            <span className="oc-sec-count">真实执行</span>
          </div>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>安装 / 更新 OpenClaw</div>
            <div className="oc-step"><span className="oc-step-n">2</span>启动服务并监听 18789 端口</div>
            <div className="oc-step"><span className="oc-step-n">3</span>切换模型并回看日志结果</div>
          </div>
          <div className="oc-tools-grid" style={{ marginTop: 14 }}>
            <button className="oc-tl" onClick={handleInstall}>安装更新</button>
            <button className="oc-tl" onClick={toggleService}>{serviceRunning ? '停止服务' : '启动服务'}</button>
            <button className="oc-tl" onClick={handleCheckStatus}>刷新状态</button>
            <button className="oc-tl" onClick={handleViewLogs}>读取日志</button>
            <button className="oc-tl" onClick={() => pushToMainChat('启动 OpenClaw 服务')}>主聊天启动</button>
            <button className="oc-tl" onClick={() => pushToMainChat('检查 OpenClaw 当前状态')}>主聊天诊断</button>
          </div>
        </div>

        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>🤖 模型切换</span>
            <span className="oc-sec-count">{activeModelName}</span>
          </div>
          <div className="oc-model-list">
            {MODEL_PRESETS.map((model) => (
              <div key={model.id} className={`oc-model-row ${model.name === activeModelName ? 'active' : ''}`}>
                <button className="oc-model-info" onClick={() => switchModel(model.id)}>
                  <span className="oc-model-prov">{model.provider}</span>
                  <span className="oc-model-name">{model.name}</span>
                </button>
                <div className="oc-model-actions">
                  {model.name === activeModelName && <span className="oc-model-active-tag">当前</span>}
                  <button className="oc-model-test" onClick={() => pushToMainChat(`切换 OpenClaw 模型到 ${model.name}`)}>聊天切换</button>
                </div>
              </div>
            ))}
          </div>
          <div className="oc-hint" style={{ paddingTop: 10, borderTop: 'none' }}>
            页面操作直接执行板端动作；聊天操作会在主聊天框展示完整反馈。
          </div>
        </div>

        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>🌐 网关探测</span>
            <span className="oc-sec-count">18789</span>
          </div>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>网关地址：<b>{gatewayUrl}</b></div>
            <div className="oc-step"><span className="oc-step-n">2</span>端口状态：<b>{portListening ? '监听中' : '未监听'}</b></div>
            <div className="oc-step"><span className="oc-step-n">3</span>HTTP 状态：<b>{gatewayReachable ? '可访问' : '不可访问'}</b></div>
          </div>
          <div className="oc-tools-grid" style={{ marginTop: 14 }}>
            <button className="oc-tl" onClick={probeGateway}>连通探测</button>
            <button className="oc-tl" onClick={() => window.open(gatewayUrl, '_blank', 'noopener,noreferrer')}>打开网关</button>
            <button className="oc-tl" onClick={() => pushToMainChat('检查 OpenClaw 网关 18789 端口与 HTTP 可用性')}>聊天探测</button>
            <button className="oc-tl" onClick={() => pushToMainChat('读取 OpenClaw 最近日志并给出修复建议')}>聊天日志分析</button>
            <button
              className="oc-tl"
              onClick={() => navigator.clipboard.writeText(gatewayUrl)
                .then(() => addToast('网关地址已复制', 'success'))
                .catch(() => addToast('复制失败', 'warning'))}
            >
              复制网关地址
            </button>
            <button className="oc-tl" onClick={() => setShowLog(true)}>展开日志</button>
          </div>
        </div>

      </div>

      {showLog && statusLog.length > 0 && (
        <div className="isolated-widget" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="widget-header" style={{ margin: 0 }}>📋 设备日志</span>
            <button className="oc-bar-btn" onClick={() => setShowLog(false)}>收起</button>
          </div>
          <pre className="ros-output-content" style={{ maxHeight: 220, overflow: 'auto' }}>
            {statusLog.join('\n')}
          </pre>
        </div>
      )}

      <div className="oc-hint">
        💡 主聊天快捷指令
        <button className="oc-hint-cmd" onClick={() => pushToMainChat('启动 OpenClaw 服务')}>"启动 OpenClaw 服务"</button>
        <button className="oc-hint-cmd" onClick={() => pushToMainChat(`切换 OpenClaw 模型到 ${activeModelName}`)}>"切换 OpenClaw 模型"</button>
        <button className="oc-hint-cmd" onClick={() => pushToMainChat('检查 OpenClaw 当前状态与网关连通性')}>"检查 OpenClaw 状态"</button>
      </div>
    </div>
  );
}
