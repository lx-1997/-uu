import React, { createContext, useContext, useRef, useState } from 'react';
import type { Toast, Activity } from '../app-types';

export interface ToastStoreState {
  toasts: Toast[];
  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  activities: Activity[];
  addActivity: (text: string) => void;
}

const ToastContext = createContext<ToastStoreState | null>(null);

export function useToastStore(): ToastStoreState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastStore must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);

  const addToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  };

  const [activities, setActivities] = useState<Activity[]>([
    { id: 1, text: '系统就绪，RDK Studio 启动完成', time: '刚刚' },
    { id: 2, text: '等待连接真实设备', time: '1 分钟前' },
    { id: 3, text: '可通过设备管理添加 RDK 开发板', time: '2 分钟前' },
  ]);

  const addActivity = (text: string) => {
    setActivities((prev) => [{ id: Date.now(), text, time: '刚刚' }, ...prev].slice(0, 10));
  };

  const value: ToastStoreState = { toasts, addToast, activities, addActivity };

  return React.createElement(ToastContext.Provider, { value }, children);
}
