/**
 * Parse structured diagnostic output from the device into typed metrics.
 *
 * The diagnostic command emits sections delimited by markers like
 * ###TEMP###, ###MEM###, ###BPU###, ###SOMSTATUS###, ###UPTIME###, ###DISK###, ###TOP###.
 */

export interface DeviceMetrics {
  temp: string;
  tempC: number;
  memUsed: string;
  memTotal: string;
  memPercent: number;
  bpu: string;
  bpuValue: number;
  /** 瞬时 CPU 占用（由 top 的 idle% 推算） */
  cpuUsage: string;
  cpuUsageVal: number;
  cpuLoad: string;
  uptime: string;
  diskUsed: string;
  diskTotal: string;
  diskPercent: number;
  /** `free -h` 的 Mem available，无则退回 free */
  memAvailable: string;
  /** 可用占总内存比例 0–100，未知 -1 */
  memAvailPercent: number;
  swapUsed: string;
  swapTotal: string;
  /** Swap 已用比例 0–100，无 swap 或未知 -1 */
  swapPercent: number;
  /** 首页 AVAIL 格展示（含 swap 占用提示） */
  memAvailDisplay: string;
}

function parseMemToMB(str: string): number {
  const num = parseFloat(str);
  if (str.includes('Gi') || str.includes('G')) return num * 1024;
  if (str.includes('Mi') || str.includes('M')) return num;
  if (str.includes('Ki') || str.includes('K')) return num / 1024;
  if (str.includes('Ti') || str.includes('T')) return num * 1024 * 1024;
  return num;
}

function swapUsedIsNonTrivial(used: string, total: string): boolean {
  const u = parseMemToMB(used);
  const t = parseMemToMB(total);
  return t > 0 && u >= 8;
}

/** `df -h` 数据行：优先挂载点 /userdata，其次 /（根分区） */
function pickDfDiskLine(lines: string[], diskIdx: number): string | null {
  const data: string[] = [];
  for (let i = diskIdx + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l || l.startsWith('###')) break;
    if (/^Filesystem\b/i.test(l)) continue;
    if (!/\d+%/.test(l)) continue;
    data.push(l);
  }
  const mnt = (row: string) => {
    const p = row.trim().split(/\s+/);
    return p.length ? p[p.length - 1] : '';
  };
  const userdata = data.find((row) => mnt(row) === '/userdata');
  if (userdata) return userdata;
  const root = data.find((row) => mnt(row) === '/');
  if (root) return root;
  return data[0] ?? null;
}

/** 标准 `df -h`：… Size Used Avail Use% Mounted（挂载点为最后一列） */
function parseDfHLine(row: string): { total: string; used: string; pct: number } | null {
  const parts = row.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const pctRaw = parts[parts.length - 2];
  if (!pctRaw.endsWith('%') || !/^\d+%$/.test(pctRaw)) return null;
  const pct = parseInt(pctRaw.slice(0, -1), 10);
  if (Number.isNaN(pct)) return null;
  const total = parts[parts.length - 5];
  const used = parts[parts.length - 4];
  return { total, used, pct };
}

/**
 * 从 `top -bn1` 聚合 Cpu 行里的 idle 推算占用（procps / 常见嵌入式 top）。
 */
function parseTopCpuUsage(lines: string[]): { display: string; val: number } {
  const topIdx = lines.findIndex((l) => l === '###TOP###');
  if (topIdx < 0) return { display: '--', val: -1 };
  for (let i = topIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.startsWith('###')) break;
    if (!/^%?\s*Cpu/i.test(line)) continue;
    const idPct = line.match(/([\d.]+)%\s*id\b/i);
    if (idPct) {
      const idle = parseFloat(idPct[1]);
      if (Number.isFinite(idle) && idle >= 0 && idle <= 100) {
        const u = Math.round(Math.min(100, Math.max(0, 100 - idle)));
        return { display: `${u}%`, val: u };
      }
    }
    const idSp = line.match(/\s([\d.]+)\s+id\b/i);
    if (idSp) {
      const idle = parseFloat(idSp[1]);
      if (Number.isFinite(idle) && idle >= 0 && idle <= 100) {
        const u = Math.round(Math.min(100, Math.max(0, 100 - idle)));
        return { display: `${u}%`, val: u };
      }
    }
  }
  return { display: '--', val: -1 };
}

