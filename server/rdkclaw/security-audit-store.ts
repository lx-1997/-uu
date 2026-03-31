/**
 * 安全审计日志存储。
 *
 * 优化设计：
 * - 内存缓存：读取操作直接返回内存数据，零磁盘 I/O。
 * - 异步写入队列：appendSecurityAuditLog 立即返回（不阻塞事件循环），
 *   写入操作通过 Promise 链串行化，避免并发写冲突。
 * - 原子写入：先写临时文件再 rename，防止写入中途崩溃导致 JSON 损坏。
 * - 启动时懒加载：首次读取时从磁盘加载到内存，后续全部走缓存。
 */
import { promises as fsp } from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChannelSource, RiskLevel } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.rdkstudio');
const AUDIT_FILE = path.join(CONFIG_DIR, 'rdkclaw-security-audit.json');
const MAX_ENTRIES = 500;

export type SecurityAuditAction = 'blocked' | 'auto_allow' | 'approval_required' | 'approval_decision';

export interface SecurityAuditLogEntry {
  id: string;
  timestamp: number;
  channel: ChannelSource;
  toolName: string;
  risk: RiskLevel;
  action: SecurityAuditAction;
  reason?: string;
  decision?: string;
  sessionId?: string;
  runId?: string;
}

// ─── 内存缓存 ───

let _cache: SecurityAuditLogEntry[] | null = null;

function loadCacheSync(): SecurityAuditLogEntry[] {
  if (_cache) return _cache;
  try {
    if (!fs.existsSync(AUDIT_FILE)) {
      _cache = [];
      return _cache;
    }
    const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as SecurityAuditLogEntry[];
    _cache = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === 'object')
      : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

// ─── 异步写入队列 ───

let _writeChain: Promise<void> = Promise.resolve();

function scheduleFlush(): void {
  const snapshot = JSON.stringify(_cache ?? [], null, 2);
  const task = async () => {
    try {
      await fsp.mkdir(CONFIG_DIR, { recursive: true });
      const tmpPath = AUDIT_FILE + '.tmp.' + process.pid;
      await fsp.writeFile(tmpPath, snapshot, 'utf-8');
      await fsp.rename(tmpPath, AUDIT_FILE);
    } catch (err) {
      process.stderr.write(
        `[security-audit-store] flush failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  };
  _writeChain = _writeChain.then(task, task);
}

// ─── 公开 API ───

export function appendSecurityAuditLog(entry: Omit<SecurityAuditLogEntry, 'id' | 'timestamp'>) {
  const items = loadCacheSync();
  const next: SecurityAuditLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  items.unshift(next);
  if (items.length > MAX_ENTRIES) {
    items.length = MAX_ENTRIES;
  }
  scheduleFlush();
}

export function listSecurityAuditLogs(limit = 30): SecurityAuditLogEntry[] {
  const size = Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 30));
  return loadCacheSync().slice(0, size);
}

export function clearSecurityAuditLogs() {
  _cache = [];
  scheduleFlush();
}
