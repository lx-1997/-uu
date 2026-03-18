/**
 * 应用模式工具函数
 * 用于在主进程中统一管理应用模式（test/prod）
 */

/**
 * 获取当前应用模式
 * @returns {string} 'test' 或 'prod'，默认为 'prod'
 */
export function getAppMode() {
  if (process?.env?.APP_MODE) {
    const mode = process.env.APP_MODE.toLowerCase();
    return (mode === 'test' || mode === 'prod') ? mode : 'prod';
  }
  return 'prod';
}

/**
 * 判断是否为测试模式
 * @returns {boolean}
 */
export function isTestMode() {
  return getAppMode() === 'test';
}

/**
 * 判断是否为生产模式
 * @returns {boolean}
 */
export function isProdMode() {
  return getAppMode() === 'prod';
}

/**
 * 根据模式执行不同的函数
 * @param {Object} handlers - 包含 test 和 prod 函数的对象
 * @param {Function} handlers.test - 测试模式下执行的函数
 * @param {Function} handlers.prod - 生产模式下执行的函数
 */
export function runByMode(handlers) {
  const mode = getAppMode();
  if (mode === 'test' && typeof handlers.test === 'function') {
    handlers.test();
  } else if (mode === 'prod' && typeof handlers.prod === 'function') {
    handlers.prod();
  }
}















