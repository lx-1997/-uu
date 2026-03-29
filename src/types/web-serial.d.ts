/**
 * Web Serial API。官方 TS lib 未包含时在此补充。
 * @see https://wicg.github.io/serial/
 */

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  filters?: SerialPortFilter[];
}

interface OpenSerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: OpenSerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
  /** 撤销授权并从 getPorts() 中移除（需关闭后调用） */
  forget?(): Promise<void>;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  /** 蓝牙 RFCOMM 等；与 USB 互斥 */
  bluetoothServiceClassId?: number;
}

interface Serial {
  requestPort(options?: SerialOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial: Serial;
}
