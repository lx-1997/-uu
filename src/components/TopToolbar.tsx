import { useAppState } from '../hooks/useAppState';

export default function TopToolbar() {
  const { activeTab, currentDevice } = useAppState();

  const titles: Record<string, string> = {
    dashboard: 'AI Copilot 工作台',
    flasher: '系统镜像工具',
    terminal: '终端环境',
    files: '文件管理器 (SFTP)',
    vnc: '可视化桌面 (VNC)',
    lowcode: '流程编排',
    ide: '代码编辑 · code-server',
    openclaw: 'OpenClaws 网关配置',
    hardware: '硬件监控工作台',
    examples: '示例应用目录',
    ros: 'ROS2 可视化',
    models: '模型仓库与部署',
  };

  return (
    <div className="top-toolbar" style={{ height: '48px', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: '8px', marginRight: '20px' }}>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f87171' }}></div>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#facc15' }}></div>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#4ade80' }}></div>
      </div>
      <div className="context-title" style={{ flex: 1, justifyContent: 'center' }}>
        {titles[activeTab] || activeTab}
        <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 'normal', display: 'inline-flex', alignItems: 'center', marginLeft: '10px' }}>
          <span style={{ margin: '0 6px' }}>/</span>
          <span className={`status-dot ${currentDevice?.status === 'offline' ? 'offline' : ''}`} style={{ marginRight: '6px', width: '6px', height: '6px' }}></span>
          {currentDevice?.name} ({currentDevice?.ip})
        </span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-btn" title="查看用户/许可证">👤</button>
      </div>
    </div>
  );
}
