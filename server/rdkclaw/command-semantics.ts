/**
 * RDK 套件端命令语义化
 *
 * 借鉴 claude-code BashTool 的设计：不只是执行命令，还要理解命令的语义。
 * 对 RDK 套件端常用命令的退出码、输出模式进行映射，帮助 Agent 更准确地判断执行结果。
 *
 * 设计原则：
 * 1. 退出码 0 不一定成功（如 grep 无匹配返回 1 但不是错误）
 * 2. 某些命令的 stderr 输出不代表错误（如 apt 的进度信息）
 * 3. 特定输出模式可以提取结构化信息（如温度值、BPU 状态）
 */

export interface CommandSemantics {
  /** 命令模式（正则匹配） */
  pattern: RegExp;
  /** 退出码含义映射 */
  exitCodes?: Record<number, 'success' | 'expected' | 'error'>;
  /** stderr 中不算错误的模式 */
  stderrIgnorePatterns?: RegExp[];
  /** 从输出中提取结构化信息的函数 */
  extractInfo?: (stdout: string) => Record<string, unknown> | null;
  /** 超时建议（毫秒） */
  suggestedTimeoutMs?: number;
  /** 是否为只读命令（不修改系统状态） */
  readOnly?: boolean;
}

/**
 * RDK 套件端常用命令的语义映射表
 */
export const RDK_COMMAND_SEMANTICS: CommandSemantics[] = [
  // ── 系统信息类（只读） ──
  {
    pattern: /^cat\s+\/sys\/class\/thermal\/thermal_zone\d+\/temp/,
    readOnly: true,
    extractInfo: (stdout) => {
      const raw = parseInt(stdout.trim(), 10);
      if (isNaN(raw)) return null;
      return { temperatureCelsius: raw / 1000, raw };
    },
  },
  {
    pattern: /^(hrut_smi|bputop)\b/,
    readOnly: true,
    suggestedTimeoutMs: 5000,
    stderrIgnorePatterns: [/command not found/i],
    extractInfo: (stdout) => {
      // hrut_smi 输出 BPU ratio
      const ratioMatch = stdout.match(/ratio\s*[:=]\s*(\d+)/i);
      if (ratioMatch) return { bpuRatio: parseInt(ratioMatch[1], 10) };
      return null;
    },
  },
  {
    pattern: /^free\s/,
    readOnly: true,
    extractInfo: (stdout) => {
      const memLine = stdout.split('\n').find(l => /^Mem:/i.test(l));
      if (!memLine) return null;
      const parts = memLine.split(/\s+/);
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      if (isNaN(total) || isNaN(used) || total === 0) return null;
      return { memoryUsagePercent: Math.round((used / total) * 100), totalKB: total, usedKB: used };
    },
  },
  {
    pattern: /^df\s/,
    readOnly: true,
    extractInfo: (stdout) => {
      const rootLine = stdout.split('\n').find(l => /\s+\/\s*$/.test(l));
      if (!rootLine) return null;
      const parts = rootLine.split(/\s+/);
      const usePercent = parseInt(parts[4], 10);
      if (isNaN(usePercent)) return null;
      return { diskUsagePercent: usePercent };
    },
  },
  {
    pattern: /^(rdkos_info|cat\s+\/etc\/version)\b/,
    readOnly: true,
  },
  {
    pattern: /^(ip\s+(addr|link|route)|ifconfig|hostname)\b/,
    readOnly: true,
  },
  {
    pattern: /^(ps\s|top\s+-bn|uptime|uname|whoami|id|date|which|type|command\s+-v)/,
    readOnly: true,
  },

  // ── 搜索类（退出码 1 = 无匹配，不是错误） ──
  {
    pattern: /^(grep|egrep|fgrep)\s/,
    readOnly: true,
    exitCodes: { 0: 'success', 1: 'expected', 2: 'error' },
  },
  {
    pattern: /^find\s/,
    readOnly: true,
    suggestedTimeoutMs: 10000,
  },

  // ── 包管理类（stderr 有进度信息） ──
  {
    pattern: /^(apt|apt-get|dpkg)\s/,
    stderrIgnorePatterns: [
      /WARNING.*apt.*CLI/i,
      /debconf.*unable/i,
      /Setting up/i,
    ],
    suggestedTimeoutMs: 1_800_000,
  },
  {
    pattern: /^(pip|pip3)\s+install/,
    stderrIgnorePatterns: [
      /WARNING.*pip/i,
      /already satisfied/i,
    ],
    suggestedTimeoutMs: 1_800_000,
  },
  {
    pattern: /^npm\s+(install|i)\b/,
    stderrIgnorePatterns: [
      /npm warn/i,
      /deprecated/i,
    ],
    suggestedTimeoutMs: 1_800_000,
  },

  // ── ROS2 类 ──
  {
    pattern: /^ros2\s+(topic|node|service|param|action)\s+(list|info|echo)/,
    readOnly: true,
    suggestedTimeoutMs: 10000,
    stderrIgnorePatterns: [/waiting for/i],
  },

  // ── 网络类 ──
  {
    pattern: /^(ping|curl|wget)\s/,
    suggestedTimeoutMs: 15000,
  },
  {
    pattern: /^nmcli\s/,
    stderrIgnorePatterns: [/Warning.*nmcli/i],
  },
  {
    pattern: /^ss\s/,
    readOnly: true,
  },

  // ── 进程管理类 ──
  {
    pattern: /^(kill|pkill|killall)\s/,
    exitCodes: { 0: 'success', 1: 'expected' }, // 1 = 进程不存在
  },
  {
    pattern: /^systemctl\s+(status|is-active|is-enabled)/,
    readOnly: true,
    exitCodes: { 0: 'success', 3: 'expected', 4: 'expected' }, // 3=inactive, 4=not-found
  },

  // ── 编译/构建类 ──
  {
    pattern: /^(make|cmake|gcc|g\+\+|colcon\s+build)\b/,
    suggestedTimeoutMs: 300000,
    stderrIgnorePatterns: [/warning:/i],
  },
];

/**
 * 查找匹配的命令语义
 */
export function findCommandSemantics(command: string): CommandSemantics | null {
  const trimmed = command.trim();
  for (const sem of RDK_COMMAND_SEMANTICS) {
    if (sem.pattern.test(trimmed)) return sem;
  }
  return null;
}

/**
 * 判断命令执行结果是否为真正的错误
 */
export function isCommandError(
  command: string,
  exitCode: number,
  stderr: string,
): boolean {
  const sem = findCommandSemantics(command);

  // 有语义映射时使用映射
  if (sem?.exitCodes) {
    const meaning = sem.exitCodes[exitCode];
    if (meaning === 'success' || meaning === 'expected') return false;
    if (meaning === 'error') return true;
  }

  // 默认：退出码 0 = 成功
  if (exitCode === 0) return false;

  // 检查 stderr 是否应该被忽略
  if (sem?.stderrIgnorePatterns && stderr.trim()) {
    const significantStderr = sem.stderrIgnorePatterns.reduce(
      (s, p) => s.replace(p, ''),
      stderr,
    ).trim();
    if (!significantStderr) return false;
  }

  return true;
}

/**
 * 从命令输出中提取结构化信息
 */
export function extractCommandInfo(
  command: string,
  stdout: string,
): Record<string, unknown> | null {
  const sem = findCommandSemantics(command);
  if (!sem?.extractInfo) return null;
  try {
    return sem.extractInfo(stdout);
  } catch {
    return null;
  }
}
