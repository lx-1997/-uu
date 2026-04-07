/**
 * 套件端 VNC 启动/检测脚本：经 SSH 执行，避免在 server/index.ts 内嵌超长引号串导致
 * Windows/ssh2 传参时 `$()`、`$p` 等被错误展开或截断。
 *
 * 策略：base64 管道到 bash，保证远端收到与开发机一致的脚本字节。
 */

function buildProbePortScript(): string {
  return [
    '#!/bin/bash',
    'set +e',
    'is_vnc_listener_port() {',
    '  p="$1"',
    '  _ss="$(ss -lntp 2>/dev/null || true)"',
    '  _ns="$(ss -lnt 2>/dev/null || true)"',
    '  _ps="$(pgrep -af \'x11vnc|Xtigervnc|Xvnc|vncserver\' 2>/dev/null || true)"',
    '  if echo "$_ss" | grep -E ":$p( |$)" | grep -Eiq "x11vnc|Xtigervnc|Xvnc|vncserver"; then',
    '    return 0',
    '  fi',
    '  if [ -n "$_ps" ] && echo "$_ns" | grep -q ":$p"; then',
    '    return 0',
    '  fi',
    '  return 1',
    '}',
    'probe_port() {',
    '  for p in 5900 5901; do',
    '    if is_vnc_listener_port "$p"; then echo "$p"; return 0; fi',
    '  done',
    '  return 1',
    '}',
    '',
  ].join('\n');
}

/** GET /services/vnc — 检测监听与进程（不启动） */
export function buildVncStatusBash(): string {
  return [
    '#!/bin/bash',
    'set +e',
    '_ss="$(ss -lntp 2>/dev/null || true)"',
    '_ns="$(ss -lnt 2>/dev/null || true)"',
    '_ps="$(pgrep -af \'x11vnc|Xtigervnc|Xvnc|vncserver\' 2>/dev/null || true)"',
    'PORT=""',
    'for p in 5900 5901; do',
    '  if echo "$_ss" | grep -E ":$p( |$)" | grep -Eiq "x11vnc|Xtigervnc|Xvnc|vncserver"; then PORT=$p; break; fi',
    '  if [ -n "$_ps" ] && echo "$_ns" | grep -q ":$p"; then PORT=$p; break; fi',
    'done',
    'if [ -n "$PORT" ]; then echo VNC_ACTIVE; echo VNC_PORT=$PORT',
    'elif [ -n "$_ps" ]; then echo VNC_STALE_PROCESS',
    'else echo VNC_INACTIVE',
    'fi',
    'systemctl is-active x11vnc 2>/dev/null || true',
    'systemctl is-active vncserver 2>/dev/null || true',
    'echo "$_ps"',
  ].join('\n');
}

/** POST /services/vnc/start — 启动或确认 VNC */
export function buildVncStartBash(): string {
  return [
    buildProbePortScript(),
    'PORT="$(probe_port || true)"',
    '',
    'if [ -n "$PORT" ]; then',
    '  echo VNC_STARTED',
    '  echo VNC_PORT=$PORT',
    '  exit 0',
    'fi',
    '',
    'pkill -f "x11vnc.*-rfbport 5900" 2>/dev/null || true',
    'sleep 1',
    '',
    'if ! command -v xauth >/dev/null 2>&1; then',
    '  apt-get update -qq 2>/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y xauth 2>/dev/null || true',
    'fi',
    '',
    '# 仅在显示管理器未运行时尝试启动，避免对已运行的 X 会话造成不必要扰动（OpenClaw 装完后内存紧张时尤甚）',
    '_dm_active() {',
    '  systemctl is-active --quiet display-manager.service 2>/dev/null && return 0',
    '  systemctl is-active --quiet lightdm.service 2>/dev/null && return 0',
    '  systemctl is-active --quiet gdm.service 2>/dev/null && return 0',
    '  systemctl is-active --quiet gdm3.service 2>/dev/null && return 0',
    '  systemctl is-active --quiet sddm.service 2>/dev/null && return 0',
    '  return 1',
    '}',
    'if ! _dm_active; then',
    '  systemctl start display-manager 2>/dev/null || systemctl start lightdm 2>/dev/null || systemctl start gdm 2>/dev/null || true',
    '  sleep 3',
    'fi',
    '',
    'PORT="$(probe_port || true)"',
    'if [ -n "$PORT" ]; then',
    '  echo VNC_STARTED',
    '  echo VNC_PORT=$PORT',
    '  exit 0',
    'fi',
    '',
    'if command -v x11vnc >/dev/null 2>&1; then',
    '  for d in "${DISPLAY:-:0}" :0 :1 :2; do',
    '    nohup x11vnc -display "$d" -auth guess -rfbport 5900 -passwd 88888888 -shared -forever -bg >/tmp/x11vnc.log 2>&1 || true',
    '    sleep 2',
    '    PORT="$(probe_port || true)"',
    '    [ -n "$PORT" ] && break',
    '  done',
    'fi',
    '',
    'if [ -n "$PORT" ]; then',
    '  echo VNC_STARTED',
    '  echo VNC_PORT=$PORT',
    '  exit 0',
    'fi',
    '',
    'if command -v vncserver >/dev/null 2>&1; then',
    '  vncserver :0 >/tmp/vncserver.log 2>&1 || vncserver :1 >/tmp/vncserver.log 2>&1 || true',
    '  sleep 2',
    '  PORT="$(probe_port || true)"',
    'fi',
    '',
    'if [ -n "$PORT" ]; then',
    '  echo VNC_STARTED',
    '  echo VNC_PORT=$PORT',
    '  exit 0',
    'fi',
    '',
    'if command -v Xvfb >/dev/null 2>&1 && command -v x11vnc >/dev/null 2>&1; then',
    '  pkill -f "Xvfb :99" 2>/dev/null || true',
    '  nohup Xvfb :99 -screen 0 1280x720x24 >/tmp/xvfb99.log 2>&1 &',
    '  sleep 2',
    '  export DISPLAY=:99',
    '  nohup x11vnc -display :99 -auth guess -rfbport 5900 -passwd 88888888 -shared -forever -bg >/tmp/x11vnc.log 2>&1 || true',
    '  sleep 2',
    '  PORT="$(probe_port || true)"',
    'fi',
    '',
    'if [ -n "$PORT" ]; then',
    '  echo VNC_STARTED',
    '  echo VNC_PORT=$PORT',
    '  exit 0',
    'fi',
    '',
    'echo VNC_START_FAILED',
    'exit 1',
  ].join('\n');
}

export function buildVncStatusRemoteExec(): string {
  const b64 = Buffer.from(buildVncStatusBash(), 'utf8').toString('base64');
  return `bash -lc 'echo ${b64} | base64 -d | /bin/bash'`;
}

export function buildVncStartRemoteExec(): string {
  const b64 = Buffer.from(buildVncStartBash(), 'utf8').toString('base64');
  return `bash -lc 'echo ${b64} | base64 -d | /bin/bash'`;
}
