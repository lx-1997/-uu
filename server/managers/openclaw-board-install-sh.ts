/**
 * 套件端 `npm install -g openclaw@...` 的版本。
 * 默认固定为 `2026.3.28`（降低 upstream 最新版波动对安装稳定性的影响）；
 * 需要临时切换版本做验收或回滚时设环境变量 `OPENCLAW_NPM_VERSION`（如 `2026.4.1`）。
 * 注意：npm 包使用日历版本（2026.x.y），勿误用旧约定如 `3.24`（registry 上不存在）。
 * 套件端安装即标准：`CI= npm install -g openclaw@<本常量> ...`（无额外魔法）。
 */
export const OPENCLAW_BOARD_NPM_SPEC =
  process.env.OPENCLAW_NPM_VERSION?.trim() || '2026.3.28';

function joinShellLines(lines: string[]): string {
  return lines.join('\n');
}

/**
 * npm 并发连接（默认 32，大依赖树时更易吃满带宽）。
 * 环境变量（均在 **Studio 服务端进程** 上设置，下发到套件端脚本前已展开）：
 * - `OPENCLAW_NPM_SKIP_UNSAFE_PERM=1`：不在 `npm install -g openclaw` 上加 `--unsafe-perm`（默认会加，避免 root 全局装时 lifecycle 权限问题）。
 * - `OPENCLAW_NPM_MAXSOCKETS`：覆盖默认 maxsockets。
 * - **默认**：`registry.npmmirror.com` 为主、`registry.npmjs.org` 为备（国内网络优先，避免先连国外再 ECONNRESET）。
 * - `OPENCLAW_REGISTRY_PRIORITY=china` | `npmmirror`：与默认相同（显式声明）。
 * - `OPENCLAW_REGISTRY_PRIORITY=global` | `npmjs` | `official`：官方源优先，国内镜像备用（海外/部分 CI）。
 */
const OPENCLAW_NPM_MAXSOCKETS = process.env.OPENCLAW_NPM_MAXSOCKETS?.trim() || '32';
/** 单次 npm -g openclaw 尝试的超时时间（秒），超时后会自动切到备用源继续。 */
const OPENCLAW_NPM_ATTEMPT_TIMEOUT_SEC = process.env.OPENCLAW_NPM_ATTEMPT_TIMEOUT_SEC?.trim() || '900';
/**
 * 追加到 `npm install -g openclaw@...` 的尾部参数（无前导空格）。
 * 默认含 `--unsafe-perm`：root 全局安装时减少 lifecycle 脚本权限问题；套件端 ENOENT/不完整树时与手工修复一致。
 * 设 `OPENCLAW_NPM_SKIP_UNSAFE_PERM=1` 可关闭。
 */
const OPENCLAW_NPM_INSTALL_TAIL =
  process.env.OPENCLAW_NPM_SKIP_UNSAFE_PERM === '1' || process.env.OPENCLAW_NPM_SKIP_UNSAFE_PERM === 'true'
    ? ''
    : ' --unsafe-perm';

/**
 * 套件端 OpenClaw 安装：npm registry / Node 二进制镜像 / npm install 的 Bash 片段。
 * 供 OpenClawDeploymentManager 与 Agent `board_openclaw_install` 共用，避免分叉。
 *
 * 注意：npm 回退片段必须用单引号 JS 字符串定义，禁止用反引号模板——否则 `$NPM_FAST_REG` 可能被误当作 JS 插值，
 * 日志里会出现 `--registry=ST_REG` 等截断（与 `$NPM` 等解析混淆）。
 */

/**
 * 设置 NPM_FAST_REG（主）/ ALT_REG（备）。末尾不要带多余 `;`：与其它片段用 ` && ` 拼接时避免出现 `; &&`。
 *
 * 旧版曾用 curl 探测 npmmirror，**失败则改为先国外后国内**，在国内网络下会放大 ECONNRESET；现改为默认始终国内优先，
 * 仅当 `OPENCLAW_REGISTRY_PRIORITY=global|npmjs|official` 时交换顺序。
 */
const OPENCLAW_FAST_REGISTRY_SNIPPET_CN_FIRST =
  'NPM_FAST_REG=https://registry.npmmirror.com; ALT_REG=https://registry.npmjs.org';

const OPENCLAW_FAST_REGISTRY_SNIPPET_GLOBAL_FIRST =
  'NPM_FAST_REG=https://registry.npmjs.org; ALT_REG=https://registry.npmmirror.com';

