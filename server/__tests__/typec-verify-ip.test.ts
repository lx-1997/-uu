import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockNetworkInterfaces = vi.fn();

vi.mock('node:os', () => ({
  default: {
    networkInterfaces: () => mockNetworkInterfaces(),
  },
}));

import {
  verifyTypecIpOnInterface,
  TYPEC_VERIFY_ATTEMPTS,
  TYPEC_VERIFY_INTERVAL_MS,
} from '../typec-verify-ip.js';

const v4 = (addr: string) => ({
  family: 'IPv4' as const,
  address: addr,
  netmask: '255.255.255.0',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: `${addr}/24`,
});

describe('verifyTypecIpOnInterface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNetworkInterfaces.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true after iface gains target IPv4 (delayed visibility)', async () => {
    let n = 0;
    mockNetworkInterfaces.mockImplementation(() => {
      n += 1;
      if (n < 4) {
        return { en9: [v4('10.0.0.1')] };
      }
      return { en9: [v4('192.168.128.100')] };
    });

    const p = verifyTypecIpOnInterface('en9', '192.168.128.100');
    // 第 4 次读取 iface 时才出现目标 IP（模拟系统枚举晚于 netsh）
    await vi.advanceTimersByTimeAsync(TYPEC_VERIFY_INTERVAL_MS * 4);
    await expect(p).resolves.toBe(true);
  });

  it('returns false when target IP never appears', async () => {
    mockNetworkInterfaces.mockImplementation(() => ({
      en9: [v4('10.0.0.1')],
    }));

    const p = verifyTypecIpOnInterface('en9', '192.168.128.100');
    await vi.advanceTimersByTimeAsync(TYPEC_VERIFY_ATTEMPTS * TYPEC_VERIFY_INTERVAL_MS + 100);
    await expect(p).resolves.toBe(false);
  });
});
