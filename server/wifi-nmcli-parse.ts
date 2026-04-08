/**
 * 解析套件端 nmcli WiFi 扫描输出（UTF-8 SSID，含中文）。
 * 勿使用 LANG=C：C locale 会损坏非 ASCII 的 SSID 显示。
 */

/**
 * exec 将 stderr 与 stdout 合并；板端读 `.bashrc` 失败、sudo 提示等会混入输出，
 * terse 解析会把这些行误当成 SSID。解析前剔除。
 */
export function sanitizeWifiScanOutput(raw: string): string {
  return (raw || '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^(bash|sh|dash|zsh):\s/i.test(t)) return false;
      if (/Input\/output error/i.test(t)) return false;
      if (/^sudo:\s/i.test(t)) return false;
      if (/^\[(?:SSH Error|ERROR|TIMEOUT)\]/i.test(t)) return false;
      return true;
    })
    .join('\n');
}

/** nmcli --terse 对字段内 `:`、`\` 的转义，需还原后再作为 SSID */
function unescapeNmcliTerseSsid(s: string): string {
  if (!/\\/.test(s)) return s;
  return s.replace(/\\([\\:])/g, (_, x: string) => (x === ':' ? ':' : '\\'));
}

/**
 * 解析 `nmcli -t -f SSID device wifi list`：每行一个 SSID，或 `SSID:名称`。
 * 排除表头、隐藏网占位「--」。
 */
export function parseWifiSsidsTerse(output: string): string[] {
  const names = (output || '')
    .split(/\r?\n/)
    .map((s) => {
      let t = s.trim();
      if (t.startsWith('SSID:')) t = t.slice(5).trim();
      return unescapeNmcliTerseSsid(t);
    })
    .filter((s) => s && s !== 'SSID' && s !== '--');
  return [...new Set(names)];
}

/** 匹配 BSSID（MAC），用于在表格行中定位 SSID 列（避免 IN-USE 为空时按列分割错位） */
const NMCLI_WIFI_MAC_RE = /\b([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/;

/**
 * 解析 `nmcli device wifi list` 表格（与终端一致）：在 BSSID 之后、MODE 等之前取 SSID。
 * 需在 UTF-8 locale 下执行 nmcli，否则中文 SSID 会变为 `?` 或乱码。
 */
export function parseWifiSsidsFromNmcliTable(output: string): string[] {
  const lines = (output || '').split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const names: string[] = [];
  let sawHeader = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/\bSSID\b/.test(line) && /\bBSSID\b/.test(line)) {
      sawHeader = true;
      continue;
    }
    if (!sawHeader) continue;
    const m = line.match(NMCLI_WIFI_MAC_RE);
    if (!m || m.index === undefined) continue;
    const afterMac = line.slice(m.index + m[0].length).trim();
    const parts = afterMac.split(/\s{2,}/);
    const ssid = parts[0]?.trim();
    if (ssid && ssid !== '--') names.push(ssid);
  }
  return [...new Set(names)];
}

/**
 * 含 IN-USE/BSSID/SSID 表头时必须先走表格解析；若先走 terse 会把整行误当成 SSID。
 */
export function parseWifiSsidsFromNmcliOutput(output: string): string[] {
  const text = sanitizeWifiScanOutput(output || '');
  if (/\bSSID\b/.test(text) && /\bBSSID\b/.test(text)) {
    return parseWifiSsidsFromNmcliTable(text);
  }
  return parseWifiSsidsTerse(text);
}