export const OPENCLAW_FAST_REGISTRY_SNIPPET =
  process.env.OPENCLAW_REGISTRY_PRIORITY === 'global' ||
  process.env.OPENCLAW_REGISTRY_PRIORITY === 'npmjs' ||
  process.env.OPENCLAW_REGISTRY_PRIORITY === 'official'
    ? OPENCLAW_FAST_REGISTRY_SNIPPET_GLOBAL_FIRST
    : OPENCLAW_FAST_REGISTRY_SNIPPET_CN_FIRST;

/**
 * 让官方 install.sh 及其内部的 npm 优先走上面探测到的源（子进程继承）。
 * 旧版 sharp 镜像 env 在 npm 11 下会报 unknown env config，且 sharp 0.34+ 已不依赖旧的 libvips 镜像变量，这里不再注入。
 */
export const OPENCLAW_EXPORT_NPM_REGISTRY = 'export NPM_CONFIG_REGISTRY=$NPM_FAST_REG';

/**
 * 若 npmmirror 的 Node 索引可访问，为 nvm/部分安装脚本设置国内 Node 二进制镜像，减轻 NodeSource 直连卡顿。
 */
export const OPENCLAW_NODE_MIRROR_EXPORT =
  'if curl -fsS --connect-timeout 2 --max-time 5 https://npmmirror.com/mirrors/node/releases/index.json >/dev/null 2>&1; then export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node; fi';

/**
 * 套件端安装前环境：探测 registry + export NPM_CONFIG_REGISTRY + Node 镜像。
 * 用分号串联（末尾无分号），可与 `BOARD_ENV_EXPORT && prelude && curl...` 安全拼接，避免出现 `; &&`。
 */
export const OPENCLAW_BOARD_INSTALL_ENV_PRELUDE =
  OPENCLAW_FAST_REGISTRY_SNIPPET +
  '; ' +
  OPENCLAW_EXPORT_NPM_REGISTRY +
  '; ' +
  OPENCLAW_NODE_MIRROR_EXPORT;

/**
 * 官方 install.sh 失败后的 npm 回退：子 shell 内先补默认 registry，再用 "${NPM_FAST_REG}" 避免 $NPM 等前缀被误拆。
 * 整段为单条 bash 子 shell `( ... )`，供外层 `( echo ... && ... )` 拼接。
 */
