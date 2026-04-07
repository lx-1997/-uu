import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Tab } from '../app-types';

const FLASHER_MENTION_SESSION_KEY = 'rdk:flasher:mention-context';

type FlasherMentionContext = {
  deviceKey: string;
  preferLocalImage: boolean;
};

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
      ? t('dock.mention.flash.srcLocal', 'Local image file')
      : t('dock.mention.flash.srcOfficial', 'Official recommended image');
    return [
      `${t('dock.mention.flash.summaryDevice', 'Device')}: ${deviceLabel(deviceKey)}`,
      `${t('dock.mention.flash.summarySource', 'Image')}: ${src}`,
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
    addToast(t('dock.mention.flash.toastOpened', 'Flasher wizard opened'), 'success');
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
            {t('dock.mention.flash.title', 'Flasher wizard')}
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t('dock.task.closeTitle', 'Close')}>
            
          </button>
        </div>
        <div className="dock-flash-wizard-steps">
          <span className={step === 0 ? 'active' : ''}>1. {t('dock.mention.flash.stepDevice', 'Device')}</span>
          <span className={step === 1 ? 'active' : ''}>2. {t('dock.mention.flash.stepSource', 'Image source')}</span>
          <span className={step === 2 ? 'active' : ''}>3. {t('dock.mention.flash.stepConfirm', 'Confirm')}</span>
        </div>

        {step === 0 && (
          <div className="dock-flash-wizard-body">
            <p className="dock-flash-wizard-hint">{t('dock.mention.flash.hintDevice', 'Choose the hardware model to flash.')}</p>
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
            <p className="dock-flash-wizard-hint">{t('dock.mention.flash.hintSource', 'Choose how the image will be provided.')}</p>
            <div className="dock-flash-wizard-source">
              <button
                type="button"
                className={`dock-flash-wizard-option ${!preferLocalImage ? 'selected' : ''}`}
                onClick={() => setPreferLocalImage(false)}
              >
                <span className="dock-flash-wizard-option-title">{t('dock.mention.flash.optOfficial', 'Official catalog')}</span>
                <span className="dock-flash-wizard-option-desc">{t('dock.mention.flash.optOfficialDesc', 'Pick a recommended release in the flasher page.')}</span>
              </button>
              <button
                type="button"
                className={`dock-flash-wizard-option ${preferLocalImage ? 'selected' : ''}`}
                onClick={() => setPreferLocalImage(true)}
              >
                <span className="dock-flash-wizard-option-title">{t('dock.mention.flash.optLocal', 'Local image')}</span>
                <span className="dock-flash-wizard-option-desc">{t('dock.mention.flash.optLocalDesc', 'Browse to a local .img, .xz, .gz, or .zip file in the flasher page.')}</span>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="dock-flash-wizard-body">
            <p className="dock-flash-wizard-hint">{t('dock.mention.flash.hintConfirm', 'The flasher page will open with these choices prefilled.')}</p>
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
              {t('flasher.btn.back', 'Back')}
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep((s) => (s < 2 ? ((s + 1) as WizardStep) : s))}>
              {t('dock.mention.flash.next', 'Next')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish}>
              {t('dock.mention.flash.openFlasher', 'Open flasher')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
