import { useAppState } from '../hooks/useAppState';

export default function ConfirmDialog() {
  const { confirmDialog, setConfirmDialog } = useAppState();

  if (!confirmDialog?.show) return null;

  return (
    <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{confirmDialog.title}</div>
        </div>
        <div className="modal-body">{confirmDialog.message}</div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>取消</button>
          <button className="btn btn-primary" onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>确认执行</button>
        </div>
      </div>
    </div>
  );
}