export const OPENCLAW_NPM_FAST_INSTALL_SNIPPET = joinShellLines([
  '(',
  'NPM_FAST_REG="${NPM_FAST_REG:-https://registry.npmmirror.com}";',
  'ALT_REG="${ALT_REG:-https://registry.npmjs.org}";',
  'oc_npm_repair_after_fail(){',
  'echo "[OpenClaw] 安装失败：清理 npm 缓存并移除可能损坏的全局 openclaw（ENOENT/解压不完整时常见）..." 1>&2;',
  'npm uninstall -g openclaw 2>/dev/null || true;',
  '_gp="$(npm prefix -g 2>/dev/null || true)";',
  'if [ -n "$_gp" ]; then rm -rf "$_gp/lib/node_modules/openclaw" 2>/dev/null || true; fi;',
  'rm -rf "${HOME}/.npm-global/lib/node_modules/openclaw" 2>/dev/null || true;',
  'npm cache clean --force 2>&1 || true;',
  '};',
  'echo "[OpenClaw] 预清理可能残留的 openclaw 全局包..." 1>&2;',
  'npm uninstall -g openclaw 2>/dev/null || true;',
  'oc_npm_install_once(){',
  'oc_reg="$1"; oc_try="$2"; oc_lane="$3";',
  'echo "[OpenClaw] npm 安装尝试 ${oc_try}/3 (${oc_lane}) registry=${oc_reg}" 1>&2;',
  'oc_hb_file="$(mktemp /tmp/oc-npm-heartbeat-XXXXXX 2>/dev/null || echo /tmp/oc-npm-heartbeat.$$)";',
  ': > "$oc_hb_file" 2>/dev/null || true;',
  '( while [ -f "$oc_hb_file" ]; do sleep 25; [ -f "$oc_hb_file" ] && echo "[OpenClaw] 仍在安装依赖（${oc_lane}），中国网络下首次安装可能需要 5-20 分钟；若当前源持续很慢，将自动切换备用源。" 1>&2; done ) &',
  'oc_hb_pid=$!;',
  'if command -v timeout >/dev/null 2>&1; then',
  'CI= timeout --signal=TERM --kill-after=20s ' + OPENCLAW_NPM_ATTEMPT_TIMEOUT_SEC + 's npm install -g openclaw@' +
    OPENCLAW_BOARD_NPM_SPEC +
    ' --no-audit --no-fund --loglevel notice --progress=false --registry="${oc_reg}" --prefer-offline=true --fetch-timeout=600000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=20000 --maxsockets=' +
    OPENCLAW_NPM_MAXSOCKETS +
    OPENCLAW_NPM_INSTALL_TAIL +
    ' 2>&1; oc_rc=$?; rm -f "$oc_hb_file" 2>/dev/null || true; kill "$oc_hb_pid" 2>/dev/null || true; wait "$oc_hb_pid" 2>/dev/null || true; [ "$oc_rc" -eq 124 ] && echo "[OpenClaw] 当前源安装超时，准备切换下一路镜像重试..." 1>&2; return "$oc_rc";',
  'fi;',
  'CI= npm install -g openclaw@' +
    OPENCLAW_BOARD_NPM_SPEC +
    ' --no-audit --no-fund --loglevel notice --progress=false --registry="${oc_reg}" --prefer-offline=true --fetch-timeout=600000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=20000 --maxsockets=' +
    OPENCLAW_NPM_MAXSOCKETS +
    OPENCLAW_NPM_INSTALL_TAIL +
    ' 2>&1; oc_rc=$?; rm -f "$oc_hb_file" 2>/dev/null || true; kill "$oc_hb_pid" 2>/dev/null || true; wait "$oc_hb_pid" 2>/dev/null || true; return "$oc_rc";',
  '};',
  'for i in 1 2 3; do',
  // 勿用 --loglevel error：成功路径近乎静默，前端只能看到 Studio 心跳误以为无日志。
  // notice + progress=false：保留关键输出、去掉超长旋转动画与海量 fetch 明细，降低日志压力。
  // CI= 清空 CI：避免 npm 在 CI=1 时关闭 progress 且进一步减少输出。
  // prefer-offline=true：本地已有缓存时优先用缓存，重试/升级场景明显提速；无缓存时仍会走网络。
  // 版本与 OPENCLAW_BOARD_NPM_SPEC 一致（默认 latest；可 OPENCLAW_NPM_VERSION 钉版本）。
  'if oc_npm_install_once "${NPM_FAST_REG}" "$i" "primary"; then break; fi;',
  'if oc_npm_install_once "${ALT_REG}" "$i" "fallback"; then break; fi;',
  'if [ "${i}" -lt 3 ]; then oc_npm_repair_after_fail; fi;',
  '[ "${i}" = 3 ] && exit 1;',
  'sleep 2;',
  'done',
  ')',
]);

/**
 * 环境准备阶段：在已有 npm 时写入 registry / 并发。
 * 注意：不能用「then ; if」拼接——bash 在 then 后不能紧跟单独的 `;`，会报 syntax error near `;`。
 */
export const OPENCLAW_PREPARE_NPM_SPEED =
  'if command -v npm >/dev/null 2>&1; then ' +
  OPENCLAW_FAST_REGISTRY_SNIPPET +
  '; npm config set registry "$NPM_FAST_REG" 2>/dev/null; npm config set maxsockets ' +
  OPENCLAW_NPM_MAXSOCKETS +
  ' 2>/dev/null; npm config set fetch-retries 5 2>/dev/null; else true; fi';

/**
 * openclaw CLI 使用现代 JS（可选链 ?. 等），过旧 Node 会在启动时报 SyntaxError。
 * 套件端常见「apt 自带老 node」会跳过官方 install.sh 直接 npm -g，装完即崩；此处统一要求主版本 ≥ 24（Node 24 LTS，可环境变量覆盖）。
 * 环境变量：
 * - OPENCLAW_MIN_NODE_MAJOR（默认与 OPENCLAW_BOARD_NODE_MIN_MAJOR 一致）
 * - OPENCLAW_SKIP_NODE_UPGRADE=1 时：版本不足则直接失败并提示手动升级，不跑 NodeSource apt
 * 自动升级仅在有 apt-get + curl 且具备 root/sudo 时走 NodeSource（见 OPENCLAW_NODESOURCE_SETUP）。
 * 套件端可设 OPENCLAW_NODESOURCE_BASE（默认 https://deb.nodesource.com）以防需镜像；下载脚本失败会中止，避免误装旧源里的 nodejs。
 */
