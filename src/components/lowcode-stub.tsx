import { useI18n } from '../i18n/use-i18n';
import DeviceGuard from './DeviceGuard';

export default function LowcodeStub() {
  const { t } = useI18n();
  const feature = t('tabs.lowcode', '低代码');
  return (
    <DeviceGuard feature={feature}>
      <div className="page-slot page-enter" style={{ padding: '1.5rem', maxWidth: 640 }}>
        <p className="settings-section-desc" style={{ margin: 0 }}>
          {t('lowcode.placeholder', '可视化流程编排入口即将完善，可先通过终端或 AI Dock 生成工作流。')}
        </p>
      </div>
    </DeviceGuard>
  );
}
