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

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readEntries(): SecurityAuditLogEntry[] {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as SecurityAuditLogEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object');
  } catch {
    return [];
  }
}

function writeEntries(items: SecurityAuditLogEntry[]) {
  ensureDir();
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

export function appendSecurityAuditLog(entry: Omit<SecurityAuditLogEntry, 'id' | 'timestamp'>) {
  const next: SecurityAuditLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  const items = readEntries();
  items.unshift(next);
  if (items.length > MAX_ENTRIES) {
    items.length = MAX_ENTRIES;
  }
  writeEntries(items);
}

export function listSecurityAuditLogs(limit = 30): SecurityAuditLogEntry[] {
  const size = Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 30));
  return readEntries().slice(0, size);
}

export function clearSecurityAuditLogs() {
  writeEntries([]);
}
