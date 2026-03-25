import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Device } from '../app-types';
import { connectDevice, checkDevicePing, fetchDevices, forgetDevicePassword, rememberDevicePassword, removeDevice as removeDeviceApi } from '../api';
import { useToastStore } from './useToastStore';

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

  // Confirm helper — kept local; the full confirm dialog lives in UIStore,
  // but device removal needs a simple callback-style confirm.
  // We store the pending callback and expose showConfirm; the UIStore
  // confirmDialog state is set via the facade in AppProvider.
  // For now, use window.confirm as a lightweight bridge to avoid circular deps.
  const showConfirm = (title: string, _message: string, onConfirm: () => void) => {
    // Will be overridden by the facade wiring in AppProvider
    void title;
    onConfirm();
  };
  // Mutable ref so removeDevice always sees the latest showConfirm
  const showConfirmRef = React.useRef(showConfirm);
  showConfirmRef.current = showConfirm;

  const scanForDevices = () => {
    setIsScanning(false);
    setScannedDevices([]);
    addToast('请手动输入设备 IP 进行真实 SSH 连接', 'info');
  };

  const addNewDevice = (payload?: { host: string; port?: number; username: string; password: string; name?: string }) => {
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
  };

  const addScannedDevice = (device: { name: string; ip: string }) => {
    const id = `device-${Date.now()}`;
    setDevices((prev) => [...prev, { id, name: device.name, status: 'online', ip: device.ip }]);
    addToast(`设备 "${device.name}" 已添加到列表`, 'success');
    addActivity(`通过扫描添加设备: ${device.name}`);
  };

  const removeDevice = (id: string) => {
    const dev = devices.find(d => d.id === id);
    if (!dev) return;
    showConfirmRef.current('删除设备', `确定要删除设备 "${dev.name}" 吗？`, () => {
      removeDeviceApi(id)
        .then(() => {
          forgetDevicePassword(id);
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
          addToast(error instanceof Error ? error.message : '删除设备失败', 'error');
        });
    });
  };

  // Fetch device list on mount
  useEffect(() => {
    fetchDevices()
      .then((res) => {
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
      })
      .catch(() => {
        addToast('设备列表读取失败，请检查后端服务', 'warning');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background ping
  useEffect(() => {
    let cancelled = false;
    let pinging = false;
    const pingAll = async () => {
      if (cancelled || pinging) return;
      const snapshot = devicesRef.current;
      if (snapshot.length === 0) return;
      pinging = true;
      try {
        const newDevices = await Promise.all(snapshot.map(async (dev) => {
          try {
            const res = await checkDevicePing(dev.id);
            return { ...dev, status: res.status === 'connected' ? 'online' : 'offline' };
          } catch {
            return { ...dev, status: 'offline' };
          }
        }));
        if (!cancelled) {
          setDevices(prev => prev.map(p => {
            const up = newDevices.find(n => n.id === p.id);
            return (up && p.status !== up.status) ? { ...p, status: up.status } : p;
          }));
        }
      } finally {
        pinging = false;
      }
    };

    const timer = setInterval(() => {
      void pingAll();
    }, 5000);
    void pingAll();

    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const value: DeviceStoreState = {
    activeDevice, setActiveDevice, devices, setDevices, currentDevice,
    showAddDevice, setShowAddDevice, newDeviceName, setNewDeviceName,
    newDeviceIp, setNewDeviceIp, isScanning, scannedDevices,
    scanForDevices, addNewDevice, addScannedDevice, removeDevice,
    showConfirm,
  };

  return React.createElement(DeviceContext.Provider, { value }, children);
}
