/**
 * 板端 OpenClaw 安装：npm registry / Node 二进制镜像 / npm install 的 Bash 片段。
 * 供 OpenClawDeploymentManager 与 Agent `board_openclaw_install` 共用，避免分叉。
 *
 * 注意：npm 回退片段必须用单引号 JS 字符串定义，禁止用反引号模板——否则 `$NPM_FAST_REG` 可能被误当作 JS 插值，
 * 日志里会出现 `--registry=ST_REG` 等截断（与 `$NPM` 等解析混淆）。
 */

/**
 * 探测 npmmirror 是否可达，设置 NPM_FAST_REG / ALT_REG（优先国内源）。
 * 末尾不要带 `;`：在 OpenClawDeploymentManager 里与其它片段用 ` && ` 拼接，避免出现非法的 `; &&`（bash 会报 syntax error near `&&`）。
 */
export const OPENCLAW_FAST_REGISTRY_SNIPPET =
  'if curl -fsS --connect-timeout 2 --max-time 3 https://registry.npmmirror.com/-/ping >/dev/null 2>&1; then NPM_FAST_REG=https://registry.npmmirror.com; ALT_REG=https://registry.npmjs.org; else NPM_FAST_REG=https://registry.npmjs.org; ALT_REG=https://registry.npmmirror.com; fi';

/**
 * 让官方 install.sh 及其内部的 npm 优先走上面探测到的源（子进程继承）。不用引号包裹变量，避免嵌入 bash -lc 时转义复杂。
 */
export const OPENCLAW_EXPORT_NPM_REGISTRY = 'export NPM_CONFIG_REGISTRY=$NPM_FAST_REG';

/**
 * 若 npmmirror 的 Node 索引可访问，为 nvm/部分安装脚本设置国内 Node 二进制镜像，减轻 NodeSource 直连卡顿。
 */
export const OPENCLAW_NODE_MIRROR_EXPORT =
  'if curl -fsS --connect-timeout 2 --max-time 5 https://npmmirror.com/mirrors/node/releases/index.json >/dev/null 2>&1; then export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node; fi';

/**
 * 板端安装前环境：探测 registry + export NPM_CONFIG_REGISTRY + Node 镜像。
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
export const OPENCLAW_NPM_FAST_INSTALL_SNIPPET = [
  '(',
  'NPM_FAST_REG="${NPM_FAST_REG:-https://registry.npmjs.org}";',
  'ALT_REG="${ALT_REG:-https://registry.npmmirror.com}";',
  'for i in 1 2 3; do',
  // 勿用 --loglevel error：成功路径近乎静默，前端只能看到 Studio 心跳误以为无日志。info 会输出解析/下载/解压等进度（体积仍可控）。
  // CI= 清空 CI：避免 npm 在 CI=1 时关闭 progress 且进一步减少输出。
  'if CI= npm install -g openclaw@latest --no-audit --no-fund --loglevel info --registry="${NPM_FAST_REG}" --prefer-offline=false --fetch-timeout=300000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi;',
  'if CI= npm install -g openclaw@latest --no-audit --no-fund --loglevel info --registry="${ALT_REG}" --prefer-offline=false --fetch-timeout=300000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi;',
  '[ "${i}" = 3 ] && exit 1;',
  'sleep 3;',
  'done',
  ')',
].join(' ');

/**
 * 环境准备阶段：在已有 npm 时写入 registry / 并发。
 * 注意：不能用「then ; if」拼接——bash 在 then 后不能紧跟单独的 `;`，会报 syntax error near `;`。
 */
export const OPENCLAW_PREPARE_NPM_SPEED =
  'if command -v npm >/dev/null 2>&1; then ' +
  OPENCLAW_FAST_REGISTRY_SNIPPET +
  '; npm config set registry "$NPM_FAST_REG" 2>/dev/null; npm config set maxsockets 20 2>/dev/null; npm config set fetch-retries 5 2>/dev/null; else true; fi';