export const OPENCLAW_BOARD_NODE_MIN_MAJOR = 24;

/** NodeSource 安装脚本路径段，须与主版本一致，例如 setup_24.x */
export const OPENCLAW_NODESOURCE_SETUP = `setup_${OPENCLAW_BOARD_NODE_MIN_MAJOR}.x`;

/**
 * 在 apt-get / NodeSource 脚本前执行：等待 `/var/lib/apt/lists/lock` 与 dpkg 锁释放。
 * 常见场景：unattended-upgrades、另一路 apt、用户手动 apt 与 Studio 安装并发 → 无此等待则 apt update/install 全失败。
 * 120s 仍未释放时，不直接中止整个安装链，而是设置 `_oc_lock_wait_ok=0`，让后续走非 apt 兜底。
 */
export const OPENCLAW_WAIT_APT_LOCK_SNIPPET = joinShellLines([
  '_oc_ai=0',
  '_oc_lock_wait_ok=1',
  'while [ "$_oc_ai" -lt 120 ]; do',
  '_oc_ab=0',
  'if command -v fuser >/dev/null 2>&1; then fuser /var/lib/apt/lists/lock >/dev/null 2>&1 && _oc_ab=1; fuser /var/lib/dpkg/lock >/dev/null 2>&1 && _oc_ab=1; fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && _oc_ab=1; else pgrep -x apt-get >/dev/null 2>&1 && _oc_ab=1; pgrep -x apt >/dev/null 2>&1 && _oc_ab=1; pgrep -x dpkg >/dev/null 2>&1 && _oc_ab=1; fi',
  'if [ "$_oc_ab" = 0 ]; then break; fi',
  '_oc_ai=$((_oc_ai+1))',
  'echo "[OpenClaw] 等待 apt/dpkg 锁释放（其他 apt 可能正在运行）... ($_oc_ai/120)" 1>&2',
  'sleep 1',
  'done',
  'if [ "$_oc_ai" -ge 120 ]; then echo "[OpenClaw] 警告: apt 锁 120s 内未释放，跳过 apt 路径并尝试非 apt 兜底。可稍后重试，或先: sudo fuser -v /var/lib/apt/lists/lock /var/lib/dpkg/lock" 1>&2; _oc_lock_wait_ok=0; fi',
]);

