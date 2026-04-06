/**
 * noVNC / RFB 上报的英文断开原因后，追加可读排查说明（WebSocket 关闭码等）
 * @see https://datatracker.ietf.org/doc/html/rfc6455#section-7.4.1
 */
export function augmentVncDisconnectDetail(
  raw: string,
  t: (key: string, zh: string) => string,
): string {
  const s = raw.trim();
  if (!s) return raw;

  const hints: string[] = [];
  if (/\b1005\b/.test(s)) {
    hints.push(
      t(
        'vnc.err.hintWs1005',
        '说明：1005 表示连接在未收到标准关闭帧的情况下断开，常见于网络闪断、反向代理未正确转发 WebSocket、或 Studio 到套件 5900 的链路被重置。请确认：① 套件上 x11vnc 已监听 5900；② 局域网直连时 PC 能访问设备 IP:5900；③ 经 SSH 隧道时设备在线且 SSH 正常；④ Nginx/Caddy 等需配置 Upgrade 与 /websockify。',
      ),
    );
    hints.push(
      t(
        'vnc.err.hintWs1005NoX',
        '说明：若 x11vnc 已在运行但板卡未启动图形桌面（无 Xorg / 无可用 DISPLAY，如 :0），VNC 没有可映射的画面，连接可能立刻失败并表现为 1005。请在终端确认存在图形会话（如 ps 中有 Xorg 或显示管理器），或按镜像文档启动桌面（如 systemctl 启动显示管理、startx 等）。',
      ),
    );
  }
  if (/\b1006\b/.test(s)) {
    hints.push(
      t(
        'vnc.err.hintWs1006',
        '说明：1006 为异常关闭，多为网络中断或对端强制断开。可重试连接并检查防火墙与设备侧 VNC 进程。',
      ),
    );
  }

  if (hints.length === 0) return raw;
  return `${raw}\n\n${hints.join('\n\n')}`;
}
