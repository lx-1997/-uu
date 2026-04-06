export NPM_CONFIG_PREFIX="$HOME/.npm-global" && export PATH="$HOME/.npm-global/bin:$PATH" && export NO_COLOR=1 FORCE_COLOR=0 && (
OPENCLAW_MIN_NODE_MAJOR="${OPENCLAW_MIN_NODE_MAJOR:-24}";
if command -v node >/dev/null 2>&1; then
_NODE_V="$(node -v 2>/dev/null || echo v0)";
_NODE_MAJ="${_NODE_V#v}";
_NODE_MAJ="${_NODE_MAJ%%.*}";
: "${_NODE_MAJ:=0}";
else
echo "[OpenClaw] 未检测到 node，将安装 Node 24 LTS（NodeSource）" 1>&2;
_NODE_V="v0";
_NODE_MAJ=0;
fi;
if [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then exit 0; fi;
if [ "${_NODE_MAJ:-0}" -gt 0 ]; then echo "[OpenClaw] Node 已过时 ${_NODE_V}，需要 >= ${OPENCLAW_MIN_NODE_MAJOR}" 1>&2; fi;
if [ "${OPENCLAW_SKIP_NODE_UPGRADE:-0}" = "1" ]; then echo "[OpenClaw] 错误: 已设置 OPENCLAW_SKIP_NODE_UPGRADE=1，跳过自动升级。请手动安装 Node.js ${OPENCLAW_MIN_NODE_MAJOR}+ 后重试。" 1>&2; exit 1; fi;
OC_NODE_BOOTSTRAP_OK=0
if command -v apt-get >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
_oc_ai=0
_oc_lock_wait_ok=1
while [ "$_oc_ai" -lt 120 ]; do
_oc_ab=0
if command -v fuser >/dev/null 2>&1; then fuser /var/lib/apt/lists/lock >/dev/null 2>&1 && _oc_ab=1; fuser /var/lib/dpkg/lock >/dev/null 2>&1 && _oc_ab=1; fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && _oc_ab=1; else pgrep -x apt-get >/dev/null 2>&1 && _oc_ab=1; pgrep -x apt >/dev/null 2>&1 && _oc_ab=1; pgrep -x dpkg >/dev/null 2>&1 && _oc_ab=1; fi
if [ "$_oc_ab" = 0 ]; then break; fi
_oc_ai=$((_oc_ai+1))
echo "[OpenClaw] 等待 apt/dpkg 锁释放（其他 apt 可能正在运行）... ($_oc_ai/120)" 1>&2
sleep 1
done
if [ "$_oc_ai" -ge 120 ]; then echo "[OpenClaw] 警告: apt 锁 120s 内未释放，跳过 apt 路径并尝试非 apt 兜底。可稍后重试，或先: sudo fuser -v /var/lib/apt/lists/lock /var/lib/dpkg/lock" 1>&2; _oc_lock_wait_ok=0; fi
if [ "${_oc_lock_wait_ok:-1}" = "1" ] && [ "$(id -u)" -eq 0 ]; then
DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;
echo "[OpenClaw] 升级 Node 24 LTS（预清理 apt 冲突包）" 1>&2;
DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev nodejs 2>&1 || true;
DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1 || true;
DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 || true;
rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true;
OC_NS_URL="${OPENCLAW_NODESOURCE_BASE:-https://deb.nodesource.com}/setup_24.x";
OC_NS_SH="/tmp/oc_nodesource_setup.sh";
if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 320 "$OC_NS_URL" -o "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本下载失败（常见: SSL_read reset/网络抖动），改用二进制兜底" 1>&2; rm -f "$OC_NS_SH"; else if ! bash "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本执行失败（见上方输出），改用二进制兜底" 1>&2; rm -f "$OC_NS_SH"; else rm -f "$OC_NS_SH"; DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && OC_NODE_BOOTSTRAP_OK=1 || true; fi; fi;
elif [ "${_oc_lock_wait_ok:-1}" = "1" ] && command -v sudo >/dev/null 2>&1; then
sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;
echo "[OpenClaw] 升级 Node 24 LTS（预清理 apt 冲突包）" 1>&2;
sudo env DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev nodejs 2>&1 || true;
sudo env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1 || true;
sudo env DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 || true;
sudo rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true;
OC_NS_URL="${OPENCLAW_NODESOURCE_BASE:-https://deb.nodesource.com}/setup_24.x";
OC_NS_SH="/tmp/oc_nodesource_setup.sh";
if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 320 "$OC_NS_URL" -o "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本下载失败（常见: SSL_read reset/网络抖动），改用二进制兜底" 1>&2; rm -f "$OC_NS_SH"; else if ! sudo -E bash "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本执行失败（见上方输出），改用二进制兜底" 1>&2; sudo rm -f "$OC_NS_SH"; else sudo rm -f "$OC_NS_SH"; sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && OC_NODE_BOOTSTRAP_OK=1 || true; fi; fi;
else
echo "[OpenClaw] 提示: 无法走 NodeSource apt（缺少 root/sudo 或 apt 锁繁忙），改用二进制兜底。若要手动安装，可执行: curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/ns.sh && sudo bash /tmp/ns.sh && sudo apt-get install -y nodejs" 1>&2;
fi;
fi
if ! command -v node >/dev/null 2>&1; then _NODE_V="v0"; _NODE_MAJ=0; fi
_NODE_V="$(node -v 2>/dev/null || echo v0)";
_NODE_MAJ="${_NODE_V#v}";
_NODE_MAJ="${_NODE_MAJ%%.*}";
: "${_NODE_MAJ:=0}";
if ! [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then
echo "[OpenClaw] 尝试 Node 二进制包兜底安装..." 1>&2
OC_NODE_ARCH_RAW="$(uname -m 2>/dev/null || echo unknown)"
case "$OC_NODE_ARCH_RAW" in
  x86_64|amd64) OC_NODE_ARCH="linux-x64" ;;
  aarch64|arm64) OC_NODE_ARCH="linux-arm64" ;;
  armv7l|armv7*) OC_NODE_ARCH="linux-armv7l" ;;
  *) echo "[OpenClaw] Node 二进制兜底跳过：不支持架构 $OC_NODE_ARCH_RAW" 1>&2; exit 11 ;;
