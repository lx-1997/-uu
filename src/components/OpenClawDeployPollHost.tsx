import { useEffect } from 'react';
import { useDeviceStore } from '../hooks/useDeviceStore';
import { useToastStore } from '../hooks/useToastStore';
import { syncOpenClawDeployPollFromStorage } from '../utils/openclawDeployPoll';

/**
 * 全局保持 OpenClaw 部署任务轮询：离开 OpenClaw 页面后仍会继续直到完成，并弹出结果提示。
 */
export default function OpenClawDeployPollHost() {
  const { currentDevice } = useDeviceStore();
  const { addToast } = useToastStore();

  useEffect(() => {
    syncOpenClawDeployPollFromStorage(currentDevice?.id ?? '');
  }, [currentDevice?.id]);

  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ status: string; error?: string }>).detail;
      if (d.status === 'done') addToast('OpenClaw 一键部署已完成', 'success');
      else if (d.status === 'error') addToast(d.error || 'OpenClaw 部署失败', 'error');
    };
    window.addEventListener('rdk-oc-deploy-finished', fn as EventListener);
    return () => window.removeEventListener('rdk-oc-deploy-finished', fn as EventListener);
  }, [addToast]);

  return null;
}
