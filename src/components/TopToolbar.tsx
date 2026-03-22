import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import WifiConfigModal from './wifi/WifiConfigModal';

const TAB_META: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  dashboard: {
    eyebrow: 'Workspace',
    title: 'RDK 工作台',
    subtitle: '设备概览、新手流程、OpenClaw 就绪态与日常入口',
  },
  flasher: {
    eyebrow: 'Delivery',
    title: '烧录与备份',
    subtitle: '像 Rufus / balenaEtcher 一样完成镜像写入、校验与备份',
  },
  terminal: {
    eyebrow: 'Control',
    title: '终端控制台',
    subtitle: '直连设备执行命令、排查问题并观察实时输出',
  },
  files: {
    eyebrow: 'Control',
    title: '文件工作区',
    subtitle: '远程浏览、编辑、上传与下载设备文件',
  },
  vnc: {
    eyebrow: 'Control',
    title: '远程桌面',
    subtitle: '在图形界面中操作板端，适合桌面化调试',
  },
  ide: {
    eyebrow: 'Build',
    title: '代码编辑',
    subtitle: '基于 code-server 的远程开发空间',
  },
  openclaw: {
    eyebrow: 'AI Runtime',
    title: 'OpenClaw 中心',
    subtitle: '模型、渠道、技能和网关运行态统一配置',
  },
  hardware: {
    eyebrow: 'Observe',
    title: '硬件监控',
    subtitle: 'CPU、BPU、温度、内存与磁盘健康态总览',
  },
  examples: {
    eyebrow: 'Ecosystem',
    title: 'NodeHub 应用',
    subtitle: '官方示例与应用编排入口',
  },
  ros: {
    eyebrow: 'Robotics',
    title: 'ROS 可视化',
    subtitle: 'Rosbridge、Webviz 与机器人链路排障',
  },
  models: {
    eyebrow: 'AI Runtime',
    title: 'ModelZoo 模型仓',
    subtitle: '模型部署、运行状态与板端同步',
  },
  skills: {
    eyebrow: 'AI Runtime',
    title: '技能与策略中心',
    subtitle: '技能目录、调用能力、审批与联网策略',
  },
};

export default function TopToolbar() {
  const { activeTab, currentDevice, setShowSettings } = useAppState();
  const [copied, setCopied] = useState(false);
  const [showWifiModal, setShowWifiModal] = useState(false);
  const meta = TAB_META[activeTab] ?? {
    eyebrow: 'Workspace',
    title: activeTab,
    subtitle: '当前页面',
  };
  const deviceOnline = !!currentDevice && currentDevice.status !== 'offline' && currentDevice.status !== 'disconnected';

  const handleCopyIp = () => {
    if (currentDevice?.ip) {
      navigator.clipboard.writeText(currentDevice.ip);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div className="top-toolbar">
        <div className="tt-context">
          <div className="tt-title-stack">
            <span className="tt-eyebrow">{meta.eyebrow}</span>
            <div className="tt-heading-row">
              <span className="tt-title">{meta.title}</span>
              <span className={`tt-status-chip ${deviceOnline ? 'online' : ''}`}>
                <span className={`status-dot ${deviceOnline ? '' : 'offline'}`}></span>
                {currentDevice ? (deviceOnline ? '设备在线' : '设备待连接') : '未选择设备'}
              </span>
            </div>
            <span className="tt-subtitle">{meta.subtitle}</span>
          </div>
        </div>

        <div className="toolbar-actions">
          <button
            className="tt-chip-btn"
            title={currentDevice?.ip ? '点击复制设备 IP' : '当前没有可复制的设备 IP'}
            onClick={handleCopyIp}
            disabled={!currentDevice?.ip}
          >
            <span className="material-symbols-outlined">dns</span>
            <span className="tt-chip-copy">
              <strong>{currentDevice?.name || '未连接设备'}</strong>
              <span>{currentDevice?.ip || '请先连接设备'}</span>
            </span>
            <span className="material-symbols-outlined tt-chip-trailing">
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>

          <button
            className="icon-btn"
            title="配置 WiFi"
            onClick={() => setShowWifiModal(true)}
            disabled={!currentDevice}
          >
            <span className="material-symbols-outlined">network_wifi</span>
          </button>

          <button className="icon-btn" title="打开设置" onClick={() => setShowSettings(true)}>
            <span className="material-symbols-outlined">tune</span>
          </button>
        </div>
      </div>
      {showWifiModal && <WifiConfigModal onClose={() => setShowWifiModal(false)} />}
    </>
  );
}
