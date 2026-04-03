import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type HubDockAnchorContextValue = {
  /** 右栏挂载点（仅 AI 对话页设置） */
  hubAnchorEl: HTMLElement | null;
  setHubAnchorEl: (el: HTMLElement | null) => void;
  /** 主窗口默认 Portal 容器（content-area 内占位，保证 Dock 始终 Portal 到稳定节点） */
  defaultHostNode: HTMLDivElement | null;
};

const HubDockAnchorContext = createContext<HubDockAnchorContextValue | null>(null);

export function HubDockAnchorProvider({ children }: { children: ReactNode }) {
  const [hubAnchorEl, setHubAnchorElState] = useState<HTMLElement | null>(null);
  const [defaultHostNode, setDefaultHostNode] = useState<HTMLDivElement | null>(null);

  const setHubAnchorEl = useCallback((el: HTMLElement | null) => {
    setHubAnchorElState((prev) => (prev === el ? prev : el));
  }, []);

  const onDefaultHostRef = useCallback((el: HTMLDivElement | null) => {
    setDefaultHostNode((prev) => (prev === el ? prev : el));
  }, []);

  const value = useMemo(
    () => ({ hubAnchorEl, setHubAnchorEl, defaultHostNode }),
    [hubAnchorEl, setHubAnchorEl, defaultHostNode],
  );

  return (
    <HubDockAnchorContext.Provider value={value}>
      {children}
      {/*
        放在 children 之后，使占位层叠在主内容之上（与原先 AIDock 在 MainContent 后一致），
        避免全屏 fixed Dock 被页面挡住。
      */}
      <div ref={onDefaultHostRef} className="dock-portal-default-host" aria-hidden />
    </HubDockAnchorContext.Provider>
  );
}

export function useHubDockAnchor(): HubDockAnchorContextValue {
  const ctx = useContext(HubDockAnchorContext);
  if (!ctx) {
    return {
      hubAnchorEl: null,
      setHubAnchorEl: () => {},
      defaultHostNode: null,
    };
  }
  return ctx;
}