export const OPENCLAW_NODE_DIST_FALLBACK_SNIPPET = joinShellLines([
  'echo "[OpenClaw] 尝试 Node 二进制包兜底安装..." 1>&2',
  'OC_NODE_ARCH_RAW="$(uname -m 2>/dev/null || echo unknown)"',
  'case "$OC_NODE_ARCH_RAW" in',
  '  x86_64|amd64) OC_NODE_ARCH="linux-x64" ;;',
  '  aarch64|arm64) OC_NODE_ARCH="linux-arm64" ;;',
  '  armv7l|armv7*) OC_NODE_ARCH="linux-armv7l" ;;',
  '  *) echo "[OpenClaw] Node 二进制兜底跳过：不支持架构 $OC_NODE_ARCH_RAW" 1>&2; exit 11 ;;',
  'esac',
  'if ! command -v curl >/dev/null 2>&1; then echo "[OpenClaw] Node 二进制兜底跳过：缺少 curl" 1>&2; exit 12; fi',
  'if ! command -v tar >/dev/null 2>&1; then echo "[OpenClaw] Node 二进制兜底跳过：缺少 tar" 1>&2; exit 13; fi',
  'OC_NODE_TMP="$(mktemp -d /tmp/oc-node-dist-XXXXXX)"',
  'OC_NODE_DONE=0',
  'for OC_NODE_BASE in ${OPENCLAW_NODE_DIST_BASES:-${NODEJS_ORG_MIRROR:-https://nodejs.org/dist} https://npmmirror.com/mirrors/node}; do',
  '  OC_NODE_SUMS="$OC_NODE_TMP/SHASUMS256.txt"',
  '  OC_NODE_RELEASE_URL="${OC_NODE_BASE%/}/latest-v${OPENCLAW_MIN_NODE_MAJOR}.x/SHASUMS256.txt"',
  '  if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 20 --max-time 180 "$OC_NODE_RELEASE_URL" -o "$OC_NODE_SUMS"; then echo "[OpenClaw] Node 二进制兜底：获取索引失败 $OC_NODE_RELEASE_URL" 1>&2; continue; fi',
  '  OC_NODE_FILE="$(grep -E " node-v[0-9.]+-${OC_NODE_ARCH}\\.tar\\.xz$" "$OC_NODE_SUMS" | head -n1 | tr -s " " | cut -d" " -f2)"',
  '  if [ -z "$OC_NODE_FILE" ]; then echo "[OpenClaw] Node 二进制兜底：索引中无 ${OC_NODE_ARCH} 包" 1>&2; continue; fi',
  '  OC_NODE_URL="${OC_NODE_BASE%/}/latest-v${OPENCLAW_MIN_NODE_MAJOR}.x/$OC_NODE_FILE"',
  '  if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 480 "$OC_NODE_URL" -o "$OC_NODE_TMP/$OC_NODE_FILE"; then echo "[OpenClaw] Node 二进制兜底：下载失败 $OC_NODE_URL" 1>&2; continue; fi',
  '  mkdir -p "$HOME/.local/lib" "$HOME/.npm-global/bin"',
  '  OC_NODE_DIR="${OC_NODE_FILE%.tar.xz}"',
  '  rm -rf "$HOME/.local/lib/$OC_NODE_DIR" 2>/dev/null || true',
  '  if ! tar -xf "$OC_NODE_TMP/$OC_NODE_FILE" -C "$HOME/.local/lib" 2>/dev/null && ! tar -xJf "$OC_NODE_TMP/$OC_NODE_FILE" -C "$HOME/.local/lib" 2>/dev/null; then echo "[OpenClaw] Node 二进制兜底：解压失败 $OC_NODE_FILE" 1>&2; continue; fi',
  '  if [ ! -x "$HOME/.local/lib/$OC_NODE_DIR/bin/node" ]; then echo "[OpenClaw] Node 二进制兜底：未找到 node 可执行文件" 1>&2; continue; fi',
  '  ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/node" "$HOME/.npm-global/bin/node"',
  '  [ -x "$HOME/.local/lib/$OC_NODE_DIR/bin/npm" ] && ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/npm" "$HOME/.npm-global/bin/npm" || true',
  '  [ -x "$HOME/.local/lib/$OC_NODE_DIR/bin/npx" ] && ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/npx" "$HOME/.npm-global/bin/npx" || true',
  '  [ -x "$HOME/.local/lib/$OC_NODE_DIR/bin/corepack" ] && ln -sf "$HOME/.local/lib/$OC_NODE_DIR/bin/corepack" "$HOME/.npm-global/bin/corepack" || true',
  '  export PATH="$HOME/.npm-global/bin:$HOME/.local/lib/$OC_NODE_DIR/bin:$PATH"',
  '  hash -r 2>/dev/null || true',
  '  if command -v node >/dev/null 2>&1; then OC_NODE_DONE=1; echo "[OpenClaw] Node 二进制兜底成功: $(node -v 2>/dev/null || echo unknown)" 1>&2; break; fi',
  'done',
  'rm -rf "$OC_NODE_TMP" 2>/dev/null || true',
  'if [ "$OC_NODE_DONE" != "1" ]; then echo "[OpenClaw] Node 二进制兜底失败" 1>&2; exit 14; fi',
]);

/**
 * 解析 openclaw 可执行路径。避免 npm prefix -g 为空时拼成 /bin/openclaw；command -v 若指向不可执行文件则清空。
 */
export const OPENCLAW_RESOLVE_CLI_SNIPPET = [
  'OPENCLAW_CMD="$(command -v openclaw 2>/dev/null || true)"',
  'if [ -n "$OPENCLAW_CMD" ] && [ ! -x "$OPENCLAW_CMD" ]; then OPENCLAW_CMD=""; fi',
  'if [ -z "$OPENCLAW_CMD" ] && [ -x "$HOME/.npm-global/bin/openclaw" ]; then OPENCLAW_CMD="$HOME/.npm-global/bin/openclaw"; fi',
  'if [ -z "$OPENCLAW_CMD" ] && [ -x "$HOME/.local/bin/openclaw" ]; then OPENCLAW_CMD="$HOME/.local/bin/openclaw"; fi',
  'if [ -z "$OPENCLAW_CMD" ] && command -v npm >/dev/null 2>&1; then _OC_NPM_PF="$(npm prefix -g 2>/dev/null)"; if [ -n "$_OC_NPM_PF" ] && [ -x "$_OC_NPM_PF/bin/openclaw" ]; then OPENCLAW_CMD="$_OC_NPM_PF/bin/openclaw"; fi; fi',
  'if [ -n "$OPENCLAW_CMD" ] && [ ! -x "$OPENCLAW_CMD" ]; then OPENCLAW_CMD=""; fi',
].join(' && ');

