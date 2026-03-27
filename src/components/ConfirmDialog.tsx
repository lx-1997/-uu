import { useUIStore } from '../hooks/useUIStore';
import { useI18n } from '../i18n/use-i18n';

export default function ConfirmDialog() {
  const { confirmDialog, setConfirmDialog } = useUIStore();
  const { t } = useI18n();

  if (!confirmDialog?.show) return null;

  return (
    <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{confirmDialog.title}</div>
        </div>
        <div className="modal-body">{confirmDialog.message}</div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>{t('confirm.cancel', '取消')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>{t('confirm.run', '确认执行')}</button>
        </div>
      </div>
    </div>
  );
}
