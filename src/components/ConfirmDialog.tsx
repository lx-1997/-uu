import { useAppState } from '../hooks/useAppState';

export default function ConfirmDialog() {
  const { confirmDialog, setConfirmDialog } = useAppState();

  if (!confirmDialog?.show) return null;

  return (
    <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{confirmDialog.title}</div>
        <div className="modal-desc">{confirmDialog.message}</div>
        <div className="modal-actions">
          <button className="clean-btn outline-btn" onClick={() => setConfirmDialog(null)}>取消</button>
          <button className="clean-btn" style={{ background: '#ef4444' }} onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>确认执行</button>
        </div>
      </div>
    </div>
  );
}
