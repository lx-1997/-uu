import { useAppState } from '../hooks/useAppState';

export default function AddDeviceModal() {
  const {
    showAddDevice, setShowAddDevice, isScanning, scannedDevices,
    newDeviceName, setNewDeviceName, newDeviceIp, setNewDeviceIp,
    scanForDevices, addScannedDevice, addNewDevice,
  } = useAppState();

  if (!showAddDevice) return null;

  return (
    <div className="modal-overlay" onClick={() => setShowAddDevice(false)}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">添加设备</div>
        <div className="modal-desc">手动输入设备信息或扫描局域网自动发现</div>

        <div style={{ marginBottom: '20px' }}>
          <button className="clean-btn" onClick={scanForDevices} disabled={isScanning} style={{ width: '100%' }}>
            {isScanning ? '🔍 扫描中...' : '🔍 扫描局域网'}
          </button>
        </div>

        {isScanning && (
          <div className="scan-animation">
            <div className="scan-dot"></div>
            <div className="scan-dot" style={{ animationDelay: '0.3s' }}></div>
            <div className="scan-dot" style={{ animationDelay: '0.6s' }}></div>
            <span>正在扫描 192.168.1.0/24 网段...</span>
          </div>
        )}

        {scannedDevices.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div className="panel-title">发现的设备</div>
            {scannedDevices.map((dev, i) => (
              <div key={i} className="usage-item selectable" style={{ marginBottom: '8px', cursor: 'pointer' }} onClick={() => addScannedDevice(dev)}>
                <strong>{dev.name}</strong>
                <span>{dev.ip} — 点击添加</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '20px', marginTop: '12px' }}>
          <div className="panel-title">手动添加</div>
          <div className="mini-form">
            <input className="clean-input" placeholder="设备名称 (如 RDK X5 - 工位3)" value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} />
            <input className="clean-input" placeholder="IP 地址 (如 192.168.1.100)" value={newDeviceIp} onChange={e => setNewDeviceIp(e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button className="clean-btn outline-btn" onClick={() => setShowAddDevice(false)}>取消</button>
          <button className="clean-btn" onClick={addNewDevice}>添加设备</button>
        </div>
      </div>
    </div>
  );
}
