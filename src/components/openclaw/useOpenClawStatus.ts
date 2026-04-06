/* ═══════════════════════════════════════════
   OpenClaw — Status & Config Loading Hook
   ═══════════════════════════════════════════ */

import { useState, useMemo, useCallback, useRef } from 'react';
import { fetchApi } from '../../utils/apiBase';
import { persistGatewayStatusSnapshot } from '../../studio-ui-hints';
import { fillTemplate } from '../../i18n/en-extras';
import { useI18n } from '../../i18n/use-i18n';
import { useAppState } from '../../hooks/useAppState';
import { inferPresetFromGateway } from './constants';
import type { GatewayStatus, ConfigData, SetupStatus } from './types';

export function useOpenClawStatus() {
  const { currentDevice, addToast } = useAppState();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const tf = (key: string, zh: string, vars: Record<string, string | number>) =>
    fillTemplate(t(key, zh), vars);

  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);

  const ocInstalled = useMemo(
    () => !!(status?.installed ?? status?.version?.trim()),
    [status],
  );

  const loadStatus = useCallback(async (): Promise<GatewayStatus | null> => {
    if (!currentDevice) return null;
    setStatusLoading(true);
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/status`);
      if (!res.ok) {
        addToast?.(tf('oc.toast.statusFail', '获取状态失败: HTTP {{status}}', { status: res.status }), 'error');
        return null;
      }
      const data = await res.json();
      setStatus(data);
      const st = data as GatewayStatus;
      persistGatewayStatusSnapshot(currentDevice.id, {
        running: !!st.running,
        version: typeof st.version === 'string' ? st.version : '',
        installed: !!(st.installed ?? st.version?.trim()),
        feishuConnected: !!st.feishuConnected,
      });
      return data;
    } catch (e: any) {
      addToast?.(tf('oc.toast.statusNet', '获取状态失败: {{msg}}', { msg: e?.message || t('oc.err.network', '网络错误') }), 'error');
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, [currentDevice, addToast, t]);

  const loadStatusWithRetry = useCallback(async (times = 5, intervalMs = 2000) => {
    if (!currentDevice) return;
    for (let i = 0; i < times; i += 1) {
      await loadStatus();
      if (i < times - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }, [currentDevice, loadStatus]);

  const loadConfig = useCallback(async (): Promise<ConfigData | null> => {
    if (!currentDevice) return null;
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/config`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        addToast?.(tf('oc.toast.configHttp', '加载配置失败: {{detail}}', { detail: String(errBody.error || `HTTP ${res.status}`) }), 'error');
        return null;
      }
      const data = await res.json();
      setConfig(data);
      return data;
    } catch (e: any) {
      addToast?.(tf('oc.toast.configFail', '加载配置失败: {{msg}}', { msg: e?.message || t('oc.err.network', '网络错误') }), 'error');
      return null;
    }
  }, [currentDevice, addToast, t]);

  const getSetupStatus = useCallback((): SetupStatus => {
    const installed = !!(status?.installed ?? status?.version?.trim());
    const modelOk = !!(config?.modelGateway?.baseUrl && config?.modelGateway?.apiKey);
    const feishuOk = !!(config?.feishu?.appId && config?.feishu?.appSecret);
    return {
      gateway: installed ? 'ok' : (status === null ? 'warn' : 'error'),
      model: modelOk ? 'ok' : 'unconfigured',
      feishu: feishuOk ? 'ok' : 'unconfigured',
    };
  }, [status, config]);

  const needsSetup = useCallback(() => {
    const installed = !!(status?.installed ?? status?.version?.trim());
    const modelOk = !!(config?.modelGateway?.baseUrl && config?.modelGateway?.apiKey);
    return !installed || !modelOk;
  }, [status, config]);

  const getBoardModelNameForDisplay = useCallback(() => {
    if (!config) return t('oc.summary.notConfigured', '未配置');
    if (config.primaryModel) {
      const parts = config.primaryModel.split('/');
      return parts.length > 1 ? parts[1] : config.primaryModel;
    }
    if (config.modelGateway?.modelId?.trim()) return config.modelGateway.modelId.trim();
    return t('oc.summary.notConfigured', '未配置');
  }, [config, t]);

  return {
    status,
    setStatus,
    config,
    setConfig,
    statusLoading,
    configBusy,
    setConfigBusy,
    ocInstalled,
    loadStatus,
    loadStatusWithRetry,
    loadConfig,
    getSetupStatus,
    needsSetup,
    getBoardModelNameForDisplay,
  };
}
