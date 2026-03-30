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
  'if curl -fsS --connect-timeout 2 --max-time 3 https://registry.npmmirror.com/-/ping >/dev/null 2>&1; then NPM_FAST_REG=https://registry.npmmirror.com; ALT_REG=https://registry.npmjs.org; else NPM_FAST_REG=https://registry.npmjs.org; ALT_REG=https://registry.npmmirror.com; fi; echo [OpenClaw] npm registry: $NPM_FAST_REG';

/**
 * 让官方 install.sh 及其内部的 npm 优先走上面探测到的源（子进程继承）。不用引号包裹变量，避免嵌入 bash -lc 时转义复杂。
 */
export const OPENCLAW_EXPORT_NPM_REGISTRY = 'export NPM_CONFIG_REGISTRY=$NPM_FAST_REG';

/**
 * 若 npmmirror 的 Node 索引可访问，为 nvm/部分安装脚本设置国内 Node 二进制镜像，减轻 NodeSource 直连卡顿。
 */
export const OPENCLAW_NODE_MIRROR_EXPORT =
  'if curl -fsS --connect-timeout 2 --max-time 5 https://npmmirror.com/mirrors/node/releases/index.json >/dev/null 2>&1; then export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node; echo [OpenClaw] Node mirror: npmmirror; fi';

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
  'if CI=1 npm install -g openclaw@latest --loglevel info --registry="${NPM_FAST_REG}" --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi;',
  'echo [OpenClaw] fallback registry: "${ALT_REG}";',
  'if CI=1 npm install -g openclaw@latest --loglevel info --registry="${ALT_REG}" --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi;',
  '[ "${i}" = 3 ] && exit 1;',
  'echo [OpenClaw] retry "${i}"/3...;',
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
  '; npm config set registry "$NPM_FAST_REG" 2>/dev/null; npm config set maxsockets 20 2>/dev/null; npm config set fetch-retries 5 2>/dev/null; echo [OpenClaw] npm registry applied; else echo [OpenClaw] npm skip registry hint; fi';
