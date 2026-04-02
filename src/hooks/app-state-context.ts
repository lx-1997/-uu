import { createContext } from 'react';

/**
 * Context 必须放在独立模块：与 useAppState 同文件时，Vite HMR 会重新执行 createContext，
 * 得到新的 Context 引用，已挂载树里的 Provider 仍绑在旧引用上，consumer 读到的一直是 null，
 * 从而误报「useAppState must be used within AppProvider」。
 */
export const AppStateContext = createContext<unknown>(null);
