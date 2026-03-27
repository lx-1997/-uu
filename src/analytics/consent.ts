/**
 * 「用于模型与产品改进」开关：与匿名行为埋点分离；无论开/关都会随批次上报 consent。
 * localStorage key：rdk:analytics-training-opt-in
 */

export const STORAGE_TRAINING_OPT_IN = 'rdk:analytics-training-opt-in';

const CHANGE_EVENT = 'rdk-training-opt-in-change';

export function getTrainingDataOptIn(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_TRAINING_OPT_IN) === '1';
  } catch {
    return false;
  }
}

/** 写入并通知同页组件同步；不关闭埋点总开关 */
export function setTrainingDataOptIn(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_TRAINING_OPT_IN, value ? '1' : '0');
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { value } }));
  } catch {
    /* ignore */
  }
}

export function subscribeTrainingDataOptIn(handler: (value: boolean) => void): () => void {
  const fn = () => handler(getTrainingDataOptIn());
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}
