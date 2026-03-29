/**
 * 在 Electron `select-serial-port` 的列表中弱化干扰项：
 * - 蓝牙音频 / 耳机类 RFCOMM（常为 MAC 地址 + 耳机名）
 * - Windows 下 BTHENUM 虚拟 COM（与 RDK USB 调试线场景无关时用户可跳过）
 *
 * 若过滤后为空，调用方应回退为原始列表，避免无法选口。
 * @param {Array<{ portId: string, portName?: string, displayName?: string, deviceInstanceId?: string }>} ports
 */
export function filterRdkSerialPickerPorts(ports) {
  if (!Array.isArray(ports) || ports.length === 0) return ports;
  const out = [];
  for (const p of ports) {
    const dn = String(p.displayName ?? '');
    const pn = String(p.portName ?? '');
    const di = String(p.deviceInstanceId ?? '').toUpperCase();
    if (isLikelyBluetoothAudio(dn, pn)) continue;
    if (di.includes('BTHENUM')) continue;
    out.push(p);
  }
  return out.length > 0 ? out : ports;
}

function isLikelyBluetoothAudio(dn, pn) {
  const blob = `${dn} ${pn}`;
  const mac = /\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/i;
  if (mac.test(dn) || mac.test(pn)) {
    const comOnly = /^COM\d+$/i;
    if (!comOnly.test(pn.trim()) && !comOnly.test(dn.trim())) return true;
  }
  const audio =
    /freebuds|dupods|airpods|buds|galaxy buds|headphone|headset|hands[\s-]?free|earphone|耳机|扬声器|speaker|soundbar|\ba2dp\b|\bhfp\b|\bhsp\b|audio device|立体声|sound/i;
  return audio.test(blob);
}
