import { useDeviceStore } from '../hooks/useDeviceStore';

export default function DeviceGuard({ children, feature }: { children?: React.ReactNode; feature?: string }) {
  const { currentDevice, setShowAddDevice } = useDeviceStore();

  if (currentDevice) return <>{children}</>;

  return (
    <div className="device-guard">
      <div className="device-guard-card">
        <div className="device-guard-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8" /><path d="M12 17v4" />
            <circle cx="12" cy="10" r="1" />
          </svg>
        </div>
        <h3 className="device-guard-title">
          {feature ? `${feature}需要连接设备` : '请先连接设备'}
        </h3>
        <p className="device-guard-desc">
          连接 RDK 开发板后即可使用{feature ? ` ${feature} ` : '此'}功能。
          支持 SSH 网络和 USB 串口两种连接方式。
        </p>
        <button className="btn btn-primary" onClick={() => setShowAddDevice(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          添加设备
        </button>
      </div>
    </div>
  );
}
