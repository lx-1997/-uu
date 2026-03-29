import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { Device } from '../app-types';
import {
  connectDevice,
  checkDevicePing,
  fetchDevices,
  fetchDeviceDiagnostics,
  forgetDevicePassword,
  rememberDevicePassword,
  removeDevice as removeDeviceApi,
} from '../api';
import { diagnosticsOutputImpliesReachable } from '../utils/diagnostics';
import { isDeviceSshConnected } from '../utils/device-connection';
import { useToastStore } from './useToastStore';
import { useAuth } from './useAuth';

/** 后台 ping 连续失败多少次后才将设备标为离线，减轻偶发网络抖动导致的「在线/离线」闪烁 */
const PING_FAILS_BEFORE_OFFLINE = 3;

const DEVICES_CACHE_KEY = 'rdk-studio-devices-cache-v1';

type DevicesCacheV1 = { v: 1; devices: Device[]; activeDevice: string };

function loadDevicesFromCache(): DevicesCacheV1 | null {
  try {
    const raw = localStorage.getItem(DEVICES_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as DevicesCacheV1;
    if (o?.v !== 1 || !Array.isArray(o.devices)) return null;
    return o;
  } catch {
    return null;
  }
}

function saveDevicesToCache(deviceList: Device[], activeId: string) {
  try {
    if (deviceList.length === 0) {
      localStorage.removeItem(DEVICES_CACHE_KEY);
      return;
    }
    const payload: DevicesCacheV1 = { v: 1, devices: deviceList, activeDevice: activeId };
    localStorage.setItem(DEVICES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export interface DeviceStoreState {
  activeDevice: string;
  setActiveDevice: (id: string) => void;
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  currentDevice: Device | undefined;

  showAddDevice: boolean;
  setShowAddDevice: (v: boolean) => void;
  newDeviceName: string;
  setNewDeviceName: (v: string) => void;
  newDeviceIp: string;
  setNewDeviceIp: (v: string) => void;
  isScanning: boolean;
  scannedDevices: Array<{ name: string; ip: string }>;
  scanForDevices: () => void;
  addNewDevice: (payload?: { host: string; port?: number; username: string; password: string; name?: string }) => void;
  addScannedDevice: (dev: { name: string; ip: string }) => void;
  removeDevice: (id: string) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

const DeviceContext = createContext<DeviceStoreState | null>(null);

export function useDeviceStore(): DeviceStoreState {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDeviceStore must be used within DeviceProvider');
  return ctx;
}

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { addToast, addActivity } = useToastStore();
  const { user, ssoRequired, loading: authLoading } = useAuth();
  /**
   * 与后端 ssoAuthMiddleware 一致：仅 SSO_REQUIRED=1 时 API 才强制会话。
   * 若用 (ssoEnabled || ssoRequired) 会把「已配置 OAuth 但未强制」的访客永远挡在设备拉取之外。
   */
  const authReady = !authLoading && (!ssoRequired || !!user);

  const [activeDevice, setActiveDevice] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const currentDevice = devices.find((d) => d.id === activeDevice);

  const [showAddDevice, setShowAddDevice] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceIp, setNewDeviceIp] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<Array<{ name: string; ip: string }>>([]);
  const devicesRef = React.useRef<Device[]>([]);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const activeDeviceRef = React.useRef(activeDevice);
  useEffect(() => {
    activeDeviceRef.current = activeDevice;
  }, [activeDevice]);

  const pingFailStreakRef = React.useRef<Record<string, number>>({});

  // 与 UIStore 的 ConfirmDialog 解耦（DeviceProvider 在 UI 外层），删除设备用浏览器确认框即可。
  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    if (window.confirm(text)) {
      onConfirm();
    }
  }, []);
  const showConfirmRef = React.useRef(showConfirm);
  showConfirmRef.current = showConfirm;

  const scanForDevices = useCallback(() => {
    setIsScanning(false);
    setScannedDevices([]);
    addToast('请手动输入设备 IP 进行真实 SSH 连接', 'info');
  }, [addToast]);

  const addNewDevice = useCallback((payload?: { host: string; port?: number; username: string; password: string; name?: string }) => {
    const host = payload?.host ?? newDeviceIp;
    const port = payload?.port ?? 22;
    const username = payload?.username ?? 'root';
    const password = payload?.password ?? '';
    const alias = payload?.name?.trim() || newDeviceName.trim();

    if (!host.trim() || !username.trim() || !password.trim()) {
      addToast('请填写设备 IP、用户名和密码', 'warning');
      return;
    }

    connectDevice({ host: host.trim(), port, username: username.trim(), password: password.trim() })
      .then((res) => {
        rememberDevicePassword(res.device.id, password.trim());
        const device: Device = {
          id: res.device.id,
          name: alias || `${res.device.username}@${res.device.host}:${res.device.port ?? 22}`,
          status: res.device.status === 'connected' ? 'online' : 'offline',
          ip: res.device.host,
          port: res.device.port ?? 22,
          description: `SSH ${res.device.username}:${res.device.port ?? 22}`,
        };
        setDevices((prev) => [device, ...prev.filter((item) => item.id !== device.id)]);
        setActiveDevice(device.id);
        setShowAddDevice(false);
        setNewDeviceName('');
        setNewDeviceIp('');
        addToast(`设备 "${device.name}" 已连接`, 'success');
        addActivity(`连接设备: ${device.name} (${device.ip})`);
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '设备连接失败', 'error');
      });
  }, [newDeviceIp, newDeviceName, addToast, addActivity]);

  const addScannedDevice = useCallback((device: { name: string; ip: string }) => {
    const id = `device-${Date.now()}`;
    setDevices((prev) => [...prev, { id, name: device.name, status: 'offline', ip: device.ip }]);
    addToast(`设备 "${device.name}" 已添加到列表`, 'success');
    addActivity(`通过扫描添加设备: ${device.name}`);
  }, [addToast, addActivity]);

  const removeDevice = useCallback((id: string) => {
    const dev = devices.find(d => d.id === id);
    if (!dev) return;
    showConfirmRef.current('删除设备', `确定要删除设备 "${dev.name}" 吗？`, () => {
      removeDeviceApi(id)
        .then(() => {
          forgetDevicePassword(id);
          delete pingFailStreakRef.current[id];
          setDevices(prev => {
            const remaining = prev.filter(d => d.id !== id);
            if (activeDevice === id) {
              setActiveDevice(remaining[0]?.id ?? '');
            }
            return remaining;
          });
          addToast(`设备 "${dev.name}" 已删除`, 'info');
          addActivity(`删除设备: ${dev.name}`);
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          const notOnServer = /\b404\b/.test(msg) || /设备不存在/i.test(msg) || /not\s*found/i.test(msg);
          if (notOnServer) {
            forgetDevicePassword(id);
            delete pingFailStreakRef.current[id];
            setDevices((prev) => {
              const remaining = prev.filter((d) => d.id !== id);
              if (activeDevice === id) {
                setActiveDevice(remaining[0]?.id ?? '');
              }
              return remaining;
            });
            addToast(`「${dev.name}」已从列表移除（服务端无此记录，已同步本地）`, 'info');
            return;
          }
          addToast(msg || '删除设备失败', 'error');
        });
    });
  }, [devices, activeDevice, addToast, addActivity]);

  /**
   * SSO 开启时，在登录页也会挂载 DeviceProvider；此前在 401 时拉列表会失败且 effect 只跑一次，
   * 登录成功后不会重试。改为「认证就绪后再拉取」，并做本机缓存兜底。
   */
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchDevices();
        if (cancelled) return;
        const next = res.devices.map((device) => ({
          id: device.id,
          name: `${device.username}@${device.host}:${device.port ?? 22}`,
          status: device.status === 'connected' ? 'online' : 'offline',
          ip: device.host,
          port: device.port ?? 22,
          description: `SSH ${device.username}:${device.port ?? 22}`,
        }));
        setDevices(next);
        setActiveDevice((prev) => (prev && next.some((item) => item.id === prev) ? prev : (next[0]?.id ?? '')));
      } catch {
        if (cancelled) return;
        const cached = loadDevicesFromCache();
        if (cached?.devices.length) {
          /* 缓存可能含过期的「在线」，恢复后一律先标离线，由后台 ping 再更新 */
          setDevices(cached.devices.map((d) => ({ ...d, status: 'offline' })));
          setActiveDevice((prev) => {
            if (prev && cached.devices.some((d) => d.id === prev)) return prev;
            if (cached.activeDevice && cached.devices.some((d) => d.id === cached.activeDevice)) {
              return cached.activeDevice;
            }
            return cached.devices[0]?.id ?? '';
          });
          addToast('已从本机恢复设备列表（服务端暂不可用或未携带登录态）', 'info');
        } else {
          addToast('设备列表读取失败，请检查后端服务', 'warning');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, user?.id, addToast]);

  useEffect(() => {
    saveDevicesToCache(devices, activeDevice);
  }, [devices, activeDevice]);

  // Background ping
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    let pinging = false;
    const pingAll = async () => {
      if (cancelled || pinging) return;
      const snapshot = devicesRef.current;
      if (snapshot.length === 0) return;
      const knownIds = new Set(snapshot.map((d) => d.id));
      for (const k of Object.keys(pingFailStreakRef.current)) {
        if (!knownIds.has(k)) delete pingFailStreakRef.current[k];
      }
      pinging = true;
      try {
        const newDevices = await Promise.all(snapshot.map(async (dev) => {
          try {
            const res = await checkDevicePing(dev.id);
            let pingOk = res.status === 'connected';
            /* 当前选中设备：ping 偶发失败时用诊断遥测补判，与是否打开工作台页面无关 */
            if (!pingOk && dev.id === activeDeviceRef.current) {
              try {
                const dr = await fetchDeviceDiagnostics(dev.id);
                if (dr.ok !== false && diagnosticsOutputImpliesReachable(dr.output)) {
                  pingOk = true;
                }
              } catch {
                /* 忽略：与 ping 一致，不弹错 */
              }
            }
            if (pingOk) {
              pingFailStreakRef.current[dev.id] = 0;
              return dev.status === 'online' ? dev : { ...dev, status: 'online' as const };
            }
            const streak = (pingFailStreakRef.current[dev.id] ?? 0) + 1;
            pingFailStreakRef.current[dev.id] = streak;
            if (isDeviceSshConnected(dev.status) && streak < PING_FAILS_BEFORE_OFFLINE) {
              return dev;
            }
            return { ...dev, status: 'offline' as const };
          } catch {
            const streak = (pingFailStreakRef.current[dev.id] ?? 0) + 1;
            pingFailStreakRef.current[dev.id] = streak;
            if (isDeviceSshConnected(dev.status) && streak < PING_FAILS_BEFORE_OFFLINE) {
              return dev;
            }
            return { ...dev, status: 'offline' as const };
          }
        }));
        if (!cancelled) {
          setDevices((prev) => {
            let changed = false;
            const next = prev.map((p) => {
              const up = newDevices.find((n) => n.id === p.id);
              if (up && p.status !== up.status) {
                changed = true;
                return { ...p, status: up.status };
              }
              return p;
            });
            return changed ? next : prev;
          });
        }
      } finally {
        pinging = false;
      }
    };

    const timer = setInterval(() => {
      void pingAll();
    }, 15000);
    void pingAll();

    return () => { cancelled = true; clearInterval(timer); };
  }, [authReady, devices.length]);

  const value = useMemo<DeviceStoreState>(
    () => ({
      activeDevice, setActiveDevice, devices, setDevices, currentDevice,
      showAddDevice, setShowAddDevice, newDeviceName, setNewDeviceName,
      newDeviceIp, setNewDeviceIp, isScanning, scannedDevices,
      scanForDevices, addNewDevice, addScannedDevice, removeDevice,
      showConfirm,
    }),
    [
      activeDevice, devices, currentDevice, showAddDevice, newDeviceName, newDeviceIp,
      isScanning, scannedDevices, scanForDevices, addNewDevice, addScannedDevice,
      removeDevice, showConfirm,
    ],
  );

  return React.createElement(DeviceContext.Provider, { value }, children);
}
