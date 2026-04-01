import { useEffect, useRef } from 'react';
import { useDeviceStore } from '../hooks/useDeviceStore';
import { useToastStore } from '../hooks/useToastStore';
import { useI18n } from '../i18n/use-i18n';
import { syncOpenClawDeployPollFromStorage } from '../utils/openclawDeployPoll';

/**
 * 全局保持 OpenClaw 部署任务轮询：离开 OpenClaw 页面后仍会继续直到完成，并弹出结果提示。
 * 「进度暂时拉不到」不再弹 Toast（避免烧录/Windows 忙碌时打断）；仅在真正有结果或长时间失败时由页面内文案说明。
 */
export default function OpenClawDeployPollHost() {
  const { currentDevice } = useDeviceStore();
  const { addToast } = useToastStore();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    syncOpenClawDeployPollFromStorage(currentDevice?.id ?? '');
  }, [currentDevice?.id]);

  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ status: string; error?: string }>).detail;
      const tr = tRef.current;
      if (d.status === 'done') addToast(tr('oc.deployPoll.doneToast', 'OpenClaw 一键部署已完成'), 'success');
      else if (d.status === 'error' && d.error !== 'oc.deployPoll.interrupted') {
        addToast(
          d.error || tr('oc.deployPoll.failToast', 'OpenClaw 部署失败，请查看 OpenClaw 页日志并重试'),
          'error',
        );
      }
    };
    window.addEventListener('rdk-oc-deploy-finished', fn as EventListener);
    return () => window.removeEventListener('rdk-oc-deploy-finished', fn as EventListener);
  }, [addToast]);

  return null;
}