export function parseMetrics(output: string): DeviceMetrics {
  const lines = output.split(/\r?\n/).map(l => l.trim());

  const findAfter = (marker: string) => {
    const idx = lines.findIndex(l => l === marker);
    if (idx < 0) return '';
    return lines.slice(idx + 1).find(l => l.length > 0 && !l.startsWith('###')) ?? '';
  };

  // ── Temperature ──
  const tempRaw = findAfter('###TEMP###');
  const tempNum = Number(tempRaw);
  let tempC = Number.isFinite(tempNum) && tempNum > 0 ? tempNum / 1000 : -1;
  let temp = tempC > 0 ? `${tempC.toFixed(1)}°C` : (tempRaw || '--');

  // ── Memory & swap (`free -h`) ──
  const memIdx = lines.findIndex(l => l === '###MEM###');
  let memUsed = '--', memTotal = '--', memPercent = -1;
  let memAvailable = '--', memAvailPercent = -1;
  let swapUsed = '--', swapTotal = '--', swapPercent = -1;
  if (memIdx >= 0) {
    const memLine = lines.slice(memIdx + 1).find(l => /^mem:/i.test(l));
    if (memLine) {
      const parts = memLine.split(/\s+/).filter(Boolean);
      if (parts.length >= 4) {
        memTotal = parts[1];
        memUsed = parts[2];
        const totalMB = parseMemToMB(parts[1]);
        const usedMB = parseMemToMB(parts[2]);
        if (totalMB > 0) memPercent = Math.round((usedMB / totalMB) * 100);
        if (parts.length >= 7) {
          memAvailable = parts[6];
        } else {
          memAvailable = parts[3];
        }
        const availMB = parseMemToMB(memAvailable);
        if (totalMB > 0 && Number.isFinite(availMB) && availMB >= 0) {
          memAvailPercent = Math.round((availMB / totalMB) * 100);
        }
      }
    }
    const swapLine = lines.slice(memIdx + 1).find(l => /^swap:/i.test(l));
    if (swapLine) {
      const sp = swapLine.split(/\s+/).filter(Boolean);
      if (sp.length >= 4) {
        swapTotal = sp[1];
        swapUsed = sp[2];
        const st = parseMemToMB(sp[1]);
        const su = parseMemToMB(sp[2]);
        if (st > 0 && Number.isFinite(su)) swapPercent = Math.min(100, Math.round((su / st) * 100));
      }
    }
  }

  let memAvailDisplay = memAvailable;
  if (memAvailDisplay !== '--' && swapUsedIsNonTrivial(swapUsed, swapTotal)) {
    memAvailDisplay = `${memAvailable} · ${swapUsed} sw`;
  }

  // ── BPU (prefer SOMSTATUS, fallback to hrut_smi / bputop) ──
  let bpu = '--', bpuValue = -1;
  const somIdx = lines.findIndex(l => l === '###SOMSTATUS###');
  if (somIdx >= 0) {
    const somLines = lines.slice(somIdx + 1);

    const cpuTempLine = somLines.find(l => /CPU\s*:\s*[\d.]+/.test(l));
    if (cpuTempLine) {
      const tm = cpuTempLine.match(/CPU\s*:\s*([\d.]+)/);
      if (tm) {
        const value = parseFloat(tm[1]);
        if (value > 0) { tempC = value; temp = `${value.toFixed(1)}°C`; }
      }
    }

    const bpuLine = somLines.find(l => /bpu\d+/i.test(l));
    if (bpuLine) {
      const parts = bpuLine.replace(':', ' ').trim().split(/\s+/);
      const numbers = parts.map(p => Number(p.replace('%', ''))).filter(n => Number.isFinite(n));

      const ratioMatch = bpuLine.match(/(ratio|load|util(?:ization)?)[^\d]*(\d{1,3})\s*%?/i);
      const percentMatch = bpuLine.match(/(\d{1,3})\s*%/);
      let ratio = ratioMatch ? Number(ratioMatch[2]) : (percentMatch ? Number(percentMatch[1]) : -1);
      if (ratio < 0 || ratio > 100) {
        ratio = [...numbers].reverse().find(n => n >= 0 && n <= 100) ?? -1;
      }

      const freqCandidate = numbers.find(n => n > 1000000);
      if (freqCandidate && ratio >= 0) {
        bpu = `${ratio}% · ${(freqCandidate / 1e9).toFixed(1)}GHz`;
        bpuValue = ratio;
      } else if (ratio >= 0) {
        bpu = `${ratio}%`; bpuValue = ratio;
      } else if (freqCandidate) {
        bpu = `${(freqCandidate / 1e9).toFixed(1)}GHz`;
      }
    }
  }

  if (bpu === '--') {
    const bpuIdx = lines.findIndex(l => l === '###BPU###');
    if (bpuIdx >= 0) {
      const bpuLines = lines.slice(bpuIdx + 1, bpuIdx + 8).join(' ');
      const m = bpuLines.match(/(\d{1,3})\s*%/);
      if (m) { bpu = `${m[1]}%`; bpuValue = Number(m[1]); }
      else if (/unavailable/i.test(bpuLines)) bpu = '不可用';
    }
  }

  // ── Uptime & CPU load (1m) ──
  const uptimeLine = findAfter('###UPTIME###');
  let uptime = '--', cpuLoad = '--';
  if (uptimeLine) {
    const um = uptimeLine.match(/up\s+(.*?)(?:,\s+\d+\s+user|,\s+load average)/);
    if (um) uptime = um[1].trim();
    const lm = uptimeLine.match(/load average:\s*([\d.]+)/);
    if (lm) cpuLoad = lm[1];
  }

  const { display: cpuUsage, val: cpuUsageVal } = parseTopCpuUsage(lines);

  // ── Disk (`df -h`，优先 /userdata) ──
  const diskIdx = lines.findIndex(l => l === '###DISK###');
  let diskUsed = '--', diskTotal = '--', diskPercent = -1;
  if (diskIdx >= 0) {
    const diskLine = pickDfDiskLine(lines, diskIdx);
    if (diskLine) {
      const parsed = parseDfHLine(diskLine);
      if (parsed) {
        diskTotal = parsed.total;
        diskUsed = parsed.used;
        diskPercent = parsed.pct;
      }
    }
  }

  return {
    temp,
    tempC,
    memUsed,
    memTotal,
    memPercent,
    bpu,
    bpuValue,
    cpuUsage,
    cpuUsageVal,
    cpuLoad,
    uptime,
    diskUsed,
    diskTotal,
    diskPercent,
    memAvailable,
    memAvailPercent,
    swapUsed,
    swapTotal,
    swapPercent,
    memAvailDisplay,
  };
}

/**
 * 与设备列表「在线」判定补全逻辑一致：诊断输出含有效遥测时认为 SSH 已能执行采集，
 * 用于在轻量 ping 误判时仍标为在线（由 DeviceProvider 全局轮询调用，与当前页面无关）。
 */
export function diagnosticsOutputImpliesReachable(output: string): boolean {
  const m = parseMetrics(output);
  const memory =
    m.memUsed !== '--' && m.memTotal !== '--' ? `${m.memUsed}/${m.memTotal}` : '--';
  const disk =
    m.diskUsed !== '--' && m.diskTotal !== '--' ? `${m.diskUsed}/${m.diskTotal}` : '--';
  return (
    memory !== '--' ||
    m.memAvailDisplay !== '--' ||
    disk !== '--' ||
    m.temp !== '--' ||
    m.cpuUsage !== '--' ||
    m.bpu !== '--' ||
    m.uptime !== '--'
  );
}
