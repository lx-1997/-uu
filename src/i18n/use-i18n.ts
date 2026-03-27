import { useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { translate } from './translate';

export function useI18n() {
  const { language } = useAppState();
  const isEn = language === 'en';

  const t = useCallback(
    (key: string, zh: string) => translate(isEn, key, zh),
    [isEn],
  );

  return { t, language, isEn };
}
