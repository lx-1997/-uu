import { describe, it, expect } from 'vitest';
import { parseWifiSsidsFromNmcliOutput, sanitizeWifiScanOutput } from '../wifi-nmcli-parse.js';

describe('parseWifiSsidsFromNmcliOutput', () => {
  it('parses terse -t SSID lines with CJK SSIDs', () => {
    const raw = ['我家5G', 'Office', '邻居的WiFi'].join('\n');
    expect(parseWifiSsidsFromNmcliOutput(raw)).toEqual(['我家5G', 'Office', '邻居的WiFi']);
  });

  it('dedupes duplicate terse lines', () => {
    const raw = ['SameNet', 'SameNet', 'Other'].join('\n');
    expect(parseWifiSsidsFromNmcliOutput(raw)).toEqual(['SameNet', 'Other']);
  });

  it('parses table output after IN-USE/BSSID/SSID header', () => {
    const raw = [
      'IN-USE  BSSID              SSID             MODE   CHAN  RATE        SIGNAL  BARS  SECURITY',
      '*       AA:BB:CC:DD:EE:01  中文热点         Infra  36    270 Mbit/s  80      ▂▄▆_  WPA2',
      '        AA:BB:CC:DD:EE:02  Guest-Net      Infra  11    130 Mbit/s  42      ▂▄__  WPA2',
    ].join('\n');
    expect(parseWifiSsidsFromNmcliOutput(raw)).toEqual(['中文热点', 'Guest-Net']);
  });

  it('unescapes nmcli terse colon in SSID', () => {
    const raw = String.raw`weird\:ssid`;
    expect(parseWifiSsidsFromNmcliOutput(raw)).toEqual([String.raw`weird:ssid`]);
  });
});

describe('sanitizeWifiScanOutput', () => {
  it('strips sudo noise before parse', () => {
    const raw = ['sudo: a password is required', '我家WiFi'].join('\n');
    expect(sanitizeWifiScanOutput(raw)).toBe('我家WiFi');
  });
});
