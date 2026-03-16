import { useEffect, useMemo, useState } from 'react';
import { fetchDeviceDiagnostics } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function Hardware() {
  const { currentDevice, addToast } = useAppState();
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');

  const refreshDiagnostics = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setLoading(true);
    fetchDeviceDiagnostics(currentDevice.id)
      .then((res) => {
        setOutput(res.output || '设备返回为空');
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '硬件诊断失败', 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (currentDevice) {
      refreshDiagnostics();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  const lines = useMemo(() => output.split(/\r?\n/).filter(Boolean), [output]);

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📊 硬件状态（真实设备）</div>
        <div className="desc-text">通过 SSH 实时执行诊断命令，不再展示本地模拟数据。</div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
            <span className="card-status-dot"></span>{currentDevice ? `已连接 ${currentDevice.name}` : '未连接设备'}
          </span>
          <button className="clean-btn outline-btn sm-btn" onClick={refreshDiagnostics} disabled={loading || !currentDevice}>
            {loading ? '刷新中...' : '刷新诊断'}
          </button>
        </div>

        <div className="panel-card" style={{ minHeight: 320 }}>
          <div className="panel-title">诊断输出</div>
          <div className="terminal-screen" style={{ minHeight: 260 }}>
            {lines.length === 0 && <div className="terminal-line">{loading ? '正在读取...' : '暂无数据'}</div>}
            {lines.map((line, index) => (
              <div key={`${line}-${index}`} className="terminal-line">{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