/**
 * openclaw CLI 使用现代 JS（可选链 ?. 等），过旧 Node 会在启动时报 SyntaxError。
 * 板端常见「apt 自带老 node」会跳过官方 install.sh 直接 npm -g，装完即崩；此处统一要求主版本 ≥ 24（Node 24 LTS，可环境变量覆盖）。
 * 环境变量：
 * - OPENCLAW_MIN_NODE_MAJOR（默认与 OPENCLAW_BOARD_NODE_MIN_MAJOR 一致）
 * - OPENCLAW_SKIP_NODE_UPGRADE=1 时：版本不足则直接失败并提示手动升级，不跑 NodeSource apt
 * 自动升级仅在有 apt-get + curl 且具备 root/sudo 时走 NodeSource（见 OPENCLAW_NODESOURCE_SETUP）。
 * 板端可设 OPENCLAW_NODESOURCE_BASE（默认 https://deb.nodesource.com）以防需镜像；下载脚本失败会中止，避免误装旧源里的 nodejs。
 */
export const OPENCLAW_BOARD_NODE_MIN_MAJOR = 24;

/** NodeSource 安装脚本路径段，须与主版本一致，例如 setup_24.x */
export const OPENCLAW_NODESOURCE_SETUP = `setup_${OPENCLAW_BOARD_NODE_MIN_MAJOR}.x`;

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

export const OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET = [
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
  'if command -v apt-get >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then',
  'if [ "$(id -u)" -eq 0 ]; then',
  'DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;',
  `echo "[OpenClaw] 升级 Node ${OPENCLAW_BOARD_NODE_MIN_MAJOR} LTS（预清理 apt 冲突包）" 1>&2;`,
  'DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev nodejs 2>&1 || true;',
  'DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1 || true;',
  'DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 || true;',
  'rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true;',
  `OC_NS_URL="\${OPENCLAW_NODESOURCE_BASE:-https://deb.nodesource.com}/${OPENCLAW_NODESOURCE_SETUP}";`,
  'OC_NS_SH="/tmp/oc_nodesource_setup.sh";',
  'if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 320 "$OC_NS_URL" -o "$OC_NS_SH"; then echo "[OpenClaw] 错误: NodeSource 脚本下载失败（常见: SSL_read reset/网络抖动）。可重试或 export OPENCLAW_NODESOURCE_BASE=镜像源" 1>&2; rm -f "$OC_NS_SH"; exit 1; fi;',
  'if ! bash "$OC_NS_SH"; then echo "[OpenClaw] 错误: NodeSource 脚本执行失败（见上方输出）" 1>&2; rm -f "$OC_NS_SH"; exit 1; fi;',
  'rm -f "$OC_NS_SH";',
  'DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;',
  'DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs;',
  'elif command -v sudo >/dev/null 2>&1; then',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;',
  `echo "[OpenClaw] 升级 Node ${OPENCLAW_BOARD_NODE_MIN_MAJOR} LTS（预清理 apt 冲突包）" 1>&2;`,
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get remove -y libnode-dev nodejs 2>&1 || true;',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y 2>&1 || true;',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get -f install -y 2>&1 || true;',
  'sudo rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true;',
  `OC_NS_URL="\${OPENCLAW_NODESOURCE_BASE:-https://deb.nodesource.com}/${OPENCLAW_NODESOURCE_SETUP}";`,
  'OC_NS_SH="/tmp/oc_nodesource_setup.sh";',
  'if ! curl -fsSL --retry 4 --retry-delay 4 --connect-timeout 25 --max-time 320 "$OC_NS_URL" -o "$OC_NS_SH"; then echo "[OpenClaw] 错误: NodeSource 脚本下载失败（常见: SSL_read reset/网络抖动）。可重试或 export OPENCLAW_NODESOURCE_BASE=镜像源" 1>&2; rm -f "$OC_NS_SH"; exit 1; fi;',
  'if ! sudo -E bash "$OC_NS_SH"; then echo "[OpenClaw] 错误: NodeSource 脚本执行失败（见上方输出）" 1>&2; sudo rm -f "$OC_NS_SH"; exit 1; fi;',
  'sudo rm -f "$OC_NS_SH";',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true;',
  'sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs;',
  'else',
  `echo "[OpenClaw] 错误: 升级 Node 需要 root 或 sudo。请手动执行: curl -fsSL https://deb.nodesource.com/${OPENCLAW_NODESOURCE_SETUP} -o /tmp/ns.sh && sudo bash /tmp/ns.sh && sudo apt-get install -y nodejs" 1>&2;`,
  'exit 1;',
  'fi;',
  'else',
  'echo "[OpenClaw] 错误: 当前环境无法自动升级 Node（需要 apt-get + curl）。请手动安装 Node.js ${OPENCLAW_MIN_NODE_MAJOR}+（推荐 nvm/fnm 或官方便携包）后重试安装。" 1>&2;',
  'exit 1;',
  'fi;',
  'hash -r 2>/dev/null || true;',
  '_NODE_V="$(node -v 2>/dev/null || echo v0)";',
  '_NODE_MAJ="${_NODE_V#v}";',
  '_NODE_MAJ="${_NODE_MAJ%%.*}";',
  ': "${_NODE_MAJ:=0}";',
  'if ! [ "${_NODE_MAJ:-0}" -ge "$OPENCLAW_MIN_NODE_MAJOR" ]; then echo "[OpenClaw] 错误: 升级后 Node 仍为 ${_NODE_V}（需要 >= ${OPENCLAW_MIN_NODE_MAJOR}）。若刚装上的仍是 18，多为 NodeSource 脚本未成功或 apt 源仍为旧 nodesource；已删除旧 list 并重试下载脚本。可本机执行: apt-cache policy nodejs" 1>&2; exit 1; fi;',
  'echo "[OpenClaw] Node $(node -v) / npm $(npm --version 2>/dev/null || echo "?")";',
  ')',
].join(' ');

