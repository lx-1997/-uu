/**
 * Parse structured diagnostic output from the device into typed metrics.
 *
 * The diagnostic command emits sections delimited by markers like
 * ###BOARD###, ###TEMP###, ###MEM###, ###DMEM### (dmesg 物理内存总量), ###BPU###, ###SOMSTATUS###, ###UPTIME###, ###DISK###, ###TOP###.
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
  /**
   * `dmesg` 中 `Memory: availK/totalK` 的板载物理总内存（`/totalK`），与 `free` 的 Mem total 可能不同（如 S100 大量 reserved）。
   * 供首页 MEM 分母展示；未解析到时为 null。
   */
  memPhysicalTotalDisplay: string | null;
  /** `board_id` 或设备树 model 行，未知或缺失为空串 */
  boardModelFromProbe: string;
}

/** 解析诊断输出时传入板型，用于 S100 磁盘行选取等特殊逻辑 */
export interface ParseMetricsOptions {
  boardModel?: string | null;
  boardPlatform?: string | null;
}

/** 与 `free -h` 风格接近：KiB（内核 dmesg）→ `12Gi` / `12.0Gi` */
function formatKibToGiDisplay(kib: number): string {
  if (!Number.isFinite(kib) || kib <= 0) return '--';
  const gib = kib / 1024 / 1024;
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)}Ti`;
  const rounded = Math.round(gib * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return `${Math.round(rounded)}Gi`;
  return `${rounded.toFixed(1)}Gi`;
}

/**
 * 设备树 / 板型字段是否指向 S100（用于首页 MEM 分母用 dmesg 物理总量）。
 */
export function isS100BoardModel(
  model: string | null | undefined,
  boardPlatform?: string | null,
): boolean {
  if (String(boardPlatform || '').trim() === 'rdk-s100') return true;
  const s = String(model || '').trim();
  if (!s) return false;
  if (/\bS100\b/i.test(s)) return true;
  return /rdk[_-]?s100/i.test(s);
}

/**
 * 已识别为 X3/X5/Ultra 等时，首页 MEM 分母应信 `free` 的 Mem total，勿用 dmesg 物理量覆盖。
 */
function isKnownNonS100RdkBoard(
  model: string | null | undefined,
  platform: string | null | undefined,
): boolean {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'rdk-x5' || p === 'rdk-x3' || p === 'rdk-ultra') return true;
  const s = String(model || '').trim();
  if (!s || /\bS100\b/i.test(s)) return false;
  if (/\bX5\b/i.test(s)) return true;
  if (/\bX3\b/i.test(s)) return true;
  if (/\bUltra\b/i.test(s)) return true;
  return false;
}

/**
 * dmesg 物理总量与 `free` 的 Mem total 明显不一致时（如 S100 大量 reserved），
 * 即使未在设备列表里写入板型也应展示物理总量。
 */
function dmesgPhysicalExceedsFreeMemTotal(
  physicalDisplay: string | null,
  freeTotalDisplay: string,
): boolean {
  if (!physicalDisplay) return false;
  const p = parseMemToMB(physicalDisplay);
  const v = parseMemToMB(freeTotalDisplay);
  if (p <= 0 || v <= 0) return false;
  return p > v * 1.02;
}

/** 首页 MEM 格：`已用/总量`；S100 或 dmesg 物理量大于可见 Mem 时，分母为板载物理内存 */
export function formatDashboardMemoryDisplay(
  m: DeviceMetrics,
  boardModel?: string | null,
  boardPlatform?: string | null,
): string {
  if (m.memUsed === '--' || m.memTotal === '--') return '--';
  const physical = m.memPhysicalTotalDisplay;
  const usePhysical =
    !!physical &&
    (isS100BoardModel(boardModel, boardPlatform) ||
      (!isKnownNonS100RdkBoard(boardModel, boardPlatform) &&
        dmesgPhysicalExceedsFreeMemTotal(physical, m.memTotal)));
  const total = usePhysical ? physical : m.memTotal;
  return `${m.memUsed}/${total}`;
}

function normalizeBoardProbeLine(raw: string): string {
  let s = String(raw || '').replace(/\0/g, '').trim();
  if (!s || /^unknown$/i.test(s) || /^unknown-board$/i.test(s)) return '';
  /** 与下一诊断段粘在同一行时截断，如 `…V1P0###UPTIME###` */
  const hashIdx = s.indexOf('###');
  if (hashIdx >= 0) s = s.slice(0, hashIdx).trim();
  return s;
}

/**
 * 仪表盘设备型号：统一为「RDK S100」「RDK X5」等短名；无法识别则返回空串。
 */
