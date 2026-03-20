/**
 * Parse structured diagnostic output from the device into typed metrics.
 *
 * The diagnostic command emits sections delimited by markers like
 * ###TEMP###, ###MEM###, ###BPU###, ###SOMSTATUS###, ###UPTIME###, ###DISK###.
 */

export interface DeviceMetrics {
  temp: string;
  tempC: number;
  memUsed: string;
  memTotal: string;
  memPercent: number;
  bpu: string;
  bpuValue: number;
  cpuLoad: string;
  uptime: string;
  diskUsed: string;
  diskTotal: string;
  diskPercent: number;
}

function parseMemToMB(str: string): number {
  const num = parseFloat(str);
  if (str.includes('Gi') || str.includes('G')) return num * 1024;
  if (str.includes('Mi') || str.includes('M')) return num;
  if (str.includes('Ki') || str.includes('K')) return num / 1024;
  return num;
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

  // ── Memory ──
  const memIdx = lines.findIndex(l => l === '###MEM###');
  let memUsed = '--', memTotal = '--', memPercent = -1;
  if (memIdx >= 0) {
    const memLine = lines.slice(memIdx + 1).find(l => /^mem:/i.test(l));
    if (memLine) {
      const parts = memLine.split(/\s+/);
      if (parts.length >= 3) {
        memTotal = parts[1];
        memUsed = parts[2];
        const totalMB = parseMemToMB(parts[1]);
        const usedMB = parseMemToMB(parts[2]);
        if (totalMB > 0) memPercent = Math.round((usedMB / totalMB) * 100);
      }
    }
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

  // ── Uptime & CPU load ──
  const uptimeLine = findAfter('###UPTIME###');
  let uptime = '--', cpuLoad = '--';
  if (uptimeLine) {
    const um = uptimeLine.match(/up\s+(.*?)(?:,\s+\d+\s+user|,\s+load average)/);
    if (um) uptime = um[1].trim();
    const lm = uptimeLine.match(/load average:\s*([\d.]+)/);
    if (lm) cpuLoad = lm[1];
  }

  // ── Disk ──
  const diskIdx = lines.findIndex(l => l === '###DISK###');
  let diskUsed = '--', diskTotal = '--', diskPercent = -1;
  if (diskIdx >= 0) {
    const diskLine = lines.slice(diskIdx + 1).find(l => l.includes('/'));
    if (diskLine) {
      const parts = diskLine.split(/\s+/);
      if (parts.length >= 5) {
        diskTotal = parts[1]; diskUsed = parts[2];
        const pct = parseInt(parts[4]);
        if (!isNaN(pct)) diskPercent = pct;
      }
    }
  }

  return { temp, tempC, memUsed, memTotal, memPercent, bpu, bpuValue, cpuLoad, uptime, diskUsed, diskTotal, diskPercent };
}
