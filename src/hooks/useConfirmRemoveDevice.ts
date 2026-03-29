import { useCallback } from 'react';
import type { Device } from '../app-types';
import { useAppState } from './useAppState';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';

/**
 * 与平台 ConfirmDialog 一致：删除设备前确认（danger 样式），避免 window.confirm / Electron 原生框。
 */
export function useConfirmRemoveDevice() {
  const { removeDevice, showConfirm } = useAppState();
  const { t } = useI18n();
  const tf = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );

  return useCallback(
    (dev: Pick<Device, 'id' | 'name'>) => {
      showConfirm(
        t('confirm.removeDeviceTitle', '删除设备'),
        tf('confirm.removeDeviceMsg', '确定要删除设备「{{name}}」吗？移除后可随时重新添加。', { name: dev.name }),
        () => removeDevice(dev.id),
        { variant: 'danger', confirmLabel: t('confirm.remove', '删除') },
      );
    },
    [removeDevice, showConfirm, t, tf],
  );
}
