import { describe, expect, it } from 'vitest';
import {
  formatDashboardBoardModelDisplay,
  formatDashboardMemoryDisplay,
  isS100BoardModel,
  parseMetrics,
} from '../diagnostics';

/** S100 典型：根大、userdata 独立小分区（无 boardModel 时靠启发式选根） */
const dfSampleBothMounts = [
  'Filesystem       Size  Used Avail Use% Mounted on',
  '/dev/mmcblk0p17   45G  8.4G   35G  20% /',
  '/dev/mmcblk0p16  2.0G   28K  1.8G   1% /userdata',
].join('\n');

const dfLargeUserdata = [
  'Filesystem       Size  Used Avail Use% Mounted on',
  '/dev/mmcblk0p17   45G  8.4G   35G  20% /',
  '/dev/mmcblk0p16  32G  1.0G   30G   4% /userdata',
].join('\n');

describe('parseMetrics dmem', () => {
  it('parses Memory: …K/totalK from dmesg line', () => {
    const out = [
      '###MEM###',
      'Mem:           4.5Gi       1.2Gi       2.8Gi       123Mi       3.2Gi',
      '###DMEM###',
      '[    0.000000] Memory: 4894080K/12582720K available (12672K kernel code, ...)',
    ].join('\n');
    const m = parseMetrics(out);
    expect(m.memPhysicalTotalDisplay).toBe('12Gi');
    expect(m.memTotal).not.toBe('12Gi');
  });

  it('parses dmesg after blank line under ###DMEM###', () => {
    const out = [
      '###DMEM###',
      '',
      '[    0.000000] Memory: 4894080K/12582720K available (...)',
    ].join('\n');
    expect(parseMetrics(out).memPhysicalTotalDisplay).toBe('12Gi');
  });
});

describe('parseMetrics disk mount pick', () => {
  it('prefers root / when userdata is tiny vs root (no board fields, df heuristic)', () => {
    const out = `###DISK###\n${dfSampleBothMounts}`;
    const m = parseMetrics(out);
    expect(m.diskUsed).toBe('8.4G');
    expect(m.diskTotal).toBe('45G');
  });

  it('prefers /userdata over / when userdata partition is large vs root', () => {
    const out = `###DISK###\n${dfLargeUserdata}`;
    const m = parseMetrics(out);
    expect(m.diskUsed).toBe('1.0G');
    expect(m.diskTotal).toBe('32G');
  });

  it('for S100 prefers root / over /userdata', () => {
    const out = `###DISK###\n${dfSampleBothMounts}`;
    const m = parseMetrics(out, { boardModel: 'RDK S100', boardPlatform: null });
    expect(m.diskUsed).toBe('8.4G');
    expect(m.diskTotal).toBe('45G');
  });

  it('for rdk-s100 platform prefers root /', () => {
    const out = `###DISK###\n${dfSampleBothMounts}`;
    const m = parseMetrics(out, { boardModel: null, boardPlatform: 'rdk-s100' });
    expect(m.diskUsed).toBe('8.4G');
    expect(m.diskTotal).toBe('45G');
  });
});

describe('formatDashboardMemoryDisplay', () => {
  const base = {
    temp: '--',
    tempC: -1,
    memUsed: '1.0Gi',
    memTotal: '4.7Gi',
    memPercent: 20,
    bpu: '--',
    bpuValue: -1,
    cpuUsage: '--',
    cpuUsageVal: -1,
    cpuLoad: '--',
    uptime: '--',
    diskUsed: '--',
    diskTotal: '--',
    diskPercent: -1,
    memAvailable: '--',
    memAvailPercent: -1,
    swapUsed: '--',
    swapTotal: '--',
    swapPercent: -1,
    memAvailDisplay: '--',
    memPhysicalTotalDisplay: '12Gi' as const,
    boardModelFromProbe: '',
  };

  it('uses dmesg total for S100 by boardModel', () => {
    expect(formatDashboardMemoryDisplay(base, 'RDK S100', null)).toBe('1.0Gi/12Gi');
  });

  it('uses dmesg total for rdk-s100 platform', () => {
    expect(formatDashboardMemoryDisplay(base, null, 'rdk-s100')).toBe('1.0Gi/12Gi');
  });

  it('uses dmesg when physical ≫ free Mem total even without saved board (S100)', () => {
    expect(formatDashboardMemoryDisplay(base, null, null)).toBe('1.0Gi/12Gi');
  });

  it('keeps free total on X5 when dmesg matches visible Mem', () => {
    const x5 = { ...base, memPhysicalTotalDisplay: '4.7Gi' as const };
    expect(formatDashboardMemoryDisplay(x5, 'RDK X5', 'rdk-x5')).toBe('1.0Gi/4.7Gi');
  });
});

describe('parseMetrics board', () => {
  it('parses ###BOARD### line', () => {
    const out = ['###BOARD###', 'RDK X5', '###UPTIME###', 'up 1 min'].join('\n');
    expect(parseMetrics(out).boardModelFromProbe).toBe('RDK X5');
  });

  it('strips null bytes from device-tree model', () => {
    const out = ['###BOARD###', 'RDK Ultra\0\0'].join('\n');
    expect(parseMetrics(out).boardModelFromProbe).toBe('RDK Ultra');
  });

  it('treats unknown as empty', () => {
    const out = ['###BOARD###', 'unknown'].join('\n');
    expect(parseMetrics(out).boardModelFromProbe).toBe('');
  });

  it('stops at glued ###UPTIME### when no newline between sections', () => {
    const out = ['###BOARD###', 'D-Robotics RDK S100 V1P0###UPTIME###', 'up 1 min'].join('\n');
    expect(parseMetrics(out).boardModelFromProbe).toBe('D-Robotics RDK S100 V1P0');
  });
});

describe('formatDashboardBoardModelDisplay', () => {
  it('shortens D-Robotics full board_id to RDK S100', () => {
    expect(formatDashboardBoardModelDisplay('D-Robotics RDK S100 V1P0')).toBe('RDK S100');
  });

  it('handles glued marker suffix', () => {
    expect(formatDashboardBoardModelDisplay('D-Robotics RDK S100 V1P0###UPTIME###')).toBe('RDK S100');
  });

  it('maps common boards', () => {
    expect(formatDashboardBoardModelDisplay('Horizon RDK X5')).toBe('RDK X5');
    expect(formatDashboardBoardModelDisplay('RDK Ultra')).toBe('RDK Ultra');
  });
});

describe('isS100BoardModel', () => {
  it('matches platform', () => {
    expect(isS100BoardModel(null, 'rdk-s100')).toBe(true);
  });
  it('matches model string', () => {
    expect(isS100BoardModel('Horizon RDK S100', null)).toBe(true);
  });
});
