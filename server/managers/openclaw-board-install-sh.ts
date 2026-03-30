/**
 * 板端 OpenClaw 安装：npm registry / Node 二进制镜像 / npm install 的 Bash 片段。
 * 供 OpenClawDeploymentManager 与 Agent `board_openclaw_install` 共用，避免分叉。
 */

/** 探测 npmmirror 是否可达，设置 NPM_FAST_REG / ALT_REG（优先国内源）。echo 避免双引号，便于嵌入 bash -lc */
export const OPENCLAW_FAST_REGISTRY_SNIPPET =
  'if curl -fsS --connect-timeout 2 --max-time 3 https://registry.npmmirror.com/-/ping >/dev/null 2>&1; then NPM_FAST_REG=https://registry.npmmirror.com; ALT_REG=https://registry.npmjs.org; else NPM_FAST_REG=https://registry.npmjs.org; ALT_REG=https://registry.npmmirror.com; fi; echo [OpenClaw] npm registry: $NPM_FAST_REG;';

/**
 * 让官方 install.sh 及其内部的 npm 优先走上面探测到的源（子进程继承）。不用引号包裹变量，避免嵌入 bash -lc 时转义复杂。
 */
export const OPENCLAW_EXPORT_NPM_REGISTRY = 'export NPM_CONFIG_REGISTRY=$NPM_FAST_REG;';

/**
 * 若 npmmirror 的 Node 索引可访问，为 nvm/部分安装脚本设置国内 Node 二进制镜像，减轻 NodeSource 直连卡顿。
 */
export const OPENCLAW_NODE_MIRROR_EXPORT =
  'if curl -fsS --connect-timeout 2 --max-time 5 https://npmmirror.com/mirrors/node/releases/index.json >/dev/null 2>&1; then export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node; echo [OpenClaw] Node mirror: npmmirror; fi;';

/**
 * npm install -g openclaw@latest：双 registry 轮换 + 并发与超时（需已设置 NPM_FAST_REG / ALT_REG）。
 */
export const OPENCLAW_NPM_FAST_INSTALL_SNIPPET =
  '(for i in 1 2 3; do if CI=1 npm install -g openclaw@latest --loglevel info --registry=$NPM_FAST_REG --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi; echo [OpenClaw] fallback registry: $ALT_REG; if CI=1 npm install -g openclaw@latest --loglevel info --registry=$ALT_REG --prefer-offline=false --fetch-timeout=120000 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 --maxsockets=20 2>&1; then break; fi; [ "$i" = 3 ] && exit 1; echo [OpenClaw] retry $i/3...; sleep 3; done)';

/** 环境准备阶段：在已有 npm 时写入 registry / 并发，与安装阶段一致 */
export const OPENCLAW_PREPARE_NPM_SPEED = [
  'if command -v npm >/dev/null 2>&1; then',
  OPENCLAW_FAST_REGISTRY_SNIPPET,
  'npm config set registry "$NPM_FAST_REG" 2>/dev/null',
  'npm config set maxsockets 20 2>/dev/null',
  'npm config set fetch-retries 5 2>/dev/null',
  'echo [OpenClaw] npm registry applied',
  'else echo [OpenClaw] npm skip registry hint',
  'fi',
].join(' ; ');
