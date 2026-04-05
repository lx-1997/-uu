import { useToastStore } from '../hooks/useToastStore';
import { useI18n } from '../i18n/use-i18n';

export default function Toasts() {
  const { toasts } = useToastStore();
  const { t } = useI18n();

  if (toasts.length === 0) return null;

  return (
    <div
      className="toast-container"
      role="region"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label={t('toast.regionAriaLabel', '通知')}
    >
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="status">
          <span className="toast-icon" aria-hidden="true">
            {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
