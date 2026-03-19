import { useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

export default function OpenClaw() {
  const { currentDevice, addToast, setActiveTab, setChatExpanded, setCmd } = useAppState();

  const [serviceRunning, setServiceRunning] = useState(false);
  const [openClawInstalled, setOpenClawInstalled] = useState(false);
  const [portListening, setPortListening] = useState(false);
  const [gatewayReachable, setGatewayReachable] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState('--');
  const [currentVersion, setCurrentVersion] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [currentModel, setCurrentModel] = useState('');

  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [statusLog, setStatusLog] = useState<string[]>([]);

  const gatewayUrl = currentDevice ? `http://${currentDevice.ip}:18789` : '';

  const pushLog = (title: string, output: string) => {
    setStatusLog((prev) => [...prev.slice(-80), `[${title}] ${new Date().toLocaleTimeString()}`, output || '[无输出]', '']);
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

  const probeGateway = async () => {
    if (!currentDevice) return;
    const pwd = getRememberedDevicePassword(currentDevice.id);
    try {
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E \\":18789\\b\" || echo port-closed; curl -fsS --max-time 2 http://127.0.0.1:18789/health 2>&1 || echo unreachable"',
        pwd,
      );
      const output = result.output || '';
      pushLog('网关探测', output);
      setPortListening(/:18789\b/.test(output) && !/port-closed/i.test(output));
      setGatewayReachable(!/unreachable|connection refused|timed out|failed/i.test(output));
    } catch (error) {
      pushLog('网关探测', '探测失败');
      setPortListening(false);
      setGatewayReachable(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setChecking(true);
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "export PATH=$HOME/.npm-global/bin:$PATH; if command -v openclaw >/dev/null 2>&1; then echo INSTALLED; openclaw --version 2>&1; systemctl --user is-active openclaw-gateway 2>&1 || echo inactive; python3 -c \\"import json,os; p=os.path.expanduser(\'~/.openclaw/openclaw.json\'); d=json.load(open(p)) if os.path.exists(p) else {}; m=d.get(\'agents\',{}).get(\'defaults\',{}).get(\'model\',{}).get(\'primary\',\'\'); print(f\'PRIMARY_MODEL={m}\') if m else None; ps=d.get(\'models\',{}).get(\'providers\',{}); print(f\'PROVIDERS={list(ps.keys())}\') if ps else None\\" 2>/dev/null || true; else echo NOT_INSTALLED; fi"',
        pwd,
      );
      const output = result.output || '';
      pushLog('状态检查', output);
      
      const installed = /INSTALLED/.test(output);
      const running = /active|running/.test(output);
      const versionMatch = output.match(/openclaw\s+(\d+\.\d+\.\d+)/i);
      const modelMatch = output.match(/PRIMARY_MODEL=([^\s]+)/);
      const providersMatch = output.match(/PROVIDERS=\[([^\]]*)\]/);
      
      setOpenClawInstalled(installed);
      setServiceRunning(running);
      setCurrentVersion(versionMatch?.[1] || '');
      setCurrentModel(modelMatch?.[1] || '');
      setCurrentProvider(providersMatch?.[1]?.split(',')[0]?.replace(/['"]/g, '').trim() || '');
      
      await probeGateway();
      setLastCheckedAt(new Date().toLocaleTimeString());
      addToast(running ? 'OpenClaw 服务运行中' : installed ? 'OpenClaw 已安装但未启动' : 'OpenClaw 未安装', running ? 'success' : 'info');
    } catch (error) {
      addToast('状态检查失败，请确认设备连接', 'error');
      pushLog('状态检查', `错误: ${error}`);
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
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "export NPM_CONFIG_PREFIX=$HOME/.npm-global; export PATH=$HOME/.npm-global/bin:$PATH; echo [安装OpenClaw]; npm cache clean --force 2>/dev/null || true; for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info 2>&1; then break; fi; echo [重试$i/3]; sleep 5; done; openclaw --version 2>&1 || echo 安装可能失败"',
        pwd,
      );
      const output = result.output || '';
      pushLog('安装', output);
      setShowLog(true);
      
      if (/openclaw\s+\d+\.\d+/.test(output)) {
        setOpenClawInstalled(true);
        addToast('OpenClaw 安装完成', 'success');
        await handleCheckStatus();
      } else {
        addToast('安装可能失败，请查看日志', 'warning');
      }
    } catch (error) {
      addToast('安装失败，请检查网络连接', 'error');
      pushLog('安装', `错误: ${error}`);
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
      const pwd = getRememberedDevicePassword(currentDevice.id);
      if (serviceRunning) {
        const result = await executeDeviceCommand(
          currentDevice.id,
          'bash -lc "export PATH=$HOME/.npm-global/bin:$PATH; systemctl --user stop openclaw-gateway 2>&1 || openclaw gateway stop 2>&1 || pkill -f openclaw"',
          pwd,
        );
        pushLog('停止服务', result.output);
        setServiceRunning(false);
        setPortListening(false);
        setGatewayReachable(false);
        addToast('OpenClaw 服务已停止', 'info');
      } else {
        const result = await executeDeviceCommand(
          currentDevice.id,
          'bash -lc "export PATH=$HOME/.npm-global/bin:$PATH; systemctl --user start openclaw-gateway 2>&1 || openclaw gateway start 2>&1; sleep 2; systemctl --user is-active openclaw-gateway 2>&1 || echo check-status"',
          pwd,
        );
        const output = result.output || '';
        pushLog('启动服务', output);
        setShowLog(true);
        const running = /active|running/.test(output);
        setServiceRunning(running);
        addToast(running ? 'OpenClaw 服务已启动' : '启动命令已发送，请检查日志', running ? 'success' : 'warning');
        await probeGateway();
      }
      setLastCheckedAt(new Date().toLocaleTimeString());
    } catch (error) {
      addToast(serviceRunning ? '停止失败' : '启动失败', 'error');
      pushLog(serviceRunning ? '停止服务' : '启动服务', `错误: ${error}`);
    } finally {
      setChecking(false);
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
      await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "export PATH=$HOME/.npm-global/bin:$PATH; systemctl --user stop openclaw-gateway 2>&1 || openclaw gateway stop 2>&1 || pkill -f openclaw"',
        pwd,
      );
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "export NPM_CONFIG_PREFIX=$HOME/.npm-global; npm uninstall -g openclaw 2>&1; rm -rf ~/.openclaw 2>&1; echo 卸载完成"',
        pwd,
      );
      pushLog('卸载', result.output);
      setShowLog(true);
      setOpenClawInstalled(false);
      setServiceRunning(false);
      setPortListening(false);
      setGatewayReachable(false);
      setCurrentVersion('');
      setCurrentProvider('');
      setCurrentModel('');
      setLastCheckedAt(new Date().toLocaleTimeString());
      addToast('OpenClaw 已卸载', 'success');
    } catch (error) {
      addToast('卸载失败', 'error');
      pushLog('卸载', `错误: ${error}`);
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
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "LOG=$(ls -t /tmp/openclaw/openclaw-*.log 2>/dev/null | head -1); if [ -n \\"$LOG\\" ]; then tail -100 \\"$LOG\\"; else echo 未找到日志文件; fi"',
        pwd,
      );
      pushLog('日志', result.output);
      setShowLog(true);
    } catch (error) {
      addToast('获取日志失败', 'error');
      pushLog('日志', `错误: ${error}`);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (currentDevice) {
      handleCheckStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

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
          {currentVersion && <span className="oc-bar-ver">v{currentVersion}</span>}
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
          {currentProvider && (
            <>
              <div className="oc-cfg-item">
                <span className="oc-cfg-label">Provider</span>
                <span className="oc-cfg-val mono">{currentProvider}</span>
              </div>
              <span className="oc-cfg-sep" />
            </>
          )}
          {currentModel && (
            <>
              <div className="oc-cfg-item">
                <span className="oc-cfg-label">当前模型</span>
                <span className="oc-cfg-val mono">{currentModel}</span>
              </div>
              <span className="oc-cfg-sep" />
            </>
          )}
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
            <div className="oc-step"><span className="oc-step-n">3</span>查看日志并诊断问题</div>
          </div>
          <div className="oc-tools-grid" style={{ marginTop: 14 }}>
            <button className="oc-tl" onClick={handleInstall} disabled={installing}>安装更新</button>
            <button className="oc-tl" onClick={toggleService} disabled={checking}>{serviceRunning ? '停止服务' : '启动服务'}</button>
            <button className="oc-tl" onClick={handleCheckStatus} disabled={checking}>刷新状态</button>
            <button className="oc-tl" onClick={handleViewLogs} disabled={checking}>读取日志</button>
            <button className="oc-tl" onClick={() => pushToMainChat('启动 OpenClaw 服务')}>主聊天启动</button>
            <button className="oc-tl" onClick={() => pushToMainChat('检查 OpenClaw 当前状态')}>主聊天诊断</button>
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
            <button className="oc-tl" onClick={probeGateway} disabled={checking}>连通探测</button>
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

        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>📋 快捷操作</span>
          </div>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>通过主聊天框执行命令</div>
            <div className="oc-step"><span className="oc-step-n">2</span>AI 助手会自动解析并执行</div>
            <div className="oc-step"><span className="oc-step-n">3</span>查看执行结果和反馈</div>
          </div>
          <div className="oc-tools-grid" style={{ marginTop: 14 }}>
            <button className="oc-tl" onClick={() => pushToMainChat('配置 OpenClaw 使用 qwen 模型')}>配置模型</button>
            <button className="oc-tl" onClick={() => pushToMainChat('查看 OpenClaw 配置文件')}>查看配置</button>
            <button className="oc-tl" onClick={() => pushToMainChat('重启 OpenClaw Gateway')}>重启网关</button>
            <button className="oc-tl" onClick={() => pushToMainChat('OpenClaw 健康检查')}>健康检查</button>
            <button className="oc-tl" onClick={() => pushToMainChat('查看 OpenClaw 版本信息')}>版本信息</button>
            <button className="oc-tl" onClick={() => pushToMainChat('OpenClaw 故障诊断')}>故障诊断</button>
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
        <button className="oc-hint-cmd" onClick={() => pushToMainChat('检查 OpenClaw 当前状态与网关连通性')}>"检查 OpenClaw 状态"</button>
        <button className="oc-hint-cmd" onClick={() => pushToMainChat('配置 OpenClaw 模型')}>"配置 OpenClaw 模型"</button>
      </div>
    </div>
  );
}
