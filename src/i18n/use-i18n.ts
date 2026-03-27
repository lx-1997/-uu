import { useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { EN } from './en';

export function useI18n() {
  const { language } = useAppState();
  const isEn = language === 'en';

  const t = useCallback(
    (key: string, zh: string) => {
      if (!isEn) return zh;
      return EN[key] ?? zh;
    },
    [isEn],
  );

  return { t, language, isEn };
}
