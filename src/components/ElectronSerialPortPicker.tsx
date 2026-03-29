import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/use-i18n';

type SerialPickerPayload = {
  reqId: number;
  ports: Array<{
    portId: string;
    portName: string;
    displayName: string;
    deviceInstanceId?: string;
  }>;
};

/**
 * 仅 Electron：主进程拦截 `select-serial-port` 且端口多于 1 个时展示，列表项含系统 COM 名（如 COM3）。
 */
export default function ElectronSerialPortPicker() {
  const { t } = useI18n();
  const [open, setOpen] = useState<SerialPickerPayload | null>(null);

  useEffect(() => {
    const rdk = window.rdkDesktop;
    if (!rdk?.onSerialPortShowPicker) return;
    return rdk.onSerialPortShowPicker((payload: SerialPickerPayload) => {
      setOpen(payload);
    });
  }, []);

  if (!open) return null;

  const cancel = () => {
    window.rdkDesktop?.sendSerialPortPickerResult?.({ reqId: open.reqId, portId: '' });
    setOpen(null);
  };

  const pick = (portId: string) => {
    window.rdkDesktop?.sendSerialPortPickerResult?.({ reqId: open.reqId, portId });
    setOpen(null);
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 12000 }} onClick={cancel} role="presentation">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title">{t('electron.serialPicker.title', '选择串口')}</div>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {open.ports.map((p) => (
            <button
              key={p.portId}
              type="button"
              className="btn btn-ghost"
              style={{ justifyContent: 'flex-start', textAlign: 'left', flexDirection: 'column', alignItems: 'stretch' }}
              onClick={() => pick(p.portId)}
            >
              <div style={{ fontWeight: 600 }}>{p.portName || p.displayName}</div>
              {p.displayName && p.portName && p.displayName !== p.portName && (
                <div style={{ fontSize: 12, opacity: 0.85 }}>{p.displayName}</div>
              )}
            </button>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            {t('confirm.cancel', '取消')}
          </button>
        </div>
      </div>
    </div>
  );
}
