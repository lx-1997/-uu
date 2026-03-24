import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WeixinAccount {
  accountId: string;
  token: string;
  nickname?: string;
  boundAt: number;
}

interface StoreData {
  accounts: WeixinAccount[];
}

const STORE_DIR = path.join(os.homedir(), ".rdkstudio");
const STORE_FILE = path.join(STORE_DIR, "weixin-accounts.json");

const OPENCLAW_ACCOUNTS_DIR = path.join(os.homedir(), ".openclaw", "openclaw-weixin", "accounts");

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

export class WeixinAccountStore {
  private data: StoreData;

  constructor() {
    this.data = this.read();
  }

  private read(): StoreData {
    try {
      if (!fs.existsSync(STORE_FILE)) return { accounts: [] };
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      return {
        accounts: Array.isArray(parsed.accounts)
          ? parsed.accounts.filter((a) => a && typeof a.accountId === "string" && typeof a.token === "string")
          : [],
      };
    } catch {
      return { accounts: [] };
    }
  }

  private save() {
    ensureDir();
    const content = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(STORE_FILE, content, { encoding: "utf-8", mode: 0o600 });
  }

  reload() {
    this.data = this.read();
  }

  listAccounts(): WeixinAccount[] {
    return [...this.data.accounts];
  }

  getAccount(accountId: string): WeixinAccount | undefined {
    return this.data.accounts.find((a) => a.accountId === accountId);
  }

  addAccount(account: WeixinAccount): void {
    const idx = this.data.accounts.findIndex((a) => a.accountId === account.accountId);
    if (idx >= 0) {
      this.data.accounts[idx] = account;
    } else {
      this.data.accounts.push(account);
    }
    this.save();
  }

  removeAccount(accountId: string): boolean {
    const before = this.data.accounts.length;
    this.data.accounts = this.data.accounts.filter((a) => a.accountId !== accountId);
    if (this.data.accounts.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  updateToken(accountId: string, token: string): boolean {
    const acct = this.data.accounts.find((a) => a.accountId === accountId);
    if (!acct) return false;
    acct.token = token;
    this.save();
    return true;
  }

  importFromOpenClawDir(): number {
    let imported = 0;
    try {
      if (!fs.existsSync(OPENCLAW_ACCOUNTS_DIR)) return 0;
      const files = fs.readdirSync(OPENCLAW_ACCOUNTS_DIR).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(OPENCLAW_ACCOUNTS_DIR, file), "utf-8");
          const parsed = JSON.parse(raw) as { accountId?: string; token?: string; nickname?: string };
          if (parsed.accountId && parsed.token) {
            const existing = this.data.accounts.find((a) => a.accountId === parsed.accountId);
            if (!existing) {
              this.data.accounts.push({
                accountId: parsed.accountId,
                token: parsed.token,
                nickname: parsed.nickname || undefined,
                boundAt: Date.now(),
              });
              imported++;
            }
          }
        } catch {
          // skip malformed account file
        }
      }
      if (imported > 0) this.save();
    } catch {
      // openclaw dir not accessible
    }
    return imported;
  }
}
