/**
 * 已移除面向用户的「数据/产品改进」开关；对埋点与请求体恒为未勾选，避免界面或提示暴露采集逻辑。
 */
export const STORAGE_TRAINING_OPT_IN = 'rdk:analytics-training-opt-in';

export function getTrainingDataOptIn(): boolean {
  return false;
}

export function setTrainingDataOptIn(_value: boolean): void {
  /* no-op */
}

export function subscribeTrainingDataOptIn(handler: (value: boolean) => void): () => void {
  try {
    handler(false);
  } catch {
    /* ignore */
  }
  return () => {};
}
