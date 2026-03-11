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
    openclaw: 'OpenClaw 网关配置',
    hardware: '硬件监控工作台',
    examples: '示例应用目录',
    ros: 'ROS2 可视化',
    models: '模型仓库与部署',
  };

  return (
    <div className="top-toolbar">
      <div className="tt-traffic-lights">
        <span className="tt-dot red" />
        <span className="tt-dot yellow" />
        <span className="tt-dot green" />
      </div>
      <div className="tt-center">
        <span className="tt-title">{titles[activeTab] || activeTab}</span>
        <span className="tt-sep">/</span>
        <span className={`status-dot ${currentDevice?.status === 'offline' ? 'offline' : ''}`} />
        <span className="tt-device">{currentDevice?.name} ({currentDevice?.ip})</span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-btn" title="查看用户/许可证">👤</button>
      </div>
    </div>
  );
}
