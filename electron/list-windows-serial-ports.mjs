/**
 * Windows：枚举与「设备管理器 → 端口(COM 和 LPT)」一致的串口。
 *
 * 说明：
 * - `Win32_SerialPort` 往往**不包含**蓝牙「标准串行」等虚拟 COM，与设备管理器不一致。
 * - `Win32_PnPEntity` 且 `PNPClass = 'Ports'` 与设备管理器中「端口」节点同源思路，含 USB/蓝牙等。
 * @see https://learn.microsoft.com/windows/win32/cimwin32prov/win32-pnpentity
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$byCom = @{}
function Add-PortRow($com, $friendlyName, $pnpId) {
  if (-not $com) { return }
  $comU = $com.ToUpperInvariant()
  if ($byCom.ContainsKey($comU)) { return }
  $usbVid = $null; $usbPid = $null
  # 仅 USB 复合设备路径；勿用 $pid（与自动变量 $PID 进程号冲突）
  if ($pnpId -and ($pnpId -match 'USB\\\\VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})')) {
    $usbVid = [Convert]::ToInt32($matches[1], 16)
    $usbPid = [Convert]::ToInt32($matches[2], 16)
  }
  $byCom[$comU] = [PSCustomObject]@{
    deviceId = $comU
    name = [string]$friendlyName
    instanceId = if ($pnpId) { [string]$pnpId } else { '' }
    usbVendorId = $usbVid
    usbProductId = $usbPid
  }
}
Get-CimInstance Win32_PnPEntity | Where-Object {
  $_.PNPClass -eq 'Ports' -and $_.Name -match '\\(COM\\d+\\)'
} | ForEach-Object {
  $m = [regex]::Match($_.Name, '\\((COM\\d+)\\)')
  if (-not $m.Success) { return }
  Add-PortRow $m.Groups[1].Value $_.Name $_.PNPDeviceID
}
# 少数环境仅出现在 Win32_SerialPort，补并
Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue | ForEach-Object {
  Add-PortRow $_.DeviceID $_.Name $_.PNPDeviceID
}
$rows = @($byCom.Values)
$rows = $rows | Sort-Object { [int]($_.deviceId -replace 'COM','') }
if ($rows.Count -eq 0) { Write-Output '[]' } else { $rows | ConvertTo-Json -Compress -Depth 6 }
`.trim();

/**
 * @returns {{ ok: boolean, ports?: Array<{ deviceId: string, name: string, instanceId?: string, usbVendorId: number|null, usbProductId: number|null }>, error?: string }}
 */
export async function listWindowsSerialPorts() {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'not_windows', ports: [] };
  }
  try {
    const b64 = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 25_000 },
    );
    const text = String(stdout ?? '').trim();
    if (!text) {
      return { ok: true, ports: [] };
    }
    const parsed = JSON.parse(text);
    const raw = Array.isArray(parsed) ? parsed : [parsed];
    const ports = raw.map((p) => ({
      deviceId: String(p.deviceId ?? ''),
      name: String(p.name ?? ''),
      instanceId: p.instanceId != null && String(p.instanceId).trim() !== '' ? String(p.instanceId) : undefined,
      usbVendorId: p.usbVendorId == null || p.usbVendorId === '' ? null : Number(p.usbVendorId),
      usbProductId: p.usbProductId == null || p.usbProductId === '' ? null : Number(p.usbProductId),
    }));
    return { ok: true, ports };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ports: [],
    };
  }
}
