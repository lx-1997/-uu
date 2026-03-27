import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useAppState } from '../hooks/useAppState';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import {
  fetchDeviceOpenClawHealth,
  checkDevicePing,
  fetchAgentConfig,
  saveAgentConfig,
} from '../api';
import { resolveApiUrl } from '../utils/apiBase';
import {
  deployJobStorageKey as ocDeployJobLsKey,
  startOpenClawDeployPoll,
  subscribeOpenClawDeployJob,
  syncOpenClawDeployPollFromStorage,
} from '../utils/openclawDeployPoll';

type Step = 'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | 'done';

const BOARDS = [
  {
    key: 'x3',
    name: 'RDK X3',
    chip: '旭日3',
    tops: '5 TOPS',
    cpu: '4x A53 @1.5GHz',
    mem: '2/4GB',
    desc: '入门级机器人开发套件，200+ 开源算法',
    url: 'https://developer.d-robotics.cc/rdkx3',
  },
  {
    key: 'x5',
    name: 'RDK X5',
    chip: '旭日5',
    tops: '10 TOPS',
    cpu: '8x A55 @1.5GHz',
    mem: '4/8GB',
    desc: 'Type-C 闪连开发，Wi-Fi 6 + BT 5.4',
    url: 'https://developer.d-robotics.cc/rdkx5',
  },
  {
    key: 's100',
    name: 'RDK S100',
    chip: 'Journey 6',
    tops: '128 TOPS',
    cpu: '6x A78AE + 4x R52',
    mem: '12/24GB',
    desc: '具身智能平台，大小脑架构，全场景算力',
    url: 'https://developer.d-robotics.cc/rdks100',
  },
];