/**
 * 若 PATH 上已有 npm 则跳过；否则依次尝试 corepack、apt/opkg/apk/dnf/yum。
 * **Debian/Ubuntu 上 apt install npm 仅在已存在 `node` 时尝试**（无 node 时应先走 NodeSource，`npm` 元包依赖链易 broken）。
 */
export const OPENCLAW_ENSURE_NPM_SNIPPET = [
  '(',
  'if command -v npm >/dev/null 2>&1; then true;',
  'else',
  'echo "[OpenClaw] 正在安装 npm..." 1>&2;',
  'if command -v corepack >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then (corepack enable 2>/dev/null || true) && CI=1 corepack prepare npm@latest --activate 2>&1 || true;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then ',
  'if [ "$(id -u)" -eq 0 ]; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y npm;',
  'elif command -v sudo >/dev/null 2>&1; then sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y npm;',
  'else true; fi;',
  'fi;',
  'if ! command -v npm >/dev/null 2>&1 && command -v opkg >/dev/null 2>&1; then opkg update && (opkg install npm || opkg install nodejs-npm || true); fi;',
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
].join(' ');

/** 官方 install.sh 管道 + npm 回退（与历史行为一致）。 */
export const OPENCLAW_OFFICIAL_INSTALL_FALLBACK =
  '(curl -fsSL --connect-timeout 8 --max-time 45 --retry 2 --retry-delay 2 https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1 || ' +
  '(echo "[OpenClaw] install.sh 失败，改 npm 安装" 1>&2 && ' +
  OPENCLAW_NPM_FAST_INSTALL_SNIPPET +
  '))';

/**
 * 安装 OpenClaw 本体：默认若板端已有 node+npm 则跳过官方 install.sh，直接 npm -g（与脚本内 [2/3] 实质相同，但省去脚本前置步骤，通常更快）。
 * 设置环境变量 OPENCLAW_FORCE_OFFICIAL_INSTALL_SH=1 可强制始终走官方 install.sh。
 */
export const OPENCLAW_INSTALL_OPENCLAW_STEP =
  process.env.OPENCLAW_FORCE_OFFICIAL_INSTALL_SH === '1'
    ? OPENCLAW_OFFICIAL_INSTALL_FALLBACK
    : '(if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then ' +
      OPENCLAW_NPM_FAST_INSTALL_SNIPPET +
      '; else ' +
      OPENCLAW_OFFICIAL_INSTALL_FALLBACK +
      '; fi)';
