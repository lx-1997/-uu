import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { Device } from '../app-types';
import {
  connectDevice,
  checkDevicePing,
  fetchDevices,
  forgetDevicePassword,
  rememberDevicePassword,
  removeDevice as removeDeviceApi,
} from '../api';
import { isDeviceSshConnected } from '../utils/device-connection';
import { confirmDeviceUnreachable } from '../utils/device-reachability';
import {
  orderDevicesForStudio,
  preferRootOverSunriseOnSameHost,
  shouldDeferSunriseBackgroundPing,
} from '../utils/device-display-order';
import { DEVICE_POLL_PHASE_DEVICE_PING_MS, DEVICE_SSH_PING_INTERVAL_MS } from '../constants';

/** 曾成功 SSH 验证过的设备 id（本机持久化，用于「先离线、验证后再显示在线」） */
const SSH_VERIFIED_IDS_KEY = 'rdk-device-ssh-verified-ids-v1';

function loadVerifiedIdSet(): Set<string> {
  try {
    const raw = localStorage.getItem(SSH_VERIFIED_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistVerifiedId(id: string) {
  const s = loadVerifiedIdSet();
  s.add(id);
  localStorage.setItem(SSH_VERIFIED_IDS_KEY, JSON.stringify([...s]));
}

function removeVerifiedId(id: string) {
  const s = loadVerifiedIdSet();
  s.delete(id);
  localStorage.setItem(SSH_VERIFIED_IDS_KEY, JSON.stringify([...s]));
}

import { useToastStore } from './useToastStore';
import { useAuth } from './useAuth';

/** 与下方 GET /api/devices 的 effect 使用同一映射，避免多处漂移 */
export function mapDevicesFromApiResponse(res: {
  devices: Array<{
    id: string;
    username: string;
    host: string;
    port?: number;
    boardPlatform?: string | null;
    boardModel?: string | null;
    lanSshHost?: string;
    lanSshPort?: number;
    frpRemotePort?: number;
    sshReachability?: 'direct' | 'tunnel';
  }>;
}): Device[] {
  const verifiedIds = loadVerifiedIdSet();
  const mapped = res.devices.map((device) => ({
    id: device.id,
    name: `${device.username}@${device.host}:${device.port ?? 22}`,
    status: 'offline' as const,
    ip: device.host,
    port: device.port ?? 22,
    sshUsername: device.username,
    description: `SSH ${device.username}:${device.port ?? 22}`,
    boardPlatform: device.boardPlatform ?? null,
    boardModel: device.boardModel ?? null,
    sshSessionVerified: verifiedIds.has(device.id),
    lanSshHost: device.lanSshHost,
    lanSshPort: device.lanSshPort,
    frpRemotePort: device.frpRemotePort,
    sshReachability: device.sshReachability,
  }));
  return orderDevicesForStudio(mapped);
}

/** 后台 ping 连续失败多少次后才标离线；过大会导致关机后长时间仍显示「已连接」 */
const PING_FAILS_BEFORE_OFFLINE = 2;

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

/**
 * 首屏前从本机缓存恢复设备与当前选中项，与 auth effect 失败分支一致。
 * 避免 AIChat 先用 `__global__` 加载历史、待 GET /api/devices 返回后再切到真实设备时触发
 * global→device 合并，把「未绑定设备」会话错混进设备会话（重启后尤为明显）。
 */
function getHydratedDevicesBootstrap(): { devices: Device[]; activeDevice: string } {
  if (typeof window === 'undefined') {
    return { devices: [], activeDevice: '' };
  }
  const cached = loadDevicesFromCache();
  if (!cached?.devices.length) {
    return { devices: [], activeDevice: '' };
  }
  const verifiedIds = loadVerifiedIdSet();
  const devices = orderDevicesForStudio(
    cached.devices.map((d) => ({
      ...d,
      status: 'offline' as const,
      sshSessionVerified: verifiedIds.has(d.id),
    })),
  );
  let activeDevice = '';
  if (cached.activeDevice && devices.some((d) => d.id === cached.activeDevice)) {
    activeDevice = preferRootOverSunriseOnSameHost(devices, cached.activeDevice);
  } else {
    activeDevice = devices[0]?.id ?? '';
  }
  return { devices, activeDevice };
}

export interface DeviceStoreState {
  activeDevice: string;
  /** 与 useState 一致，支持传入更新函数以避免异步闭包读到过期的 activeDevice */
  setActiveDevice: React.Dispatch<React.SetStateAction<string>>;
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  currentDevice: Device | undefined;

  showAddDevice: boolean;
  setShowAddDevice: (v: boolean) => void;
  /** 下次打开「添加设备」时直接进入对应配置页（与弹窗内 manual / usb / typec 一致），用后清空 */
  addDeviceInitialMethod: 'manual' | 'usb' | 'typec' | null;
  setAddDeviceInitialMethod: (v: 'manual' | 'usb' | 'typec' | null) => void;
  newDeviceName: string;
  setNewDeviceName: (v: string) => void;
  newDeviceIp: string;
  setNewDeviceIp: (v: string) => void;
  /** 打开添加设备弹窗（原「扫描」入口已移除，由 AI/快捷方式统一引导手动填写 IP） */
  scanForDevices: () => void;
  addNewDevice: (payload?: { host: string; port?: number; username: string; password: string; name?: string }) => void;
  /**
   * 验证成功后注册设备并加入列表，但不关闭「添加设备」弹窗，供后续 WiFi 步骤使用。
   */
  registerDeviceAfterVerify: (payload: { host: string; port?: number; username: string; password: string; name?: string }) => Promise<Device | null>;
  removeDevice: (id: string) => void;
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

  const bootstrapRef = React.useRef<{ devices: Device[]; activeDevice: string } | null>(null);
  const [devices, setDevices] = useState<Device[]>(() => {
    if (bootstrapRef.current === null) bootstrapRef.current = getHydratedDevicesBootstrap();
    return bootstrapRef.current.devices;
  });
  const [activeDevice, setActiveDevice] = useState<string>(() => {
    if (bootstrapRef.current === null) bootstrapRef.current = getHydratedDevicesBootstrap();
    return bootstrapRef.current.activeDevice;
  });
  /** 列表从服务端/缓存同步后递增，促使后台 ping 立即跑一轮（避免 length 不变时最长 ~10s 误显示未连接） */
  const [deviceListRevision, setDeviceListRevision] = useState(0);
  /** 丢弃「启动时仍在飞行」的 GET /api/devices：避免与 DELETE 竞态导致旧列表覆盖刚删掉的项 */
  const devicesListFetchGenRef = React.useRef(0);
  /**
   * 与工作台一致：有设备列表时始终有「当前设备」——active 为空或失效时回退为列表首项（经 preferRoot）。
   * 用户仍可点击切换；无需先手动点选才能用终端/文件。
   */
  const currentDevice = useMemo(() => {
    if (devices.length === 0) return undefined;
    const valid = Boolean(activeDevice && devices.some((d) => d.id === activeDevice));
    if (valid) {
      return devices.find((d) => d.id === activeDevice)!;
    }
    const fallbackId = preferRootOverSunriseOnSameHost(devices, devices[0].id);
    return devices.find((d) => d.id === fallbackId) ?? devices[0];
  }, [devices, activeDevice]);

  /** 将侧栏选中 id 与推导出的当前设备对齐，避免 active 为空时列表无高亮 */
  useEffect(() => {
    if (devices.length === 0) {
      if (activeDevice) setActiveDevice('');
      return;
    }
    const valid = Boolean(activeDevice && devices.some((d) => d.id === activeDevice));
    if (!valid) {
      const pick = preferRootOverSunriseOnSameHost(devices, devices[0].id);
      setActiveDevice(pick);
    }
  }, [devices, activeDevice]);

  const [showAddDevice, setShowAddDevice] = useState(false);
  const [addDeviceInitialMethod, setAddDeviceInitialMethod] = useState<'manual' | 'usb' | 'typec' | null>(null);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceIp, setNewDeviceIp] = useState('');
  const devicesRef = React.useRef<Device[]>([]);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const activeDeviceRef = React.useRef(activeDevice);
  useEffect(() => {
    activeDeviceRef.current = activeDevice;
  }, [activeDevice]);

  const pingFailStreakRef = React.useRef<Record<string, number>>({});

  const scanForDevices = useCallback(() => {
    setShowAddDevice(true);
    addToast('请填写设备 IP 与 SSH 凭据', 'info');
  }, [addToast, setShowAddDevice]);

  const registerDeviceAfterVerify = useCallback((payload: { host: string; port?: number; username: string; password: string; name?: string }) => {
    const host = payload.host;
    const port = payload.port ?? 22;
    const username = payload.username ?? 'root';
    const password = payload.password ?? '';
    const alias = payload.name?.trim() ?? '';

    if (!host.trim() || !username.trim() || !password.trim()) {
      addToast('请填写设备 IP、用户名和密码', 'warning');
      return Promise.resolve(null);
    }

    return connectDevice({ host: host.trim(), port, username: username.trim(), password: password.trim() })
      .then((res) => {
        rememberDevicePassword(res.device.id, password.trim());
        const device: Device = {
          id: res.device.id,
          name: alias || `${res.device.username}@${res.device.host}:${res.device.port ?? 22}`,
          status: res.device.status === 'connected' ? 'online' : 'offline',
          ip: res.device.host,
          port: res.device.port ?? 22,
          sshUsername: res.device.username,
          description: `SSH ${res.device.username}:${res.device.port ?? 22}`,
          boardPlatform: res.device.boardPlatform ?? null,
          boardModel: res.device.boardModel ?? null,
          sshSessionVerified: true,
        };
        persistVerifiedId(device.id);
        setDevices((prev) => orderDevicesForStudio([device, ...prev.filter((item) => item.id !== device.id)]));
        setActiveDevice(device.id);
        setDeviceListRevision((n) => n + 1);
        addToast(`设备 "${device.name}" 已加入工作区`, 'success');
        addActivity(`连接设备: ${device.name} (${device.ip})`);
        return device;
      })
      .catch((error) => {
        const raw = error instanceof Error ? error.message : '设备连接失败';
        const msg = /timed out while waiting for handshake/i.test(raw)
          ? 'SSH 握手超时：请确认设备已开机且网络可达；若正在本机烧录大镜像，可稍后再试或结束写盘后再连接。'
          : raw;
        addToast(msg, 'error');
        return null;
      });
  }, [addToast, addActivity]);

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
          sshUsername: res.device.username,
          description: `SSH ${res.device.username}:${res.device.port ?? 22}`,
          boardPlatform: res.device.boardPlatform ?? null,
          boardModel: res.device.boardModel ?? null,
          sshSessionVerified: true,
        };
        persistVerifiedId(device.id);
        setDevices((prev) => orderDevicesForStudio([device, ...prev.filter((item) => item.id !== device.id)]));
        setActiveDevice(device.id);
        setShowAddDevice(false);
        setNewDeviceName('');
        setNewDeviceIp('');
        addToast(`设备 "${device.name}" 已连接`, 'success');
        addActivity(`连接设备: ${device.name} (${device.ip})`);
      })
      .catch((error) => {
        const raw = error instanceof Error ? error.message : '设备连接失败';
        const msg = /timed out while waiting for handshake/i.test(raw)
          ? 'SSH 握手超时：请确认设备已开机且网络可达；若正在本机烧录大镜像，可稍后再试或结束写盘后再连接。'
          : raw;
        addToast(msg, 'error');
      });
  }, [newDeviceIp, newDeviceName, addToast, addActivity]);

  const removeDevice = useCallback((id: string) => {
    if (!id.trim()) {
      addToast('无效的设备 ID', 'warning');
      return;
    }
    const prevDevices = [...devicesRef.current];
    const prevActive = activeDeviceRef.current;
    const removed = prevDevices.find((d) => d.id === id);
    if (!removed) {
      addToast('设备已从列表移除', 'info');
      return;
    }
    const name = removed.name;

    /** 乐观更新：避免 DELETE 往返较慢时侧栏看似「没反应」；失败则回滚 */
    const opGen = ++devicesListFetchGenRef.current;
    setDevices((prev) => {
      const remaining = prev.filter((d) => d.id !== id);
      if (activeDeviceRef.current === id) {
        setActiveDevice(remaining[0]?.id ?? '');
      }
      return remaining;
    });
    setDeviceListRevision((n) => n + 1);

    const resyncFromServer = () => {
      void (async () => {
        try {
          const res = await fetchDevices();
          if (devicesListFetchGenRef.current !== opGen) return;
          const next = mapDevicesFromApiResponse(res);
          setDevices(next);
          setActiveDevice((prev) => {
            if (prev && next.some((item) => item.id === prev)) {
              return preferRootOverSunriseOnSameHost(next, prev);
            }
            return next[0]?.id ?? '';
          });
          setDeviceListRevision((n) => n + 1);
        } catch {
          /* 本地已更新，忽略 */
        }
      })();
    };

    removeDeviceApi(id)
      .then(() => {
        forgetDevicePassword(id);
        delete pingFailStreakRef.current[id];
        removeVerifiedId(id);
        addToast(`设备 "${name}" 已删除`, 'info');
        addActivity(`删除设备: ${name}`);
        /** 再拉一次服务端列表，避免与「正在飞行」的 GET /api/devices 竞态把已删项又写回 UI */
        resyncFromServer();
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        const notOnServer = /\b404\b/.test(msg) || /设备不存在/i.test(msg) || /not\s*found/i.test(msg);
        if (notOnServer) {
          forgetDevicePassword(id);
          delete pingFailStreakRef.current[id];
          removeVerifiedId(id);
          addToast(`「${name}」已从列表移除（服务端无此记录，已同步本地）`, 'info');
          resyncFromServer();
          return;
        }
        if (/\b401\b/.test(msg) || /unauthorized/i.test(msg)) {
          devicesListFetchGenRef.current += 1;
          setDevices(prevDevices);
          setActiveDevice(prevActive);
          setDeviceListRevision((n) => n + 1);
          addToast(
            '删除失败：当前未登录或登录已过期，请重新登录后再试。（与是否 SSH 连接设备无关）',
            'error',
          );
          return;
        }
        devicesListFetchGenRef.current += 1;
        setDevices(prevDevices);
        setActiveDevice(prevActive);
        setDeviceListRevision((n) => n + 1);
        addToast(msg || '删除设备失败', 'error');
      });
  }, [addToast, addActivity]);

  /**
   * SSO 开启时，在登录页也会挂载 DeviceProvider；此前在 401 时拉列表会失败且 effect 只跑一次，
   * 登录成功后不会重试。改为「认证就绪后再拉取」，并做本机缓存兜底。
   */
  useEffect(() => {
    if (!authReady) return;
    const fetchGen = ++devicesListFetchGenRef.current;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchDevices();
        if (cancelled || devicesListFetchGenRef.current !== fetchGen) return;
        const next = mapDevicesFromApiResponse(res);
        setDevices(next);
        setActiveDevice((prev) => {
          if (prev && next.some((item) => item.id === prev)) {
            return preferRootOverSunriseOnSameHost(next, prev);
          }
          return next[0]?.id ?? '';
        });
        setDeviceListRevision((n) => n + 1);
      } catch {
        if (cancelled || devicesListFetchGenRef.current !== fetchGen) return;
        const cached = loadDevicesFromCache();
        if (cached?.devices.length) {
          const verifiedIds = loadVerifiedIdSet();
          const list = orderDevicesForStudio(
            cached.devices.map((d) => ({
              ...d,
              status: 'offline',
              sshSessionVerified: verifiedIds.has(d.id),
            })),
          );
          setDevices(list);
          setActiveDevice((prev) => {
            if (prev && list.some((d) => d.id === prev)) {
              return preferRootOverSunriseOnSameHost(list, prev);
            }
            if (cached.activeDevice && list.some((d) => d.id === cached.activeDevice)) {
              return preferRootOverSunriseOnSameHost(list, cached.activeDevice);
            }
            return list[0]?.id ?? '';
          });
          addToast('已从本机恢复设备列表（服务端暂不可用或未携带登录态）', 'info');
          setDeviceListRevision((n) => n + 1);
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
    const pingOne = async (dev: Device, snapshot: Device[]): Promise<Device> => {
      if (shouldDeferSunriseBackgroundPing(dev, snapshot, activeDeviceRef.current)) {
        return dev;
      }
      const verified = dev.sshSessionVerified === true;
      try {
        const res = await checkDevicePing(dev.id);
        if (res.status === 'transient') {
          return dev;
        }
        const pingOk = res.status === 'connected';
        if (pingOk) {
          pingFailStreakRef.current[dev.id] = 0;
          persistVerifiedId(dev.id);
          return {
            ...dev,
            status: 'online' as const,
            sshSessionVerified: true,
          };
        }
        if (!verified) {
          return { ...dev, status: 'offline' as const, sshSessionVerified: false };
        }
        const streak = (pingFailStreakRef.current[dev.id] ?? 0) + 1;
        pingFailStreakRef.current[dev.id] = streak;
        if (isDeviceSshConnected(dev.status) && streak < PING_FAILS_BEFORE_OFFLINE) {
          return dev;
        }
        if (isDeviceSshConnected(dev.status) && streak >= PING_FAILS_BEFORE_OFFLINE) {
          const unreachable = await confirmDeviceUnreachable(dev.id);
          if (!unreachable) {
            pingFailStreakRef.current[dev.id] = 0;
            return { ...dev, status: 'online' as const, sshSessionVerified: true };
          }
        }
        return { ...dev, status: 'offline' as const };
      } catch {
        if (!verified) {
          return { ...dev, status: 'offline' as const, sshSessionVerified: false };
        }
        const streak = (pingFailStreakRef.current[dev.id] ?? 0) + 1;
        pingFailStreakRef.current[dev.id] = streak;
        if (isDeviceSshConnected(dev.status) && streak < PING_FAILS_BEFORE_OFFLINE) {
          return dev;
        }
        if (isDeviceSshConnected(dev.status) && streak >= PING_FAILS_BEFORE_OFFLINE) {
          const unreachable = await confirmDeviceUnreachable(dev.id);
          if (!unreachable) {
            pingFailStreakRef.current[dev.id] = 0;
            return { ...dev, status: 'online' as const, sshSessionVerified: true };
          }
        }
        return { ...dev, status: 'offline' as const };
      }
    };

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
        const newDevices: Device[] = [];
        for (const dev of snapshot) {
          if (cancelled) return;
          newDevices.push(await pingOne(dev, snapshot));
        }
        if (!cancelled) {
          for (let i = 0; i < snapshot.length; i++) {
            const p = snapshot[i];
            const up = newDevices[i];
            if (!p || !up || p.id !== up.id) continue;
            if (isDeviceSshConnected(p.status) && up.status === 'offline' && p.id === activeDeviceRef.current) {
              window.dispatchEvent(
                new CustomEvent('rdk-device-offline-confirmed', {
                  detail: { deviceId: up.id, deviceName: up.name },
                }),
              );
            }
          }
          setDevices((prev) => {
            let changed = false;
            const next = prev.map((p) => {
              const up = newDevices.find((n) => n.id === p.id);
              if (
                up
                && (p.status !== up.status || p.sshSessionVerified !== up.sshSessionVerified)
              ) {
                changed = true;
                return { ...p, status: up.status, sshSessionVerified: up.sshSessionVerified };
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

    let pingKick: ReturnType<typeof setTimeout> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    pingKick = setTimeout(() => {
      void pingAll();
      timer = setInterval(() => {
        void pingAll();
      }, DEVICE_SSH_PING_INTERVAL_MS);
    }, DEVICE_POLL_PHASE_DEVICE_PING_MS);

    return () => {
      cancelled = true;
      if (pingKick) clearTimeout(pingKick);
      if (timer) clearInterval(timer);
    };
  }, [authReady, devices.length, deviceListRevision]);

  const value = useMemo<DeviceStoreState>(
    () => ({
      activeDevice, setActiveDevice, devices, setDevices, currentDevice,
      showAddDevice, setShowAddDevice,
      addDeviceInitialMethod, setAddDeviceInitialMethod,
      newDeviceName, setNewDeviceName,
      newDeviceIp, setNewDeviceIp,
      scanForDevices, addNewDevice, registerDeviceAfterVerify, removeDevice,
    }),
    [
      activeDevice, devices, currentDevice, showAddDevice, addDeviceInitialMethod, setAddDeviceInitialMethod,
      newDeviceName, newDeviceIp,
      scanForDevices, addNewDevice, registerDeviceAfterVerify,
      removeDevice,
    ],
  );

  return React.createElement(DeviceContext.Provider, { value }, children);
}