const IMAGE_RECOMMENDATIONS: Record<string, { name: string; tag: string; url: string }> = {
  x3: { name: 'RDKOS 3.0.3 Desktop', tag: 'ubuntu22.04 / 图形界面', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/' },
  x5: { name: 'RDKOS 3.4.1 Desktop', tag: 'ubuntu22.04 / 图形界面', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/' },
  s100: { name: 'RDKS100-V4.0.4-Beta Desktop', tag: 'ubuntu22.04', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/' },
};

const MODEL_PRESETS: Record<string, { model: string; baseUrl: string }> = {
  qwen: { model: 'qwen-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  'openai-compatible': { model: '', baseUrl: '' },
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function StepIndicator({ current, steps }: { current: Step; steps: { key: Step; label: string }[] }) {
  const idx = steps.findIndex(s => s.key === current);
  return (
    <div className="ob-steps">
      {steps.map((s, i) => (
        <div key={s.key} className={`ob-step ${i < idx ? 'done' : i === idx ? 'active' : ''}`}>
          <span className="ob-step-num">
            {i < idx ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            ) : i + 1}
          </span>
          {i < steps.length - 1 && <span className="ob-step-line" />}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingWizard() {
  const {
    obStep, setObStep, selectedBoard, setSelectedBoard,
    setActiveTab, setShowAddDevice, currentDevice,
    setChatExpanded, setCmd, addToast,
    setObReturnStep,
  } = useAppState();

  const { t, language } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const obSteps = useMemo(
    () => [
      { key: 'board' as const, label: t('onboard.step.board', '选择硬件') },
      { key: 'flash' as const, label: t('onboard.step.flash', '烧录系统') },
      { key: 'connect' as const, label: t('onboard.step.connect', '连接设备') },
      { key: 'rdkclaw' as const, label: t('onboard.step.rdkclaw', '试用 AI') },
    ],
    [t, language],
  );

  const skipRisks = useMemo(
    () => [
      t('onboard.skipRisk.1', '板端 AI Agent 能力不可用（智能对话、自动化执行）'),
      t('onboard.skipRisk.2', '无法通过飞书等消息渠道远程控制设备'),
      t('onboard.skipRisk.3', '板端技能（摄像头、推理、GPIO 等）无法被 AI 调用'),
    ],
    [t, language],
  );

  const deployHint = useCallback(
    (code: string, message: string) => {
      if (code === 'INVALID_DEPLOY_CONFIG') return t('onboard.deployErr.invalidConfig', '模型配置不完整：请先在上一步填写并保存 provider / model / API Key。');
      if (code === 'OPENCLAW_DEPLOY_JOB_NOT_FOUND') return t('onboard.deployErr.jobNotFound', '部署任务状态已过期或不存在，请重新发起一键部署。');
      if (code === 'DEVICE_NOT_FOUND') return t('onboard.deployErr.deviceNotFound', '未找到当前设备，请返回设备连接步骤重新选择。');
      return message || t('onboard.deployErr.generic', '部署失败，请查看日志并重试。');
    },
    [t],
  );

  const [ocChecking, setOcChecking] = useState(false);
  const [ocReady, setOcReady] = useState<boolean | null>(null);
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [ocGatewayRunning, setOcGatewayRunning] = useState<boolean | null>(null);
  const [ocSummary, setOcSummary] = useState('');
  const [ocVersion, setOcVersion] = useState('');
  const [ocInstalling, setOcInstalling] = useState(false);
  const [ocStartingGw, setOcStartingGw] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null);
  const [ocInstallLog, setOcInstallLog] = useState('');
  const [ocGwLog, setOcGwLog] = useState('');
  const [installElapsed, setInstallElapsed] = useState(0);
  const [showSkipWarning, setShowSkipWarning] = useState(false);
  const [deployJobId, setDeployJobId] = useState('');
  const [autoVerifying, setAutoVerifying] = useState(false);
  const [modelProvider, setModelProvider] = useState('qwen');
  const [modelName, setModelName] = useState(MODEL_PRESETS.qwen.model);
  const [modelBaseUrl, setModelBaseUrl] = useState(MODEL_PRESETS.qwen.baseUrl);
  const [modelApiKey, setModelApiKey] = useState('');
  const [modelSaving, setModelSaving] = useState(false);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [modelHasSavedKey, setModelHasSavedKey] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [ocHealthCheckedForSkip, setOcHealthCheckedForSkip] = useState(false);

  useEffect(() => {
    if (obStep === 'connect' && currentDevice) {
      setObStep('rdkclaw');
    }
  }, [obStep, currentDevice]);

  useEffect(() => {
    if (obStep !== 'model' || !currentDevice || ocHealthCheckedForSkip) return;
    setOcHealthCheckedForSkip(true);
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then(r => {
        if (r.status?.aiReady) {
          addToast(tRef.current('onboard.toast.ocReadySkip', 'OpenClaw 已就绪，已跳过部署步骤'), 'success');
          setObStep('rdkclaw');
        }
      })
      .catch(() => {});
  }, [obStep, currentDevice?.id]);

  useEffect(() => {
    if (obStep !== 'model' && obStep !== 'openclaw') return;
    fetchAgentConfig()
      .then((config) => {
        const provider = String(config.provider || '').trim();
        const model = String(config.model || '').trim();
        const baseUrl = String(config.baseUrl || '').trim();
        if (provider) setModelProvider(provider);
        if (model) setModelName(model);
        if (baseUrl) setModelBaseUrl(baseUrl);
        setModelConfigured(!!config.configured && !!provider && !!model);
        setModelHasSavedKey(!!config.hasApiKey);
      })
      .catch(() => {
        setModelConfigured(false);
        setModelHasSavedKey(false);
      });
  }, [obStep]);

  useEffect(() => {
    if (obStep !== 'openclaw' || !currentDevice) return;
    setOcChecking(true);
    setDeviceOnline(null);
    checkDevicePing(currentDevice.id)
      .then((r) => setDeviceOnline(!!r.ok))
      .catch(() => setDeviceOnline(false));
    fetchDeviceOpenClawHealth(currentDevice.id)
      .then(r => {
        const s = r.status;
        setOcInstalled(!!s?.installed);
        setOcGatewayRunning(!!s?.gatewayRunning);
        setOcReady(!!s?.aiReady);
        setOcSummary(s?.summary || '');
        setOcVersion(s?.version || '');
      })
      .catch(() => {
        setOcInstalled(null);
        setOcGatewayRunning(null);
        setOcReady(false);
        setOcSummary(tRef.current('onboard.status.unknown', '无法获取状态'));
      })
      .finally(() => setOcChecking(false));
  }, [obStep, currentDevice?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ocInstallLog, ocGwLog]);

  useEffect(() => {
    if (!ocInstalling) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setInstallElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [ocInstalling]);

  useEffect(() => {
    if (!currentDevice) return;
    const deviceId = currentDevice.id;
    const storageKey = ocDeployJobLsKey(deviceId);
    if (obStep === 'openclaw') {
      syncOpenClawDeployPollFromStorage(deviceId);
    }
    const unsubscribe = subscribeOpenClawDeployJob((job) => {
      if (job.deviceId !== deviceId) return;
      setDeployJobId(job.id || '');
      if (typeof job.output === 'string') setOcInstallLog(job.output);
      setOcInstalling(job.status === 'running');
      if (job.status === 'running') return;

      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }

      if (job.status === 'error') {
        const msg = job.error || tRef.current('onboard.deploy.failShort', '部署失败，请查看日志');
        setOcInstallLog((prev) => `${prev}\n[错误] ${msg}\n`);
        addToast(tRef.current('onboard.deploy.failToast', 'OpenClaw 一键部署失败，请查看日志'), 'warning');
        return;
      }

      void fetchDeviceOpenClawHealth(deviceId)
        .then((health) => {
          const status = health.status;
          setOcInstalled(!!status?.installed);
          setOcGatewayRunning(!!status?.gatewayRunning);
          setOcReady(!!status?.aiReady);
          setOcSummary(status?.summary || '');
          setOcVersion(status?.version || '');
          setOcInstallLog((prev) => `${prev}\n${fillTemplate(tRef.current('onboard.verify.logLine', '[验通] 网关状态: {{gw}}\n[验通] {{summary}}'), {
            gw: status?.gatewayRunning ? tRef.current('onboard.log.running', '运行中') : tRef.current('onboard.log.stopped', '未运行'),
            summary: status?.summary || '',
          })}\n`);
          if (status?.gatewayRunning) {
            addToast(tRef.current('onboard.deploy.done', 'OpenClaw 部署完成'), 'success');
          } else {
            addToast(tRef.current('onboard.deploy.gwNotReady', '部署完成，但网关未就绪，请点击“启动网关”'), 'warning');
          }
        })
        .catch(() => {
          addToast(tRef.current('onboard.deploy.verifyFail', '部署完成，但状态验通失败，请稍后重试'), 'warning');
        })
        .finally(() => {
          setAutoVerifying(false);
        });
    });
    return unsubscribe;
  }, [addToast, currentDevice, obStep]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleInstallOC = useCallback(async () => {
    if (!currentDevice) return;
    if (!modelConfigured) {
      addToast(t('onboard.toast.needModelFirst', '请先完成模型配置，再执行一键部署'), 'warning');
      setObStep('model');
      return;
    }
    if (deviceOnline === false) {
      addToast(t('onboard.toast.deviceUnreachable', '设备当前无法连通（请先确认网络与 SSH），再安装 OpenClaw'), 'warning');
      return;
    }

    try {
      const ping = await checkDevicePing(currentDevice.id);
      if (!ping.ok) {
        addToast(t('onboard.toast.pingFail', '安装前检测：设备未响应，请检查网络后重试'), 'warning');
        return;
      }
    } catch {
      addToast(t('onboard.toast.pingErr', '安装前检测：无法连接设备'), 'warning');
      return;
    }

    setOcInstalling(true);
    setOcInstallLog('');
    setInstallElapsed(0);
    setShowSkipWarning(false);

    try {
      const startResponse = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/deploy/start`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: modelProvider.trim(),
          baseUrl: modelBaseUrl.trim(),
          apiKey: modelApiKey.trim() || undefined,
          modelId: modelName.trim(),
          api: 'openai-completions',
        }),
      });
      const startPayload = await startResponse.json().catch(() => ({} as { error?: string; code?: string; message?: string; jobId?: string }));
      if (!startResponse.ok || !startPayload?.jobId) {
        throw new Error(deployHint(String(startPayload?.code || ''), String(startPayload?.message || startPayload?.error || tf('onboard.deploy.startFail', '部署启动失败（HTTP {{status}}）', { status: startResponse.status }))));
      }
      setDeployJobId(startPayload.jobId);
      setOcInstallLog((prev) => `${prev}${tf('onboard.log.jobLine', '[部署] 已启动任务 {{id}}\n', { id: startPayload.jobId })}`);
      try {
        localStorage.setItem(ocDeployJobLsKey(currentDevice.id), startPayload.jobId);
      } catch {
        // ignore
      }
      startOpenClawDeployPoll(currentDevice.id, startPayload.jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOcInstallLog(prev => prev + `\n[错误] ${msg}\n`);
      addToast(t('onboard.deploy.failToast', 'OpenClaw 一键部署失败，请查看日志'), 'warning');
      setOcInstalling(false);
    } finally {
      setAutoVerifying(false);
    }
  }, [
    currentDevice,
    deviceOnline,
    addToast,
    modelConfigured,
    modelProvider,
    modelBaseUrl,
    modelApiKey,
    modelName,
    setObStep,
    deployHint,
    t,
    tf,
  ]);

  const recheckHealth = useCallback(async () => {
    if (!currentDevice) return;
    setOcChecking(true);
    try {
      const r = await fetchDeviceOpenClawHealth(currentDevice.id);
      const s = r.status;
      setOcInstalled(!!s?.installed);
      setOcGatewayRunning(!!s?.gatewayRunning);
      setOcReady(!!s?.aiReady);
      setOcSummary(s?.summary || '');
      setOcVersion(s?.version || '');
    } catch {
      setOcSummary(t('onboard.recheck.fail', '检查失败，请重试'));
    } finally {
      setOcChecking(false);
    }
  }, [currentDevice, t]);

  const handleStartGateway = useCallback(async () => {
    if (!currentDevice) return;
    setOcStartingGw(true);
    setOcGwLog(`${t('onboard.gw.sending', '[网关] 正在发送启动指令...')}\n`);

    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/restart-gateway`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; output?: string };
      const gwOutput = (data.output || '').trim();
      setOcGwLog(prev => prev + (gwOutput ? gwOutput + '\n' : '') + `\n${t('onboard.gw.sent', '[网关] 启动指令已执行，等待网关就绪...')}\n`);

      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 3000));
        setOcGwLog(prev => prev + tf('onboard.gw.poll', '[检查] 第 {{i}}/8 次状态轮询...\n', { i: i + 1 }));
        try {
          const health = await fetchDeviceOpenClawHealth(currentDevice.id);
          const s = health.status;
          setOcInstalled(!!s?.installed);
          setOcGatewayRunning(!!s?.gatewayRunning);
          setOcReady(!!s?.aiReady);
          setOcSummary(s?.summary || '');
          setOcVersion(s?.version || '');
          if (s?.gatewayRunning) {
            setOcGwLog(prev => prev + t('onboard.gw.ok', '[成功] 网关已启动 ✓\n'));
            addToast(t('onboard.toast.gwStarted', 'OpenClaw 网关已启动'), 'success');
            return;
          }
          setOcGwLog(prev => prev + tf('onboard.gw.waitDetail', '[检查] 网关尚未就绪 ({{detail}})\n', { detail: s?.summary || t('onboard.gw.waitingLabel', '等待中') }));
        } catch {
          setOcGwLog(prev => prev + t('onboard.gw.pollFail', '[检查] 状态查询失败，继续等待...\n'));
        }
      }
      setOcGwLog(prev => prev + `\n${t('onboard.gw.timeout', '[超时] 8 次轮询后网关仍未就绪，请点击「重新检查」或前往 OpenClaw 页面')}\n`);
      addToast(t('onboard.toast.gwMaybe', '网关可能仍在启动中，请点击「重新检查」刷新状态'), 'warning');
    } catch (e) {
      setOcGwLog(prev => prev + `\n[错误] ${e instanceof Error ? e.message : t('onboard.gw.errReq', '网关启动请求失败')}\n`);
      addToast(t('onboard.toast.gwFail', '网关启动失败，请前往 OpenClaw 页面手动操作'), 'warning');
    } finally {
      setOcStartingGw(false);
    }
  }, [currentDevice, addToast, t, tf]);

  const handleSaveModelConfig = useCallback(async () => {
    if (!modelProvider.trim()) {
      addToast(t('onboard.toast.pickProvider', '请先选择 provider'), 'warning');
      return false;
    }
    if (!modelName.trim()) {
      addToast(t('onboard.toast.fillModel', '请先填写模型名称'), 'warning');
      return false;
    }
    if (!modelApiKey.trim() && !modelHasSavedKey) {
      addToast(t('onboard.toast.fillKey', '请先填写 API Key'), 'warning');
      return false;
    }
    setModelSaving(true);
    try {
      await saveAgentConfig({
        action: 'upsert',
        provider: modelProvider.trim(),
        model: modelName.trim(),
        apiKey: modelApiKey.trim() || undefined,
        baseUrl: modelBaseUrl.trim() || undefined,
        setActive: true,
      });
      setModelConfigured(true);
      setModelHasSavedKey(true);
      setModelApiKey('');
      addToast(t('onboard.toast.modelSaved', '模型配置已保存'), 'success');
      return true;
    } catch {
      addToast(t('onboard.toast.modelSaveFail', '模型配置保存失败'), 'error');
      return false;
    } finally {
      setModelSaving(false);
    }
  }, [modelProvider, modelName, modelApiKey, modelBaseUrl, modelHasSavedKey, addToast, t]);

  const handleGoDeploy = useCallback(async () => {
    const ok = await handleSaveModelConfig();
    if (ok) {
      setObStep('openclaw');
    }
  }, [handleSaveModelConfig, setObStep]);

  const handleSkipConfirm = () => {
    if (ocInstalling) {
      addToast(t('onboard.toast.installBg', 'OpenClaw 安装仍在后台进行，完成后可在 OpenClaw 页面查看'), 'info');
    }
    setShowSkipWarning(false);
    setObStep('rdkclaw');
  };

  const handleCopyLog = async () => {
    if (!ocInstallLog.trim()) return;
    try {
      await navigator.clipboard.writeText(ocInstallLog);
      addToast(t('onboard.toast.logCopied', '日志已复制到剪贴板'), 'success');
    } catch {
      addToast(t('onboard.toast.copyFail', '复制失败'), 'warning');
    }
  };

  const goFlasher = () => {
    setObReturnStep('flash');
    setActiveTab('flasher');
  };

  const goOpenClaw = () => {
    setObReturnStep('openclaw');
    setActiveTab('openclaw');
  };

  const handleTryRDKClaw = () => {
    addToast(t('onboard.toast.trySent', '已发送到 AI 对话区，你可以继续在这里点击“完成”结束引导'), 'success');
    setChatExpanded(true);
    setCmd(t('onboard.cmd.health', '帮我全面检查当前设备的健康状态，包括温度、内存、BPU 负载和网络，并给出优化建议'));
    setTimeout(() => {
      (document.querySelector('.dock-input') as HTMLFormElement | null)?.requestSubmit();
    }, 500);
  };

  const finish = () => {
    setObStep('done');
    addToast(t('onboard.toast.done', '新手引导已完成，尽情使用 RDK Studio 吧！'), 'success');
  };

  const stepIdx = obSteps.findIndex((s) => s.key === obStep);

  const boardsI18n = useMemo(
    () =>
      BOARDS.map((b) => ({
        ...b,
        chip: t(`onboard.board.${b.key}.chip`, b.chip),
        desc: t(`onboard.board.${b.key}.desc`, b.desc),
      })),
    [t, language],
  );

  return (
    <div className="ob-wizard">
      <div className="ob-header">
        <div className="ob-brand">RDK Studio</div>
        <p className="ob-subtitle">{t('onboard.subtitle', '欢迎使用，让我们一步步配置你的开发环境')}</p>
      </div>

      <StepIndicator current={obStep} steps={obSteps} />

      <div className="ob-title">{obSteps[stepIdx]?.label}</div>

      {/* ── Step 1: 选择硬件 ── */}
      {obStep === 'board' && (
        <div className="ob-content">
          <p className="ob-desc">{t('onboard.board.pick', '选择你手上的 RDK 开发板型号：')}</p>
          <div className="ob-board-grid">
            {boardsI18n.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`ob-board-card ${selectedBoard === b.key ? 'selected' : ''}`}
                onClick={() => setSelectedBoard(b.key)}
              >
                <div className="ob-board-head">
                  <strong className="ob-board-name">{b.name}</strong>
                  <span className="ob-board-tops">{b.tops}</span>
                </div>
                <div className="ob-board-specs">
                  <span>{b.chip}</span>
                  <span>{b.cpu}</span>
                  <span>{b.mem}</span>
                </div>
                <p className="ob-board-desc">{b.desc}</p>
                <a className="ob-board-link" href={b.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {t('onboard.board.learnMore', '了解更多')}
                </a>
              </button>
            ))}
          </div>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('flash')}>
              {t('onboard.btn.skipFlash', '跳过，直接烧录')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!selectedBoard} onClick={() => setObStep('flash')}>
              {t('onboard.btn.next', '下一步')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: 烧录系统 ── */}
      {obStep === 'flash' && (
        <div className="ob-content">
          {selectedBoard && IMAGE_RECOMMENDATIONS[selectedBoard] ? (
            <>
              <p className="ob-desc">
                {t('onboard.flash.recoBefore', '为你的')}{' '}
                <strong>{BOARDS.find((b) => b.key === selectedBoard)?.name}</strong>
                {' '}{t('onboard.flash.recoAfter', '推荐以下系统镜像：')}
              </p>
              <div className="ob-flash-card">
                <div className="ob-flash-info">
                  <strong>{t(`onboard.image.${selectedBoard}.name`, IMAGE_RECOMMENDATIONS[selectedBoard].name)}</strong>
                  <span className="badge badge-muted">
                    {t(`onboard.image.${selectedBoard}.tag`, IMAGE_RECOMMENDATIONS[selectedBoard].tag)}
                  </span>
                </div>
                <p className="ob-desc">{t('onboard.flash.desktopHint', '推荐 Desktop 版本，含图形界面和完整开发工具链。需要将镜像写入 TF 卡（或 eMMC），请使用烧录工具。')}</p>
                <div className="ob-flash-actions">
                  <a className="btn btn-ghost btn-sm" href={IMAGE_RECOMMENDATIONS[selectedBoard].url} target="_blank" rel="noreferrer">
                    {t('onboard.flash.download', '下载镜像')}
                  </a>
                  <button type="button" className="btn btn-primary btn-sm" onClick={goFlasher}>
                    {t('onboard.flash.openTool', '打开烧录工具')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="ob-desc">{t('onboard.flash.pickFirst', '请先在烧录工具中选择板卡和镜像完成烧录。')}</p>
          )}
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('board')}>{t('onboard.btn.back', '上一步')}</button>
            <button type="button" className="btn btn-primary" onClick={() => setObStep('connect')}>
              {t('onboard.flash.doneNext', '已烧录完成，下一步')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: 连接设备 ── */}
      {obStep === 'connect' && (
        <div className="ob-content">
          <p className="ob-desc">{t('onboard.connect.desc', '将开发板通电并通过网线或 WiFi 连接到与本机同一局域网，然后添加设备。')}</p>
          <div className="ob-connect-methods">
            <div className="ob-connect-card">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M5 12.55a11 11 0 0114 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg>
              <div>
                <strong>{t('onboard.connect.sshTitle', 'SSH 网络')}</strong>
                <span>{t('onboard.connect.sshSub', '输入 IP 地址，远程连接')}</span>
              </div>
            </div>
            <div className="ob-connect-card">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/><rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/><circle cx="12" cy="8" r="2"/><path d="M12 2v4"/></svg>
              <div>
                <strong>{t('onboard.connect.serialTitle', 'USB 串口')}</strong>
                <span>{t('onboard.connect.serialSub', '调试口直连，适合首次配网')}</span>
              </div>
            </div>
          </div>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep(selectedBoard ? 'flash' : 'board')}>{t('onboard.btn.back', '上一步')}</button>
            <button type="button" className="btn btn-primary" onClick={() => setShowAddDevice(true)}>
              {t('onboard.connect.addDevice', '添加设备')}
            </button>
          </div>
          <button type="button" className="ob-skip" onClick={() => { setObStep('rdkclaw'); addToast(t('onboard.toast.skipConnect', '已跳过设备连接，可先体验 AI，稍后再补连设备'), 'info'); }}>
            {t('onboard.connect.skipLater', '稍后连接，跳过引导')}
          </button>
        </div>
      )}

      {/* ── Step 4: OpenClaw 检查 ── */}
      {obStep === 'model' && (
        <div className="ob-content">
          <p className="ob-desc">
            {modelConfigured
              ? t('onboard.model.descDone', '模型已配置完成。如需修改可在下方更新，否则直接点击「下一步」继续。')
              : t('onboard.model.descNeed', '先完成模型配置（必填），然后再执行 OpenClaw 一键部署。该配置会作为板端模型网关的默认参数。')}
          </p>
          <div className="ob-oc-status">
            <div className="config-row">
              <span className="config-label">Provider</span>
              <div className="config-value">
                <select
                  className="select"
                  title={t('onboard.model.providerTitle', '模型服务商')}
                  value={modelProvider}
                  onChange={(e) => {
                    const next = e.target.value;
                    const preset = MODEL_PRESETS[next] || MODEL_PRESETS['openai-compatible'];
                    const prev = MODEL_PRESETS[modelProvider] || MODEL_PRESETS['openai-compatible'];
                    const shouldReplaceModel = !modelName || modelName === prev.model;
                    const shouldReplaceBaseUrl = !modelBaseUrl || modelBaseUrl === prev.baseUrl;
                    setModelProvider(next);
                    if (shouldReplaceModel) setModelName(preset.model);
                    if (shouldReplaceBaseUrl) setModelBaseUrl(preset.baseUrl);
                  }}
                >
                  <option value="qwen">{t('onboard.model.optQwen', '通义千问')}</option>
                  <option value="deepseek">{t('onboard.model.optDeepseek', 'DeepSeek')}</option>
                  <option value="openai">{t('onboard.model.optOpenai', 'OpenAI')}</option>
                  <option value="openai-compatible">{t('onboard.model.optCompatible', 'OpenAI Compatible')}</option>
                </select>
              </div>
            </div>
            <div className="config-row">
              <span className="config-label">{t('onboard.model.nameLabel', '模型名称')}</span>
              <div className="config-value">
                <input
                  className="input"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={t('onboard.model.namePh', '如 qwen-plus / deepseek-chat')}
                />
              </div>
            </div>
            <div className="config-row">
              <span className="config-label">{t('onboard.model.keyPh', 'API Key')}</span>
              <div className="config-value">
                <input
                  type="password"
                  className="input"
                  value={modelApiKey}
                  onChange={(e) => setModelApiKey(e.target.value)}
                  placeholder={modelHasSavedKey ? t('onboard.model.keyPhSaved', '已存在密钥，留空则不覆盖') : t('onboard.model.keyPh', '请输入 API Key')}
                />
              </div>
            </div>
            <div className="config-row">
              <span className="config-label">{t('onboard.model.baseUrlLabel', 'Base URL')}</span>
              <div className="config-value">
                <input
                  className="input"
                  value={modelBaseUrl}
                  onChange={(e) => setModelBaseUrl(e.target.value)}
                  placeholder={t('onboard.model.basePh', '如 https://api.deepseek.com/v1')}
                />
              </div>
            </div>
            {modelConfigured && (
              <div className="ob-oc-ready">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>{t('onboard.model.readyBanner', '模型配置已就绪，可继续部署 OpenClaw')}</span>
              </div>
            )}
          </div>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('connect')}>{t('onboard.btn.back', '上一步')}</button>
            {modelConfigured ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void handleSaveModelConfig()} disabled={modelSaving}>
                  {modelSaving ? t('onboard.model.saving', '保存中...') : t('onboard.model.update', '更新配置')}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setObStep('openclaw')}>
                  {t('onboard.btn.next', '下一步')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void handleSaveModelConfig()} disabled={modelSaving}>
                  {modelSaving ? t('onboard.model.saving', '保存中...') : t('onboard.model.saveOnly', '仅保存')}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void handleGoDeploy()} disabled={modelSaving}>
                  {t('onboard.model.saveDeploy', '保存并继续部署')}
                </button>
              </>
            )}
          </div>
          <button type="button" className="ob-skip" onClick={() => setObStep('rdkclaw')}>
            {t('onboard.skipDirect', '跳过引导，直接使用')}
          </button>
        </div>
      )}

      {obStep === 'openclaw' && (
        <div className="ob-content">
          {!modelConfigured && (
            <div className="ob-oc-offline">
              <span>{t('onboard.oc.needModel', '部署前需要先提交模型配置，请返回上一步完成必填项。')}</span>
            </div>
          )}
          <p className="ob-desc">{t('onboard.oc.intro', 'OpenClaw 是 RDK 板端 AI Agent 运行环境。点击一键部署后将自动执行安装、配置并做验通：')}</p>
          {deployJobId && (
            <p className="ob-desc">{t('onboard.oc.job', '当前部署任务：')}{deployJobId}</p>
          )}
          <div className="ob-oc-status">
            {ocChecking && (
              <div className="ob-oc-checking"><div className="spinner" /><span>{t('onboard.oc.checking', '正在检查 OpenClaw 状态...')}</span></div>
            )}
            {!ocChecking && deviceOnline === false && (
              <div className="ob-oc-offline">
                <span>
                  {t('onboard.oc.offlinePrefix', '设备当前')}
                  <strong>{t('onboard.oc.offlineStrong', '无法连通')}</strong>
                  {t('onboard.oc.offlineSuffix', '，请先确认开发板已联网、IP 正确且本机能 SSH，再安装 OpenClaw。')}
                </span>
              </div>
            )}
            {!ocChecking && ocReady === true && (
              <div className="ob-oc-ready">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <div>
                  <span>{t('onboard.oc.ready', 'OpenClaw 已就绪')}</span>
                  {ocVersion && <span className="ob-oc-detail">{tf('onboard.oc.versionDetail', '版本: {{v}}', { v: ocVersion })}</span>}
                  {ocSummary && <span className="ob-oc-detail">{ocSummary}</span>}
                </div>
              </div>
            )}
            {!ocChecking && !ocReady && ocInstalled && !showSkipWarning && (
              <div className="ob-oc-missing">
                <span>
                  {t('onboard.oc.installed', 'OpenClaw 已安装')}
                  {ocVersion ? ` (${ocVersion})` : ''}
                  {ocGatewayRunning === false ? t('onboard.oc.gwTailStopped', '，但网关未启动') : ''}
                </span>
                {ocSummary && <span className="ob-oc-detail">{ocSummary}</span>}
                <div className="ob-oc-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleStartGateway}
                    disabled={ocStartingGw}
                  >
                    {ocStartingGw ? t('onboard.oc.startingGw', '启动中...') : t('onboard.oc.startGw', '启动网关')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={recheckHealth} disabled={ocChecking}>
                    {t('onboard.oc.recheck', '重新检查')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                    {t('onboard.oc.goPage', '前往 OpenClaw 页面')}
                  </button>
                </div>
              </div>
            )}
            {!ocChecking && ocReady === false && !ocInstalled && !showSkipWarning && (
              <div className="ob-oc-missing">
                <span>{t('onboard.oc.notInstalled', 'OpenClaw 未安装')}</span>
                {ocSummary && <span className="ob-oc-detail">{ocSummary}</span>}
                <div className="ob-oc-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleInstallOC}
                    disabled={ocInstalling || deviceOnline === false || !modelConfigured}
                    title={deviceOnline === false ? t('onboard.oc.titleOffline', '请先恢复设备连通') : undefined}
                  >
                    {ocInstalling ? t('onboard.oc.deploying', '部署中...') : t('onboard.oc.deploy', '一键部署 OpenClaw')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={recheckHealth} disabled={ocChecking}>
                    {t('onboard.oc.recheck', '重新检查')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                    {t('onboard.oc.goPage', '前往 OpenClaw 页面')}
                  </button>
                </div>
              </div>
            )}

            {(ocStartingGw || ocGwLog) && !ocInstalling && !showSkipWarning && (
              <div className="ob-install-terminal">
                <div className="ob-install-terminal-header">
                  <span className="ob-install-terminal-dots">
                    <span className="td red" /><span className="td yellow" /><span className="td green" />
                  </span>
                  <span className="ob-install-terminal-title">{t('onboard.oc.gwLog', '网关日志')}</span>
                  {ocStartingGw && <span className="ob-elapsed">{t('onboard.oc.startingGw', '启动中...')}</span>}
                  {ocGwLog && (
                    <button className="ob-install-terminal-copy" onClick={() => {
                      navigator.clipboard.writeText(ocGwLog).then(() => addToast(t('onboard.toast.logCopied', '日志已复制'), 'success')).catch(() => {});
                    }} type="button">{t('onboard.oc.copyLog', '复制日志')}</button>
                  )}
                </div>
                <pre className="ob-install-terminal-body" ref={!ocInstalling ? logContainerRef : undefined}>
                  {ocGwLog || `${t('onboard.oc.prepareGw', '准备启动网关...')}\n`}
                  {ocStartingGw && <span className="ob-install-cursor">_</span>}
                  <div ref={!ocInstalling ? logEndRef : undefined} />
                </pre>
              </div>
            )}

            {(ocInstalling || ocInstallLog) && !showSkipWarning && (
              <div className="ob-install-terminal">
                <div className="ob-install-terminal-header">
                  <span className="ob-install-terminal-dots">
                    <span className="td red" /><span className="td yellow" /><span className="td green" />
                  </span>
                  <span className="ob-install-terminal-title">{autoVerifying ? t('onboard.oc.verifyLog', '验通日志') : t('onboard.oc.deployLog', '部署日志')}</span>
                  {ocInstalling && (
                    <span className="ob-elapsed">{formatElapsed(installElapsed)}</span>
                  )}
                  {ocInstallLog && (
                    <button className="ob-install-terminal-copy" onClick={handleCopyLog} type="button">
                      {t('onboard.oc.copyLog', '复制日志')}
                    </button>
                  )}
                </div>
                <pre className="ob-install-terminal-body" ref={logContainerRef}>
                  {ocInstallLog || `${t('onboard.oc.prepareDeploy', '正在连接设备，准备部署...')}\n`}
                  {ocInstalling && <span className="ob-install-cursor">_</span>}
                  <div ref={logEndRef} />
                </pre>
              </div>
            )}

            {showSkipWarning && (
              <div className="ob-skip-warning">
                <div className="ob-skip-warning-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <strong className="ob-skip-warning-title">{t('onboard.oc.skipTitle', '跳过将影响以下功能')}</strong>
                <ul className="ob-skip-warning-list">
                  {skipRisks.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
                <p className="ob-skip-warning-hint">
                  {t('onboard.oc.skipHint', '你可以稍后在 OpenClaw 页面随时安装。')}
                </p>
                <div className="ob-skip-warning-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSkipWarning(false)}>
                    {t('onboard.oc.skipBack', '返回')}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={handleSkipConfirm}>
                    {t('onboard.oc.skipAnyway', '仍然跳过')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('model')}>{t('onboard.btn.back', '上一步')}</button>
            {!ocReady && (
              <button type="button" className="btn btn-ghost" onClick={() => setShowSkipWarning(true)}>
                {t('onboard.oc.skipStep', '跳过此步骤')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setObStep('rdkclaw')}
              disabled={ocInstalling}
            >
              {ocReady ? t('onboard.oc.next', '下一步') : (ocInstalled ? t('onboard.oc.nextInstalled', '继续下一步') : t('onboard.oc.nextPartial', '下一步（可稍后完善）'))}
            </button>
            {!ocReady && !ocInstalled && (
              <button type="button" className="btn btn-ghost" onClick={handleInstallOC} disabled={ocInstalling || deviceOnline === false || !modelConfigured}>
                {ocInstalling ? t('onboard.oc.deploying', '部署中...') : t('onboard.oc.deployOneClick', '一键部署')}
              </button>
            )}
          </div>
          <button type="button" className="ob-skip" onClick={() => { setObStep('done'); addToast(t('onboard.toast.skipWizard', '引导已跳过，你可以随时在设置中重新进入'), 'info'); }}>
            {t('onboard.skipDirect', '跳过引导，直接使用')}
          </button>
        </div>
      )}

      {/* ── Step 5: 试用 RDKClaw ── */}
      {obStep === 'rdkclaw' && (
        <div className="ob-content">
          <p className="ob-desc">
            {t('onboard.rdk.intro', 'RDKClaw 是 RDK Studio 内置的 AI 智能体，可以用自然语言操控设备、开发应用、诊断问题。试试给它一个小任务：')}
          </p>
          <div className="ob-try-card">
            <div className="ob-try-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>
            </div>
            <div className="ob-try-body">
              <strong>{t('onboard.rdk.tryTitle', '设备健康检查')}</strong>
              <span>{t('onboard.rdk.tryQuote', '“检查设备温度、内存、BPU 负载并给出优化建议”')}</span>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleTryRDKClaw}>
              {t('onboard.rdk.send', '发送')}
            </button>
          </div>
          <div className="ob-flash-card" style={{ marginTop: 12 }}>
            <div className="ob-flash-info">
              <strong>{t('onboard.rdk.ocCardTitle', '配置 OpenClaw（推荐）')}</strong>
              <span className="badge badge-muted">{t('onboard.rdk.ocCardBadge', '配置后会更聪明')}</span>
            </div>
            <p className="ob-desc">{t('onboard.rdk.ocCardDesc', '完成 OpenClaw 一键部署后，板端 AI 能力更完整，任务执行更稳定。')}</p>
            <div className="ob-flash-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                {t('onboard.rdk.goOc', '前往 OpenClaw 配置')}
              </button>
            </div>
          </div>
          <p className="ob-desc ob-try-hint">
            {t('onboard.rdk.hint', '你也可以在底部对话框中随时输入任何任务，RDKClaw 会自动规划并执行。')}
          </p>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('connect')}>{t('onboard.btn.back', '上一步')}</button>
            <button type="button" className="btn btn-primary" onClick={finish}>
              {t('onboard.rdk.finish', '完成引导')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
