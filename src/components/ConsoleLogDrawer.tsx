import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/use-i18n';
import { clearConsoleLogs, openConsoleLogWindowPreferred, useConsoleLogLines } from '../utils/console-log-capture';

function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    const t = d.toLocaleTimeString(undefined, { hour12: false });
    const sub = String(d.getMilliseconds()).padStart(3, '0');
    return `${t}.${sub}`;
  } catch {
    return '';
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onPopupBlocked?: () => void;
};

export default function ConsoleLogDrawer({ open, onClose, onPopupBlocked }: Props) {
  const { t } = useI18n();
  const lines = useConsoleLogLines();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !bodyRef.current) return;
    const el = bodyRef.current;
    el.scrollTop = el.scrollHeight;
  }, [open, lines]);

  if (!open) return null;

  const handlePopup = () => {
    void openConsoleLogWindowPreferred().then(({ ok }) => {
      if (!ok && onPopupBlocked) onPopupBlocked();
    });
  };

  return (
    <div
      className="immersive-logs immersive-console-logs"
      role="complementary"
      aria-label={t('terminal.console.aria', '前端控制台日志')}
    >
      <div className="immersive-logs-head">
        <span>{t('terminal.console.title', '前端控制台')}</span>
        <div className="immersive-console-logs-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => clearConsoleLogs()}
          >
            {t('terminal.console.clear', '清空')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handlePopup}
          >
            {t('terminal.console.popup', '客户端窗口')}
          </button>
          <button
            type="button"
            className="btn-icon immersive-console-logs-close"
            title={t('terminal.console.close', '关闭')}
            aria-label={t('terminal.console.close', '关闭')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div className="immersive-logs-body immersive-console-logs-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="immersive-console-log-empty">
            {t(
              'terminal.console.empty',
              '暂无日志。console 输出、闪连 TypeC 步骤等会显示在此；桌面版可用「客户端窗口」打开原生日志窗。',
            )}
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={`immersive-console-line immersive-console-line--${line.level}`}
            >
              <span className="immersive-console-ts">{formatTime(line.ts)}</span>
              <span className="immersive-console-lvl">{`[${line.level}]`}</span>
              <span className="immersive-console-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
