import { isDesktopMac } from './env';

/** 与 AddDeviceModal / Terminal 约定：请求打开本机 Web Serial（与 SSH 无关） */
export const RDK_OPEN_USB_SERIAL_EVENT = 'rdk-open-usb-serial';

/** 地瓜机器人开发者资源中心（驱动与工具下载等） */
export const RDK_DEVELOPER_RESOURCE_URL = 'https://developer.d-robotics.cc/resource';

/**
 * 与 [资源中心](https://developer.d-robotics.cc/resource) 表格中「串口驱动」两行一致，文件托管在官方静态站：
 * @see https://archive.d-robotics.cc/downloads/software_tools/serial_to_usb_drivers/
 */
export const RDK_DRIVER_CP210X_USB2UART_ZIP =
  'https://archive.d-robotics.cc/downloads/software_tools/serial_to_usb_drivers/CP210x_USB2UART_Driver.zip';

/** CH340/CH341 系（资源中心文案为「串口驱动 CH340」） */
export const RDK_DRIVER_CH34X_WINDOWS_ZIP =
  'https://archive.d-robotics.cc/downloads/software_tools/serial_to_usb_drivers/CH34x_Install_Windows_v3_4.zip';

/**
 * Web Serial API（Chromium 系桌面浏览器；Windows / macOS）。
 *
 * 与市面常见实现一致（如 ESP Web Flasher、Arduino 云端工具、Chrome Samples）：
 * - `requestPort({ filters: [] })` 列出**全部**串口，避免按 VID/PID 过滤后在某些系统上「看不到设备」
 *   （不同批次 CH340/CP210x、FTDI、板载桥接芯片 PID 可能不同；macOS 与 Windows 枚举名称也不同）。
 * - 需要**安全上下文**：HTTPS，或 http://localhost / http://127.0.0.1（局域网纯 HTTP IP 下 API 通常不可用）。
 *
 * RDK 官方调试串口默认：115200 8N1，无流控。
 * @see https://d-robotics.github.io/rdk_doc/Quick_start/hardware_introduction/rdk_x5/
 * @see https://developer.chrome.com/docs/capabilities/serial
 */

/** RDK 文档推荐波特率 */
export const RDK_DEFAULT_SERIAL_BAUD = 115200;

/**
 * 可选「缩小列表」过滤：仅常见 USB 转串口芯片（仍可能漏掉未列出的 VID/PID）。
 * 默认同市售工具做法：优先使用 `filters: []` 显示全部端口。
 */
export const USB_SERIAL_COMMON_FILTERS: SerialPortFilter[] = [
  { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340/CH341
  { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // Silicon Labs CP210x
  { usbVendorId: 0x0403, usbProductId: 0x6001 }, // FTDI FT232/FT2232 等
  { usbVendorId: 0x067b, usbProductId: 0x2303 }, // Prolific PL2303
];

export type SerialPortListMode = 'all' | 'common';

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator && !!navigator.serial;
}

/** Web Serial 仅在安全上下文可用（HTTPS 或 localhost 类 origin） */
export function isSerialSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext === true;
}

/**
 * 综合判断是否具备连接串口的浏览器环境。
 * macOS 桌面版暂不提供 USB 串口；网页端在 Chrome 等仍可使用 Web Serial。
 */
export function canUseWebSerial(): boolean {
  if (isDesktopMac()) return false;
  return isSerialSecureContext() && isWebSerialSupported();
}

export function getMacDesktopSerialUnavailableHint(isEn: boolean): string {
  return isEn
    ? 'The macOS desktop app does not support USB serial yet. Connect over SSH after the device is on the LAN, or use the web app for local USB serial.'
    : 'macOS 桌面版暂不支持 USB 串口调试。请接入局域网后使用 SSH；若需本机 USB 串口请使用网页版。';
}

