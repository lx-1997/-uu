import { useState } from 'react';
import { createPortal } from 'react-dom';
import { getAppVersionShort, RELEASE_NOTES_EN, RELEASE_NOTES_ZH } from '../release-notes';
import { useI18n } from '../i18n/use-i18n';

/** 与 WiFi 配置等一致：遮罩 + 居中 modal-content，Portal 到 body，避免受侧栏布局影响 */
export default function StudioVersionFooter({ railExpanded }: { railExpanded: boolean }) {
  const { t, isEn } = useI18n();
  const [open, setOpen] = useState(false);
  const versionShort = getAppVersionShort();

  const aboutModal =
    open &&
    createPortal(
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="version-modal-title" onClick={() => setOpen(false)}>
        <div className="modal-content version-about-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <div id="version-modal-title" className="modal-title">
                {t('version.modal.title', '关于 RDK Studio')}
              </div>
              <div className="modal-subtitle">{t('version.modal.subtitle', '版本与产品说明')}</div>
            </div>
            <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="modal-body">
            <p className="version-modal-sub">{t('version.modal.features', '产品功能')}</p>
            <ul className="version-modal-list">
              {(isEn ? RELEASE_NOTES_EN : RELEASE_NOTES_ZH).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="modal-footer version-about-modal-footer">
            <span className="version-modal-build version-modal-build--footer mono" translate="no">
              {versionShort}
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
              {isEn ? 'OK' : '关闭'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        type="button"
        className="rail-version-btn"
        data-tooltip={!railExpanded ? t('rail.version.tooltip', '关于 RDK Studio') : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="rail-version-text mono" translate="no">
          {versionShort}
        </span>
        {!railExpanded && <span className="sr-only">{t('rail.version.open', '打开关于')}</span>}
      </button>

      {aboutModal}
    </>
  );
}
