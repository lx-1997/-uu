import { useEffect, useRef } from 'react';
import { useUIStore } from '../hooks/useUIStore';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';

const COOLDOWN_MS = 45_000;

/**
 * 监听「已验证过的设备经多轮 ping + 额外可达性确认后标为离线」事件，对当前选中设备弹窗提示。
 */
export default function DeviceOfflineListener() {
  const { setConfirmDialog } = useUIStore();
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);
  const lastModalAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ deviceId?: string; deviceName?: string }>;
      const deviceId = String(ce.detail?.deviceId || '').trim();
      const deviceName = String(ce.detail?.deviceName || '').trim() || deviceId;
      if (!deviceId) return;
      const now = Date.now();
      const last = lastModalAtRef.current[deviceId] ?? 0;
      if (now - last < COOLDOWN_MS) return;
      lastModalAtRef.current[deviceId] = now;

      setConfirmDialog({
        show: true,
        title: t('device.offlineModal.title', '当前开发板已离线'),
        message: tf('device.offlineModal.body', '已对连接进行多次检测，当前开发板「{{name}}」无法建立 SSH 会话。请检查电源、网线或 TypeC 连接后，在侧栏重新连接开发板。', {
          name: deviceName,
        }),
        hideCancel: true,
        variant: 'default',
        confirmLabel: t('device.offlineModal.ok', '我知道了'),
        onConfirm: () => {},
      });
    };
    window.addEventListener('rdk-device-offline-confirmed', handler);
    return () => window.removeEventListener('rdk-device-offline-confirmed', handler);
  }, [setConfirmDialog, t, tf]);

  return null;
}