/**
 * npm 装包成功后强制验收：`command -v` 能找到文件不等于 Node 能执行 CLI（旧 Node 会先过 ensure 再因竞态/多版本失效）。
 * 失败则 exit 1，避免日志出现「安装完成」但健康检查报未安装。
 */
export const OPENCLAW_VERIFY_CLI_RUNS_SNIPPET = [
  'if [ -z "$OPENCLAW_CMD" ]; then echo "[OpenClaw] 错误: 未找到 openclaw 可执行文件（请检查 npm prefix -g 与 PATH）" >&2; exit 1; fi;',
  // 末行禁止 `fi;`：NPM_INSTALL_CMD 用 ` && ` 衔接下一段时会出现 `fi; &&` → bash syntax error near `&&`
  `if ! "$OPENCLAW_CMD" --version 2>&1; then echo "[OpenClaw] 错误: openclaw --version 失败（常见: Node 需 ${OPENCLAW_BOARD_NODE_MIN_MAJOR}+，或全局包损坏）" >&2; exit 1; fi`,
].join(' ');

/**
 * 安装/升级后写入 ~/.bashrc：把 npm 全局 bin、~/.npm-global/bin、~/.local/bin prepend 到 PATH，
 * 避免交互式 SSH 里 `openclaw` / `clawctl` command not found（与 OPENCLAW_RESOLVE_CLI_SNIPPET 探测路径一致）。
 * 重复执行会先 sed 删除旧标记块再追加，避免重复堆积。
 */
// bash 不允许子 shell 以 `(;` 开头（会报 syntax error near `;`），故用 `( inner… )` 拼接。
const OPENCLAW_ENSURE_SHELL_PATH_INNER = [
  'echo "[OpenClaw] 更新 ~/.bashrc：登录后可执行 openclaw / clawctl（新开终端或 source ~/.bashrc）" 1>&2',
  '_OC_RC="${HOME}/.bashrc"',
  'touch "$_OC_RC"',
  'if command -v sed >/dev/null 2>&1; then sed -i "/# >>> rdk-studio-openclaw-path >>>/,/# <<< rdk-studio-openclaw-path <<</d" "$_OC_RC" 2>/dev/null || true; fi',
  'printf \'%s\\n\' \'\' >> "$_OC_RC"',
  'printf \'%s\\n\' \'# >>> rdk-studio-openclaw-path >>>\' >> "$_OC_RC"',
  'printf \'%s\\n\' \'export PATH="$(npm prefix -g 2>/dev/null)/bin:${HOME}/.npm-global/bin:${HOME}/.local/bin:${PATH}"\' >> "$_OC_RC"',
  'printf \'%s\\n\' \'# <<< rdk-studio-openclaw-path <<<\' >> "$_OC_RC"',
  'hash -r 2>/dev/null || true',
].join('; ');
export const OPENCLAW_ENSURE_SHELL_PATH_SNIPPET =
  '( ' + OPENCLAW_ENSURE_SHELL_PATH_INNER + ' )';