esac
if ! command -v curl >/dev/null 2>&1; then echo "[OpenClaw] Node 二进制兜底跳过：缺少 curl" 1>&2; exit 12; fi
if ! command -v tar >/dev/null 2>&1; then echo "[OpenClaw] Node 二进制兜底跳过：缺少 tar" 1>&2; exit 13; fi
OC_NODE_TMP="$(mktemp -d /tmp/oc-node-dist-XXXXXX)"
OC_NODE_DONE=0
for OC_NODE_BASE in ${OPENCLAW_NODE_DIST_BASES:-${NODEJS_ORG_MIRROR:-https://nodejs.org/dist} https://npmmirror.com/mirrors/node}; do
  OC_NODE_SUMS="$OC_NODE_TMP/SHASUMS256.txt"
  OC_NODE_RELEASE_URL="${OC_NODE_BASE%/}/latest-v${OPENCLAW_MIN_NODE_MAJOR}.x/SHASUMS256.txt"
  if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 20 --max-time 180 "$OC_NODE_RELEASE_URL" -o "$OC_NODE_SUMS"; then echo "[OpenClaw] Node 二进制兜底：获取索引失败 $OC_NODE_RELEASE_URL" 1>&2; continue; fi
  OC_NODE_FILE="$(grep -E " node-v[0-9.]+-${OC_NODE_ARCH}\.tar\.xz$" "$OC_NODE_SUMS" | head -n1 | tr -s " " | cut -d" " -f2)"
  if [ -z "$OC_NODE_FILE" ]; then echo "[OpenClaw] Node 二进制兜底：索引中无 ${OC_NODE_ARCH} 包" 1>&2; continue; fi
  OC_NODE_URL="${OC_NODE_BASE%/}/latest-v${OPENCLAW_MIN_NODE_MAJOR}.x/$OC_NODE_FILE"
  if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 480 "$OC_NODE_URL" -o "$OC_NODE_TMP/$OC_NODE_FILE"; then echo "[OpenClaw] Node 二进制兜底：下载失败 $OC_NODE_URL" 1>&2; continue; fi
  mkdir -p "$HOME/.local/lib" "$HOME/.npm-global/bin"
  OC_NODE_DIR="${OC_NODE_FILE%.tar.xz}"
  rm -rf "$HOME/.local/lib/$OC_NODE_DIR" 2>/dev/null || true
  if ! tar -xf "$OC_NODE_TMP/$OC_NODE_FILE" -C "$HOME/.local/lib" 2>/dev/null && ! tar -xJf "$OC_NODE_TMP/$OC_NODE_FILE" -C "$HOME/.local/lib" 2>/dev/null; then echo "[OpenClaw] Node 二进制兜底：解压失败 $OC_NODE_FILE" 1>&2; continue; fi
  if [ ! -x "$HOME/.local/lib/$OC_NODE_DIR/bin/node" ]; then echo "[OpenClaw] Node 二进制兜底：未找到 node 可执行文件" 1>&2; continue; fi
  ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/node" "$HOME/.npm-global/bin/node"
  [ -x "$HOME/.local/lib/$OC_NODE_DIR/bin/npm" ] && ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/npm" "$HOME/.npm-global/bin/npm" || true
  [ -x "$HOME/.local/lib/$OC_NODE_DIR/bin/npx" ] && ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/npx" "$HOME/.npm-global/bin/npx" || true
  [ -x "$HOME/.local/lib/$OC_NODE_DIR/bin/corepack" ] && ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/corepack" "$HOME/.npm-global/bin/corepack" || true
  export PATH="$HOME/.npm-global/bin:$HOME/.local/lib/$OC_NODE_DIR/bin:$PATH"
  hash -r 2>/dev/null || true
  if command -v node >/dev/null 2>&1; then OC_NODE_DONE=1; echo "[OpenClaw] Node 二进制兜底成功: $(node -v 2>/dev/null || echo unknown)" 1>&2; break; fi
done
rm -rf "$OC_NODE_TMP" 2>/dev/null || true
if [ "$OC_NODE_DONE" != "1" ]; then echo "[OpenClaw] Node 二进制兜底失败" 1>&2; exit 14; fi
fi;
hash -r 2>/dev/null || true;
_NODE_V="$(node -v 2>/dev/null || echo v0)";
_NODE_MAJ="${_NODE_V#v}";
_NODE_MAJ="${_NODE_MAJ%%.*}";
: "${_NODE_MAJ:=0}";
if ! [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then echo "[OpenClaw] 错误: 升级后 Node 仍为 ${_NODE_V}（需要 >= ${OPENCLAW_MIN_NODE_MAJOR}）。已尝试 NodeSource 与二进制兜底；若日志曾有 Could not get lock / apt 锁，请先结束其他 apt 再重试。也可手动安装后重试。" 1>&2; exit 1; fi;
echo "[OpenClaw] Node $(node -v) / npm $(npm --version 2>/dev/null || echo "?")";
) && (
if command -v npm >/dev/null 2>&1; then true;
else
echo "[OpenClaw] 正在安装 npm..." 1>&2;
if command -v corepack >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then (corepack enable 2>/dev/null || true) && CI=1 corepack prepare npm@latest --activate 2>&1 || true;
fi;
if ! command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then 
_oc_ai=0
_oc_lock_wait_ok=1
while [ "$_oc_ai" -lt 120 ]; do
_oc_ab=0
if command -v fuser >/dev/null 2>&1; then fuser /var/lib/apt/lists/lock >/dev/null 2>&1 && _oc_ab=1; fuser /var/lib/dpkg/lock >/dev/null 2>&1 && _oc_ab=1; fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && _oc_ab=1; else pgrep -x apt-get >/dev/null 2>&1 && _oc_ab=1; pgrep -x apt >/dev/null 2>&1 && _oc_ab=1; pgrep -x dpkg >/dev/null 2>&1 && _oc_ab=1; fi
if [ "$_oc_ab" = 0 ]; then break; fi
_oc_ai=$((_oc_ai+1))
echo "[OpenClaw] 等待 apt/dpkg 锁释放（其他 apt 可能正在运行）... ($_oc_ai/120)" 1>&2
sleep 1
done
if [ "$_oc_ai" -ge 120 ]; then echo "[OpenClaw] 警告: apt 锁 120s 内未释放，跳过 apt 路径并尝试非 apt 兜底。可稍后重试，或先: sudo fuser -v /var/lib/apt/lists/lock /var/lib/dpkg/lock" 1>&2; _oc_lock_wait_ok=0; fi
if [ "${_oc_lock_wait_ok:-1}" = "1" ] && [ "$(id -u)" -eq 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; DEBIAN_FRONTEND=noninteractive apt-get install -y npm || true;
elif [ "${_oc_lock_wait_ok:-1}" = "1" ] && command -v sudo >/dev/null 2>&1; then sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y npm || true;
else true; fi;
fi;
if ! command -v npm >/dev/null 2>&1 && command -v opkg >/dev/null 2>&1; then opkg update || true; (opkg install npm || opkg install nodejs-npm || true); fi;
if ! command -v npm >/dev/null 2>&1 && command -v apk >/dev/null 2>&1; then 
if [ "$(id -u)" -eq 0 ]; then apk add --no-cache npm;
elif command -v sudo >/dev/null 2>&1; then sudo apk add --no-cache npm;
else true; fi;
fi;
if ! command -v npm >/dev/null 2>&1 && command -v dnf >/dev/null 2>&1; then 
if [ "$(id -u)" -eq 0 ]; then dnf install -y npm;
elif command -v sudo >/dev/null 2>&1; then sudo dnf install -y npm;
else true; fi;
fi;
if ! command -v npm >/dev/null 2>&1 && command -v yum >/dev/null 2>&1; then 
if [ "$(id -u)" -eq 0 ]; then yum install -y npm;
elif command -v sudo >/dev/null 2>&1; then sudo yum install -y npm;
else true; fi;
fi;
if ! command -v npm >/dev/null 2>&1; then echo "[OpenClaw] 错误: 无法自动安装 npm，请手动安装后重试" 1>&2; exit 1; fi;
fi
) && OPENCLAW_CMD="$(command -v openclaw 2>/dev/null || true)" && if [ -n "$OPENCLAW_CMD" ] && [ ! -x "$OPENCLAW_CMD" ]; then OPENCLAW_CMD=""; fi && if [ -z "$OPENCLAW_CMD" ] && [ -x "$HOME/.npm-global/bin/openclaw" ]; then OPENCLAW_CMD="$HOME/.npm-global/bin/openclaw"; fi && if [ -z "$OPENCLAW_CMD" ] && [ -x "$HOME/.local/bin/openclaw" ]; then OPENCLAW_CMD="$HOME/.local/bin/openclaw"; fi && if [ -z "$OPENCLAW_CMD" ] && command -v npm >/dev/null 2>&1; then _OC_NPM_PF="$(npm prefix -g 2>/dev/null)"; if [ -n "$_OC_NPM_PF" ] && [ -x "$_OC_NPM_PF/bin/openclaw" ]; then OPENCLAW_CMD="$_OC_NPM_PF/bin/openclaw"; fi; fi && if [ -n "$OPENCLAW_CMD" ] && [ ! -x "$OPENCLAW_CMD" ]; then OPENCLAW_CMD=""; fi ; echo "────────────────────────────────────────────────────────" ; echo "[Studio] 环境准备（Node / npm / 目录）" ; echo "────────────────────────────────────────────────────────" ; node --version 2>&1 || true ; npm --version 2>&1 || true ; mkdir -p "$HOME/.openclaw" "$HOME/.npm-global" ; npm config set prefix "$HOME/.npm-global" 2>/dev/null ; npm config set fund false 2>/dev/null ; npm config set update-notifier false 2>/dev/null ; if command -v npm >/dev/null 2>&1; then if curl -fsS --connect-timeout 2 --max-time 5 https://registry.npmmirror.com/-/ping >/dev/null 2>&1; then NPM_FAST_REG=https://registry.npmmirror.com; ALT_REG=https://registry.npmjs.org; else NPM_FAST_REG=https://registry.npmjs.org; ALT_REG=https://registry.npmmirror.com; fi; npm config set registry "$NPM_FAST_REG" 2>/dev/null; npm config set maxsockets 32 2>/dev/null; npm config set fetch-retries 5 2>/dev/null; else true; fi ; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" --version 2>&1; else echo "openclaw: 未安装"; fi) ; ( echo 'aW1wb3J0IGpzb24KaW1wb3J0IG9zCgpwID0gb3MucGF0aC5leHBhbmR1c2VyKCJ+Ly5vcGVuY2xhdy9vcGVuY2xhdy5qc29uIikKb3MubWFrZWRpcnMob3MucGF0aC5kaXJuYW1lKHApLCBleGlzdF9vaz1UcnVlKQoKdHJ5OgogICAgd2l0aCBvcGVuKHAsICJyIiwgZW5jb2Rpbmc9InV0Zi04IikgYXMgZjoKICAgICAgICBkID0ganNvbi5sb2FkKGYpCmV4Y2VwdCBFeGNlcHRpb246CiAgICBkID0ge30KCmcgPSBkLmdldCgiZ2F0ZXdheSIpIGlmIGlzaW5zdGFuY2UoZC5nZXQoImdhdGV3YXkiKSwgZGljdCkgZWxzZSB7fQpnWyJtb2RlIl0gPSAibG9jYWwiCmdbImJpbmQiXSA9ICJsb29wYmFjayIKIyBTdHVkaW8g5o6i5rS75Zu65a6aIDE4Nzg577yb5LuF5L+u5q2j57y655yBL+epui/ljoblj7LmqKHmnb8gODA4MO+8jOS/neeVmeeUqOaIt+aYvuW8j+WFtuWug+err+WPowp0cnk6CiAgICBfcCA9IGludChnLmdldCgicG9ydCIpKSBpZiBnLmdldCgicG9ydCIpIG5vdCBpbiAoTm9uZSwgIiIpIGVsc2UgTm9uZQpleGNlcHQgKFR5cGVFcnJvciwgVmFsdWVFcnJvcik6CiAgICBfcCA9IE5vbmUKaWYgX3AgaXMgTm9uZSBvciBfcCA9PSA4MDgwOgogICAgZ1sicG9ydCJdID0gMTg3ODkKZFsiZ2F0ZXdheSJdID0gZwoKd2l0aCBvcGVuKHAsICJ3IiwgZW5jb2Rpbmc9InV0Zi04IikgYXMgZjoKICAgIGpzb24uZHVtcChkLCBmLCBpbmRlbnQ9MiwgZW5zdXJlX2FzY2lpPUZhbHNlKQ==' | base64 -d > /tmp/oc_fix_gateway_mode.py && python3 /tmp/oc_fix_gateway_mode.py ) 2>&1 || echo "[OpenClaw] gateway mode 脚本失败（已跳过）" >&2 ; ( echo 'aW1wb3J0IGpzb24KaW1wb3J0IG9zCmltcG9ydCBzZWNyZXRzCgpwID0gb3MucGF0aC5leHBhbmR1c2VyKCJ+Ly5vcGVuY2xhdy9vcGVuY2xhdy5qc29uIikKb3MubWFrZWRpcnMob3MucGF0aC5kaXJuYW1lKHApLCBleGlzdF9vaz1UcnVlKQoKdHJ5OgogIHdpdGggb3BlbihwLCAiciIsIGVuY29kaW5nPSJ1dGYtOCIpIGFzIGY6CiAgICBkID0ganNvbi5sb2FkKGYpCmV4Y2VwdCBFeGNlcHRpb246CiAgZCA9IHt9CgpnID0gZC5nZXQoImdhdGV3YXkiKSBpZiBpc2luc3RhbmNlKGQuZ2V0KCJnYXRld2F5IiksIGRpY3QpIGVsc2Uge30KYXV0aCA9IGcuZ2V0KCJhdXRoIikgaWYgaXNpbnN0YW5jZShnLmdldCgiYXV0aCIpLCBkaWN0KSBlbHNlIHt9CnRva2VuID0gc3RyKGF1dGguZ2V0KCJ0b2tlbiIpIG9yICIiKS5zdHJpcCgpCgppZiBub3QgdG9rZW46CiAgdG9rZW4gPSBzZWNyZXRzLnRva2VuX3VybHNhZmUoMzIpCiAgYXV0aFsidG9rZW4iXSA9IHRva2VuCiAgZ1siYXV0aCJdID0gYXV0aAogIGRbImdhdGV3YXkiXSA9IGcKICB3aXRoIG9wZW4ocCwgInciLCBlbmNvZGluZz0idXRmLTgiKSBhcyBmOgogICAganNvbi5kdW1wKGQsIGYsIGluZGVudD0yLCBlbnN1cmVfYXNjaWk9RmFsc2Up' | base64 -d > /tmp/oc_fix_gateway_token.py && python3 /tmp/oc_fix_gateway_token.py ) 2>&1 || echo "[OpenClaw] gateway token 脚本失败（已跳过）" >&2 ; command -v npm >/dev/null 2>&1