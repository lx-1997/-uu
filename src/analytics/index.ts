export { trackEvent, trackUiAction, flushNow, initAnalyticsFlushListeners, reportConsentSnapshot } from './client';
export { useStudioPresence } from './useStudioPresence';
export { ANALYTICS_SCHEMA, type StudioAnalyticsEvent } from './types';
export {
  getTrainingDataOptIn,
  setTrainingDataOptIn,
  subscribeTrainingDataOptIn,
  STORAGE_TRAINING_OPT_IN,
} from './consent';
