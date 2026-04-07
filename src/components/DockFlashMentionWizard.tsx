import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Tab } from '../app-types';
import {
  FLASHER_MENTION_SESSION_KEY,
  type FlasherMentionContext,
} from '../constants/dock-mention-capabilities';

type WizardStep = 0 | 1 | 2;

const DEVICE_CHOICES: Array<{ key: string; nameZh: string; nameEn: string }> = [
  { key: 'x3', nameZh: 'RDK X3', nameEn: 'RDK X3' },
  { key: 'x5', nameZh: 'RDK X5', nameEn: 'RDK X5' },
  { key: 's100', nameZh: 'RDK S100(P)', nameEn: 'RDK S100(P)' },
  { key: 'x3-module', nameZh: 'RDK X3 Module (TF)', nameEn: 'RDK X3 Module (TF)' },
  { key: 'x5-module', nameZh: 'RDK X5 Module (TF)', nameEn: 'RDK X5 Module (TF)' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  setActiveTab: (tab: Tab) => void;
  addToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
  t: (key: string, zh: string) => string;
  isEn: boolean;
};

export function DockFlashMentionWizard({
  open,
  onClose,
  setActiveTab,
  addToast,
  t,
  isEn,
}: Props) {
  const [step, setStep] = useState<WizardStep>(0);
  const [deviceKey, setDeviceKey] = useState('x5');
  const [preferLocalImage, setPreferLocalImage] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDeviceKey('x5');
    setPreferLocalImage(false);
  }, [open]);

  const deviceLabel = useCallback(
    (key: string) => {
      const row = DEVICE_CHOICES.find((d) => d.key === key);
      if (!row) return key;
      return isEn ? row.nameEn : row.nameZh;
    },
    [isEn],
  );

  const summaryLines = useMemo(() => {
    const src = preferLocalImage
      ? t('dock.mention.flash.srcLocal', '本地镜像文件')
      : t('dock.mention.flash.srcOfficial', '官方推荐镜像（向导内可再选版本）');
    return [
      `${t('dock.mention.flash.summaryDevice', '设备')}: ${deviceLabel(deviceKey)}`,
      `${t('dock.mention.flash.summarySource', '镜像')}: ${src}`,
    ];
  }, [deviceKey, preferLocalImage, deviceLabel, t]);

  const finish = useCallback(() => {
    const payload: FlasherMentionContext = {
      deviceKey,
      preferLocalImage,
    };
    try {
      sessionStorage.setItem(FLASHER_MENTION_SESSION_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
    setActiveTab('flasher');
    addToast(t('dock.mention.flash.toastOpened', '已打开镜像烧写向导'), 'success');
    onClose();
  }, [addToast, deviceKey, onClose, preferLocalImage, setActiveTab, t]);

  if (!open) return null;

  return (
    <div className="dock-flash-wizard-overlay" onClick={onClose} role="presentation">
      <div
        className="dock-flash-wizard"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="dock-flash-wizard-title"
      >
        <div className="dock-flash-wizard-header">
          <h2 id="dock-flash-wizard-title" className="dock-flash-wizard-title">
            {t('dock.mention.flash.title', '烧写向导')}
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t('dock.task.closeTitle', '关闭')}>
            ×
          </button>
        </div>
        <div className="dock-flash-wizard-steps">
          <span className={step === 0 ? 'active' : ''}>1. {t('dock.mention.flash.stepDevice', '设备')}</span>
          <span className={step === 1 ? 'active' : ''}>2. {t('dock.mention.flash.stepSource', '镜像来源')}</span>
          <span className={step === 2 ? 'active' : ''}>3. {t('dock.mention.flash.stepConfirm', '确认')}</span>
        </div>

        {step === 0 && (
          <div className="dock-flash-wizard-body">
            <p className="dock-flash-wizard-hint">{t('dock.mention.flash.hintDevice', '请选择要烧写的硬件型号（与镜像烧写页一致）。')}</p>
            <div className="dock-flash-wizard-grid">
              {DEVICE_CHOICES.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`dock-flash-wizard-card ${deviceKey === d.key ? 'selected' : ''}`}
                  onClick={() => setDeviceKey(d.key)}
                >
                  {isEn ? d.nameEn : d.nameZh}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="dock-flash-wizard-body">
            <p className="dock-flash-wizard-hint">{t('dock.mention.flash.hintSource', '选择镜像获取方式；本地文件需后在烧写页中选择路径。')}</p>
            <div className="dock-flash-wizard-source">
              <button
                type="button"
                className={`dock-flash-wizard-option ${!preferLocalImage ? 'selected' : ''}`}
                onClick={() => setPreferLocalImage(false)}
              >
                <span className="dock-flash-wizard-option-title">{t('dock.mention.flash.optOfficial', '官方目录')}</span>
                <span className="dock-flash-wizard-option-desc">{t('dock.mention.flash.optOfficialDesc', '在烧写页从官方列表选择版本（S100 多为 product.zip / xburn）。')}</span>
              </button>
              <button
                type="button"
                className={`dock-flash-wizard-option ${preferLocalImage ? 'selected' : ''}`}
                onClick={() => setPreferLocalImage(true)}
              >
                <span className="dock-flash-wizard-option-title">{t('dock.mention.flash.optLocal', '本地镜像')}</span>
                <span className="dock-flash-wizard-option-desc">{t('dock.mention.flash.optLocalDesc', '在烧写页浏览或填写本机 .img / .xz / .gz / .zip 等路径。')}</span>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="dock-flash-wizard-body">
            <p className="dock-flash-wizard-hint">{t('dock.mention.flash.hintConfirm', '将打开「镜像烧写」页并带上你的选择；仍可在该页继续调整。')}</p>
            <ul className="dock-flash-wizard-summary">
              {summaryLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="dock-flash-wizard-footer">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s))}>
              {t('flasher.btn.back', '← 上一步')}
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep((s) => (s < 2 ? ((s + 1) as WizardStep) : s))}>
              {t('dock.mention.flash.next', '下一步')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish}>
              {t('dock.mention.flash.openFlasher', '打开烧写页')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