export const OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET = joinShellLines([
  '(',
  `OPENCLAW_MIN_NODE_MAJOR="\${OPENCLAW_MIN_NODE_MAJOR:-${OPENCLAW_BOARD_NODE_MIN_MAJOR}}";`,
  'if command -v node >/dev/null 2>&1; then',
  '_NODE_V="$(node -v 2>/dev/null || echo v0)";',
  '_NODE_MAJ="${_NODE_V#v}";',
  '_NODE_MAJ="${_NODE_MAJ%%.*}";',
  ': "${_NODE_MAJ:=0}";',
  'else',
  `echo "[OpenClaw] 未检测到 node，将安装 Node ${OPENCLAW_BOARD_NODE_MIN_MAJOR} LTS（NodeSource）" 1>&2;`,
  '_NODE_V="v0";',
  '_NODE_MAJ=0;',
  'fi;',
  'if [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then exit 0; fi;',
  'if [ "${_NODE_MAJ:-0}" -gt 0 ]; then echo "[OpenClaw] Node 已过时 ${_NODE_V}，需要 >= ${OPENCLAW_MIN_NODE_MAJOR}" 1>&2; fi;',
  'if [ "${OPENCLAW_SKIP_NODE_UPGRADE:-0}" = "1" ]; then echo "[OpenClaw] 错误: 已设置 OPENCLAW_SKIP_NODE_UPGRADE=1，跳过自动升级。请手动安装 Node.js ${OPENCLAW_MIN_NODE_MAJOR}+ 后重试。" 1>&2; exit 1; fi;',
  'OC_NODE_BOOTSTRAP_OK=0',
  'if command -v apt-get >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then',
  OPENCLAW_WAIT_APT_LOCK_SNIPPET,
  'if [ "${_oc_lock_wait_ok:-1}" = "1" ] && [ "$(id -u)" -eq 0 ]; then',
  'DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;',
  `echo "[OpenClaw] 升级 Node ${OPENCLAW_BOARD_NODE_MIN_MAJOR} LTS（预清理 apt 冲突包）" 1>&2;`,
  'DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev nodejs 2>&1 || true;',
  'DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1 || true;',
  'DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 || true;',
  'rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true;',
  `OC_NS_URL="\${OPENCLAW_NODESOURCE_BASE:-https://deb.nodesource.com}/${OPENCLAW_NODESOURCE_SETUP}";`,
  'OC_NS_SH="/tmp/oc_nodesource_setup.sh";',
  'if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 320 "$OC_NS_URL" -o "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本下载失败（常见: SSL_read reset/网络抖动），改用二进制兜底" 1>&2; rm -f "$OC_NS_SH"; else if ! bash "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本执行失败（见上方输出），改用二进制兜底" 1>&2; rm -f "$OC_NS_SH"; else rm -f "$OC_NS_SH"; DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && OC_NODE_BOOTSTRAP_OK=1 || true; fi; fi;',
  'elif [ "${_oc_lock_wait_ok:-1}" = "1" ] && command -v sudo >/dev/null 2>&1; then',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;',
  `echo "[OpenClaw] 升级 Node ${OPENCLAW_BOARD_NODE_MIN_MAJOR} LTS（预清理 apt 冲突包）" 1>&2;`,
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev nodejs 2>&1 || true;',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1 || true;',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 || true;',
  'sudo rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true;',
  `OC_NS_URL="\${OPENCLAW_NODESOURCE_BASE:-https://deb.nodesource.com}/${OPENCLAW_NODESOURCE_SETUP}";`,
  'OC_NS_SH="/tmp/oc_nodesource_setup.sh";',
  'if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 320 "$OC_NS_URL" -o "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本下载失败（常见: SSL_read reset/网络抖动），改用二进制兜底" 1>&2; rm -f "$OC_NS_SH"; else if ! sudo -E bash "$OC_NS_SH"; then echo "[OpenClaw] 警告: NodeSource 脚本执行失败（见上方输出），改用二进制兜底" 1>&2; sudo rm -f "$OC_NS_SH"; else sudo rm -f "$OC_NS_SH"; sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && OC_NODE_BOOTSTRAP_OK=1 || true; fi; fi;',
  'else',
  `echo "[OpenClaw] 提示: 无法走 NodeSource apt（缺少 root/sudo 或 apt 锁繁忙），改用二进制兜底。若要手动安装，可执行: curl -fsSL https://deb.nodesource.com/${OPENCLAW_NODESOURCE_SETUP} -o /tmp/ns.sh && sudo bash /tmp/ns.sh && sudo apt-get install -y nodejs" 1>&2;`,
  'fi;',
  'fi',
  'if ! command -v node >/dev/null 2>&1; then _NODE_V="v0"; _NODE_MAJ=0; fi',
  '_NODE_V="$(node -v 2>/dev/null || echo v0)";',
  '_NODE_MAJ="${_NODE_V#v}";',
  '_NODE_MAJ="${_NODE_MAJ%%.*}";',
  ': "${_NODE_MAJ:=0}";',
  'if ! [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then',
  OPENCLAW_NODE_DIST_FALLBACK_SNIPPET,
  'fi;',
  'hash -r 2>/dev/null || true;',
  '_NODE_V="$(node -v 2>/dev/null || echo v0)";',
  '_NODE_MAJ="${_NODE_V#v}";',
  '_NODE_MAJ="${_NODE_MAJ%%.*}";',
  ': "${_NODE_MAJ:=0}";',
  'if ! [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then echo "[OpenClaw] 错误: 升级后 Node 仍为 ${_NODE_V}（需要 >= ${OPENCLAW_MIN_NODE_MAJOR}）。已尝试 NodeSource 与二进制兜底；若日志曾有 Could not get lock / apt 锁，请先结束其他 apt 再重试。也可手动安装后重试。" 1>&2; exit 1; fi;',
  'echo "[OpenClaw] Node $(node -v) / npm $(npm --version 2>/dev/null || echo "?")";',
  ')',
]);

