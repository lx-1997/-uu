import { useCallback, useContext } from 'react';
import { AppStateContext } from '../hooks/useAppState';
import { translate } from './translate';

export function useI18n() {
  const ctx = useContext(AppStateContext);
  const language = ctx?.language ?? 'zh';
  const isEn = language === 'en';

  const t = useCallback(
    (key: string, zh: string) => translate(isEn, key, zh),
    [isEn],
  );

  return { t, language, isEn };
}