export function getWebSerialUnsupportedHint(isEn: boolean): string {
  return isEn
    ? 'Use a desktop browser that supports Web Serial (Windows / macOS).'
    : '请使用支持 Web Serial 的桌面浏览器（Windows / macOS）。';
}

export function getSerialSecureContextHint(isEn: boolean): string {
  return isEn
    ? 'Web Serial needs HTTPS or http://localhost. Plain HTTP on a LAN IP often blocks serial access — use localhost proxy or HTTPS.'
    : 'Web Serial 需要安全访问：请使用 HTTPS，或 http://localhost / http://127.0.0.1。若用局域网 IP 打开纯 HTTP 页面，浏览器通常会禁用串口。';
}

/** 首次连板提示：驱动与系统差异（与 RDK 文档一致） */
export function getSerialDriverHint(isEn: boolean): string {
  return isEn
    ? 'If the port is missing, install the USB–UART driver (e.g. CH340/CP210x) for your OS. Windows: COMx; macOS: /dev/cu.usb* — Web Serial lists them the same way.'
    : '若列表中无设备，请先在系统中安装 USB 转串口驱动（如 CH340、CP210x）。Windows 多为 COM 口，macOS 多为 /dev/cu.usb*，Web Serial 会统一列出。';
}

/** 无法连接时返回一条主因说明（mac 桌面版优先，其次安全上下文 / 浏览器能力） */
export function getSerialConnectBlockedReason(isEn: boolean): string | null {
  if (isDesktopMac()) return getMacDesktopSerialUnavailableHint(isEn);
  if (canUseWebSerial()) return null;
  if (!isSerialSecureContext()) return getSerialSecureContextHint(isEn);
  if (!isWebSerialSupported()) return getWebSerialUnsupportedHint(isEn);
  return isEn ? 'Web Serial is unavailable in this environment.' : '当前环境无法使用 Web Serial。';
}

/** 供已授权（getPorts）设备连接：必要时先关闭再按波特率打开 */
export async function openSerialPortWithOptions(port: SerialPort, baudRate: number): Promise<void> {
  if (port.readable || port.writable) {
    try {
      await port.close();
    } catch {
      /* noop */
    }
  }
  await port.open({
    baudRate,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
  });
}

/**
 * 展示用标签（浏览器不暴露 COM 名，仅能显示 USB VID:PID 或序号）。
 * @see https://developer.chrome.com/docs/capabilities/serial
 */
export function formatSerialPortLabel(port: SerialPort, index: number): string {
  try {
    const info = port.getInfo();
    const vid = info.usbVendorId;
    const pid = info.usbProductId;
    if (vid != null && pid != null) {
      const v = (vid & 0xffff).toString(16).padStart(4, '0');
      const p = (pid & 0xffff).toString(16).padStart(4, '0');
      return `${v}:${p} · #${index + 1}`;
    }
  } catch {
    /* noop */
  }
  return `#${index + 1}`;
}

/**
 * 用户手势内：弹出系统串口选择器，授权后打开端口（首次连接或下拉未选时用）。
 * @param listMode `all`（推荐，跨平台最稳） | `common`（仅常见 USB 转串口）
 */
export async function requestAndOpenSerialPort(
  baudRate: number,
  listMode: SerialPortListMode = 'all',
): Promise<SerialPort> {
  const serial = navigator.serial;
  const filters = listMode === 'common' ? USB_SERIAL_COMMON_FILTERS : [];
  const port = await serial.requestPort({ filters });
  await openSerialPortWithOptions(port, baudRate);
  return port;
}

/**
 * 仅弹出选择器并返回端口（不打开），用于「添加串口」后刷新下拉列表。
 */
export async function requestSerialPortGrant(listMode: SerialPortListMode = 'all'): Promise<SerialPort> {
  const serial = navigator.serial;
  const filters = listMode === 'common' ? USB_SERIAL_COMMON_FILTERS : [];
  return serial.requestPort({ filters });
}

export const SERIAL_BAUD_OPTIONS = [115200, 921600, 57600, 460800] as const;