/**
 * 若 PATH 上已有 npm 则跳过；否则依次尝试 corepack、apt/opkg/apk/dnf/yum。
 * **Debian/Ubuntu 上 apt install npm 仅在已存在 `node` 时尝试**（无 node 时应先走 NodeSource，`npm` 元包依赖链易 broken）。
 */
export const OPENCLAW_ENSURE_NPM_SNIPPET = joinShellLines([
  '(',
  'if command -v npm >/dev/null 2>&1; then true;',
  'else',
  'echo "[OpenClaw] 正在安装 npm..." 1>&2;',
  'if command -v corepack >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then (corepack enable 2>/dev/null || true) && CI=1 corepack prepare npm@latest --activate 2>&1 || true;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then ',
  OPENCLAW_WAIT_APT_LOCK_SNIPPET,
  'if [ "${_oc_lock_wait_ok:-1}" = "1" ] && [ "$(id -u)" -eq 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; DEBIAN_FRONTEND=noninteractive apt-get install -y npm || true;',
  'elif [ "${_oc_lock_wait_ok:-1}" = "1" ] && command -v sudo >/dev/null 2>&1; then sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true; sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y npm || true;',
  'else true; fi;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v opkg >/dev/null 2>&1; then opkg update || true; (opkg install npm || opkg install nodejs-npm || true); fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v apk >/dev/null 2>&1; then ',
  'if [ "$(id -u)" -eq 0 ]; then apk add --no-cache npm;',
  'elif command -v sudo >/dev/null 2>&1; then sudo apk add --no-cache npm;',
  'else true; fi;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v dnf >/dev/null 2>&1; then ',
  'if [ "$(id -u)" -eq 0 ]; then dnf install -y npm;',
  'elif command -v sudo >/dev/null 2>&1; then sudo dnf install -y npm;',
  'else true; fi;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v yum >/dev/null 2>&1; then ',
  'if [ "$(id -u)" -eq 0 ]; then yum install -y npm;',
  'elif command -v sudo >/dev/null 2>&1; then sudo yum install -y npm;',
  'else true; fi;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1; then echo "[OpenClaw] 错误: 无法自动安装 npm，请手动安装后重试" 1>&2; exit 1; fi;',
  'fi',
  ')',
]);

/** 官方 install.sh 管道 + npm 回退（与历史行为一致）。 */
export const OPENCLAW_OFFICIAL_INSTALL_FALLBACK =
  '(curl -fsSL --connect-timeout 8 --max-time 45 --retry 2 --retry-delay 2 https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || ' +
  '(echo "[OpenClaw] install.sh 失败，改 npm 安装" 1>&2 && ' +
  OPENCLAW_NPM_FAST_INSTALL_SNIPPET +
  '))';

/**
 * 安装 OpenClaw 本体：默认仅 npm -g `openclaw@${OPENCLAW_BOARD_NPM_SPEC}`（与 OPENCLAW_NPM_FAST_INSTALL_SNIPPET 一致）。
 * OpenClawDeploymentManager / board_openclaw_install 在本段之前已跑 Node/npm ensure，不再默认走 install.sh（与 npm 路径统一为同一规格）。
 * 设置环境变量 OPENCLAW_FORCE_OFFICIAL_INSTALL_SH=1 可强制走官方 install.sh + npm 回退。
 */
export const OPENCLAW_INSTALL_OPENCLAW_STEP =
  process.env.OPENCLAW_FORCE_OFFICIAL_INSTALL_SH === '1'
    ? OPENCLAW_OFFICIAL_INSTALL_FALLBACK
    : OPENCLAW_NPM_FAST_INSTALL_SNIPPET;
