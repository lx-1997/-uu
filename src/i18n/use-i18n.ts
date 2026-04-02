import { useCallback, useContext } from 'react';
import { AppStateContext } from '../hooks/app-state-context';
import type { AppState } from '../hooks/useAppState';
import { translate } from './translate';

export function useI18n() {
  const ctx = useContext(AppStateContext) as AppState | null;
  const language = ctx?.language ?? 'zh';
  const isEn = language === 'en';

  const t = useCallback(
    (key: string, zh: string) => translate(isEn, key, zh),
    [isEn],
  );

  return { t, language, isEn };
}
