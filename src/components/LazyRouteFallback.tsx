import { translate } from '../i18n/translate';
import { readStoredLocale } from '../utils/locale';

/**
 * 懒加载 Tab 占位。不得使用依赖 AppStateContext 的 hook：
 * Suspense fallback 在部分并发路径下可能拿不到上层 Context。
 */
export default function LazyRouteFallback() {
  const isEn = readStoredLocale() === 'en';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '52vh',
        gap: 12,
        color: 'var(--text-muted)',
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'rdk-boot-spin 0.75s linear infinite',
        }}
        aria-hidden
      />
      <span>{translate(isEn, 'route.fallbackLoading', '加载页面…')}</span>
    </div>
  );
}
