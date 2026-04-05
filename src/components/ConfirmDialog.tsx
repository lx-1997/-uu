import { useUIStore } from '../hooks/useUIStore';
import { useI18n } from '../i18n/use-i18n';

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function ConfirmDialog() {
  const { confirmDialog, setConfirmDialog } = useUIStore();
  const { t } = useI18n();

  if (!confirmDialog?.show) return null;

  const isDanger = confirmDialog.variant === 'danger';
  const confirmText = confirmDialog.confirmLabel?.trim()
    || t('confirm.run', '确认执行');

  const dismissWithoutConfirm = () => {
    confirmDialog.onDismiss?.();
    setConfirmDialog(null);
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={dismissWithoutConfirm}>
      <div
        className={`modal-content confirm-dialog ${isDanger ? 'confirm-dialog--danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="confirm-dialog-close"
          aria-label={t('confirm.close', '关闭')}
          onClick={dismissWithoutConfirm}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className={`confirm-dialog-body ${isDanger ? 'confirm-dialog-body--danger' : ''}`}>
          {isDanger && (
            <div className="confirm-dialog-icon-wrap" aria-hidden="true">
              <WarningIcon className="confirm-dialog-icon" />
            </div>
          )}
          <div className="confirm-dialog-copy">
            <h2 id="confirm-dialog-title" className="confirm-dialog-title">
              {confirmDialog.title}
            </h2>
            <p id="confirm-dialog-desc" className="confirm-dialog-message">
              {confirmDialog.message}
            </p>
          </div>
        </div>

        <div
          className="modal-footer confirm-dialog-footer"
          style={confirmDialog.hideCancel ? { justifyContent: 'flex-end' } : undefined}
        >
          {!confirmDialog.hideCancel && (
            <button type="button" className="btn btn-ghost" onClick={dismissWithoutConfirm}>
              {t('confirm.cancel', '取消')}
            </button>
          )}
          <button
            type="button"
            className={isDanger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => {
              confirmDialog.onConfirm();
              setConfirmDialog(null);
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