export function formatDashboardBoardModelDisplay(raw: string): string {
  let s = normalizeBoardProbeLine(raw);
  if (!s) return '';
  s = s.replace(/^D[- ]?Robotics\s*/i, '').trim();
  /** 硬件版本尾缀，如 V1P0、V01 */
  s = s.replace(/\s+V\d+P\d+$/i, '').trim();
  s = s.replace(/\s+V\d+$/i, '').trim();

  if (/rdk[-_]?s100\b/i.test(s) || /\bS100\b/i.test(s)) return 'RDK S100';
  if (/rdk[-_]?x5\b/i.test(s) || /\bX5\b/i.test(s)) return 'RDK X5';
  if (/rdk[-_]?x3\b/i.test(s) || /\bX3\b/i.test(s)) return 'RDK X3';
  if (/rdk[-_]?ultra\b/i.test(s) || /\bUltra\b/i.test(s)) return 'RDK Ultra';

  const m = s.match(/\bRDK\s+([A-Za-z0-9]+)\b/i);
  if (m) {
    const key = m[1].toLowerCase();
    const map: Record<string, string> = {
      s100: 'RDK S100',
      x5: 'RDK X5',
      x3: 'RDK X3',
      ultra: 'RDK Ultra',
    };
    if (map[key]) return map[key];
  }
  return '';
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

/** 解析 `df -h` 的 Size/Used 列（如 `2.0G`、`28K`）为字节，无法识别时 NaN */
function parseDfHumanSizeToBytes(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([KMGT])i?B?$/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0) return NaN;
  const u = m[2].toUpperCase();
  const mult =
    u === 'T' ? 1024 ** 4
      : u === 'G' ? 1024 ** 3
        : u === 'M' ? 1024 ** 2
          : u === 'K' ? 1024
            : NaN;
  return n * mult;
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
 * 无板型信息时的兜底：S100 等镜像上 `/userdata` 常为独立小分区（数 Gi），根 `/` 大得多；
 * 若仍按「优先 userdata」会显示成 `28K/2.0G」类误导。满足下列条时改优先根分区：
 * - `/userdata` 分区总容量 ≤ 8Gi
 * - 根分区总容量 ≥ `/userdata` 的 6 倍
 */
function diskLayoutSuggestsPreferRootOverUserdata(
  userdataRow: string,
  rootRow: string,
): boolean {
  const u = parseDfHLine(userdataRow);
  const r = parseDfHLine(rootRow);
  if (!u || !r) return false;
  const bu = parseDfHumanSizeToBytes(u.total);
  const br = parseDfHumanSizeToBytes(r.total);
  if (!Number.isFinite(bu) || !Number.isFinite(br) || bu <= 0 || br <= 0) return false;
  const maxUserdataBytes = 8 * 1024 ** 3;
  if (bu > maxUserdataBytes) return false;
  if (br < bu * 6) return false;
  return true;
}

/**
 * `df -h` 数据行选取：
 * - 默认：优先 `/userdata`，其次 `/`（根分区）
 * - 已知 S100 板型：优先 `/`
 * - 未知板型：`diskLayoutSuggestsPreferRootOverUserdata` 命中时优先 `/`（解决快捷连接未写入 boardModel 的情况）
 */
function pickDfDiskLine(
  lines: string[],
  diskIdx: number,
  preferRootOverUserdata: boolean,
): string | null {
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
  const root = data.find((row) => mnt(row) === '/');
  const preferRoot =
    preferRootOverUserdata
    || Boolean(userdata && root && diskLayoutSuggestsPreferRootOverUserdata(userdata, root));
  if (preferRoot) {
    if (root) return root;
    if (userdata) return userdata;
  } else {
    if (userdata) return userdata;
    if (root) return root;
  }
  return data[0] ?? null;
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

export function parseMetrics(output: string, opts?: ParseMetricsOptions): DeviceMetrics {
  const rawLines = output.split(/\r?\n/).map((l) => l.trim());
  /** SSH 非零退出时尾部可能带 `[stderr]` / `[exit code: …]`，避免污染 somstatus/top 解析 */
  const cutIdx = rawLines.findIndex((l) => /^\[(stderr|exit code:)/i.test(l));
  const lines = cutIdx >= 0 ? rawLines.slice(0, cutIdx) : rawLines;

  let boardModelFromProbe = '';
  const boardIdx = lines.findIndex((l) => l === '###BOARD###');
  if (boardIdx >= 0) {
    for (let i = boardIdx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || line.startsWith('###')) break;
      const n = normalizeBoardProbeLine(line);
      if (n) {
        boardModelFromProbe = n;
        break;
      }
    }
  }

  const findAfter = (marker: string) => {
    const idx = lines.findIndex(l => l === marker);
    if (idx < 0) return '';
    return lines.slice(idx + 1).find(l => l.length > 0 && !l.startsWith('###')) ?? '';
  };

  // ── Temperature ──
  const tempRaw = findAfter('###TEMP###');
  const tempNum = Number(tempRaw);
  /** millidegree（常见 45000+）与少数驱动直接输出摄氏度整数（~20–105） */
  let tempC = -1;
  if (Number.isFinite(tempNum) && tempNum > 0) {
    if (tempNum >= 1000) tempC = tempNum / 1000;
    else if (tempNum <= 200) tempC = tempNum;
    else tempC = tempNum / 1000;
  }
  let temp = tempC > 0 ? `${tempC.toFixed(1)}°C` : (tempRaw || '--');
  const thermalZoneLooksValid = tempC > 0 && tempC <= 120 && String(tempRaw).trim() !== 'N/A';

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

  // ── dmesg 板载物理总内存（`Memory: availK/totalK` 中 `/` 后为片上物理总量，可与 `free` 的 Mem 行 total 不同）──
  const dmemIdx = lines.findIndex((l) => l === '###DMEM###');
  let memPhysicalTotalDisplay: string | null = null;
  if (dmemIdx >= 0) {
    for (let i = dmemIdx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith('###')) break;
      if (!line) continue;
      const phy = line.match(/Memory:\s*\d+K\/(\d+)K/i);
      if (phy) {
        const k = parseInt(phy[1], 10);
        if (k > 0) {
          const disp = formatKibToGiDisplay(k);
          memPhysicalTotalDisplay = disp === '--' ? null : disp;
        }
        break;
      }
    }
  }

  // ── BPU (prefer SOMSTATUS, fallback to hrut_smi / bputop) ──
  let bpu = '--', bpuValue = -1;
  const somIdx = lines.findIndex(l => l === '###SOMSTATUS###');
  if (somIdx >= 0) {
    const somLines = lines.slice(somIdx + 1);

    /**
     * 仅当 sysfs 温度无效时，才用 somstatus 补温度；且行内须像「温度」而非 CPU 频率（S100/X5 上
     * `CPU: 1.8` 类字段曾误覆盖为 1.8°C）。
     */
    if (!thermalZoneLooksValid) {
      const cpuTempLine = somLines.find(
        (l) =>
          /(?:CPU|GPU|Soc|A55|BPU).*(?:[Tt]emp|温度|°\s*C|°C)/i.test(l) ||
          (/(?:CPU|GPU)\s*:\s*[\d.]+/.test(l) && /(?:°C|℃|[Tt]emp)/.test(l)),
      );
      if (cpuTempLine) {
        const tm =
          cpuTempLine.match(/(?:[Tt]emp|温度)\s*[:：]?\s*([\d.]+)/) ||
          cpuTempLine.match(/([\d.]+)\s*°?\s*[Cc]/);
        if (tm) {
          const value = parseFloat(tm[1]);
          if (value > 0 && value <= 120) {
            tempC = value;
            temp = `${value.toFixed(1)}°C`;
          }
        }
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
      } else if (ratio >= 0 && ratio <= 100) {
        bpu = `${ratio}%`; bpuValue = ratio;
      } else if (freqCandidate) {
        bpu = `${(freqCandidate / 1e9).toFixed(1)}GHz`;
      }
    }
  }

  if (bpuValue > 100) {
    bpu = '--';
    bpuValue = -1;
  }

  if (bpu === '--') {
    const bpuIdx = lines.findIndex(l => l === '###BPU###');
    if (bpuIdx >= 0) {
      const bpuSlice = lines.slice(bpuIdx + 1, bpuIdx + 12).join('\n');
      const sysfs = bpuSlice.match(/SYSFS_BPU_RATIO:\s*(\d{1,3})\b/);
      if (sysfs) {
        const v = Number(sysfs[1]);
        if (v >= 0 && v <= 100) {
          bpu = `${v}%`;
          bpuValue = v;
        }
      }
      if (bpu === '--') {
        const bpuLines = lines.slice(bpuIdx + 1, bpuIdx + 8).join(' ');
        const m = bpuLines.match(/(\d{1,3})\s*%/);
        if (m) {
          const v = Number(m[1]);
          if (v <= 100) {
            bpu = `${m[1]}%`;
            bpuValue = v;
          }
        } else if (/unavailable/i.test(bpuLines)) bpu = '不可用';
      }
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

  // ── Disk (`df -h`；默认优先 /userdata；S100 优先 /) ──
  const diskIdx = lines.findIndex(l => l === '###DISK###');
  let diskUsed = '--', diskTotal = '--', diskPercent = -1;
  if (diskIdx >= 0) {
    const preferRootDisk =
      isS100BoardModel(opts?.boardModel, opts?.boardPlatform);
    const diskLine = pickDfDiskLine(lines, diskIdx, preferRootDisk);
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
    memPhysicalTotalDisplay,
    boardModelFromProbe,
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
