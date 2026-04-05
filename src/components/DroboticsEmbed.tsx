import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';

/**
 * 桌面端：forum / RoboGo 在主窗口 WebContentsView 中展示（与 VNC/IDE 同 content-area 几何）。
 * 实际网页由 Electron 主进程挂载；此处仅占位条与关闭，避免误点穿透。
 */
export default function DroboticsEmbed() {
  const { drAuthenticatedPortal, closeDrAuthenticatedPortal } = useAppState();
  const { t } = useI18n();

  if (!drAuthenticatedPortal) {
    return (
      <div className="page-slot" style={{ padding: 24, color: 'var(--text-muted)' }}>
        {t('drPortal.empty', '正在准备页面…')}
      </div>
    );
  }

  const title =
    drAuthenticatedPortal.kind === 'forum'
      ? t('rail.forum.short', '地瓜开发者论坛')
      : t('sidebar.footer.robogo', 'RoboGo 云平台');

  return (
    <div
      className="page-slot drobotics-embed-host"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <div
        className="drobotics-embed-toolbar"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
          background: 'var(--surface-elevated, var(--bg-panel))',
        }}
      >
        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{title}</span>
        <button type="button" className="clean-btn outline-btn btn-sm" onClick={closeDrAuthenticatedPortal}>
          {t('drPortal.close', '关闭')}
        </button>
      </div>
      <div
        aria-hidden
        style={{ flex: 1, minHeight: 200, background: 'var(--surface)', position: 'relative' }}
      />
    </div>
  );
}
