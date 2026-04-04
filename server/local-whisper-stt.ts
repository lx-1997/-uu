/**
 * 本地语音转写（不经过云端 ASR）。**macOS 与 Windows 同一套环境变量**；实现为 Node spawn + 绝对路径，无平台专有 API。
 *
 * ## whisper.cpp（推荐：macOS / Windows / Linux 通用）
 * 构建：https://github.com/ggml-org/whisper.cpp
 *
 * - macOS 示例：
 *   RDK_STUDIO_WHISPER_CPP=/Users/you/whisper.cpp/build/bin/whisper-cli
 *   RDK_STUDIO_WHISPER_CPP_MODEL=/Users/you/models/ggml-medium.bin
 * - Windows 示例（可直接用正斜杠，或写成 whisper-cli.exe）：
 *   RDK_STUDIO_WHISPER_CPP=D:/dev/whisper.cpp/build/bin/Release/whisper-cli.exe
 *   RDK_STUDIO_WHISPER_CPP_MODEL=D:/models/ggml-medium.bin
 *
 * ## Const-me / WhisperDesktop（仅 Windows 常用：GPU 版 main.exe）
 * - RDK_STUDIO_WHISPER_MAIN=C:/path/to/main.exe
 * - RDK_STUDIO_WHISPER_MODEL=...
 * macOS 上请看上节使用 whisper-cli；勿指到 .app Bundle，需可执行文件路径。
 *
 * ## 共用（可选）
 * - RDK_STUDIO_WHISPER_LANGUAGE : 默认 zh；whisper.cpp 可设 auto
 * - RDK_STUDIO_WHISPER_TIMEOUT_MS : 默认 300000
 * - RDK_STUDIO_FFMPEG : 未设置时在 PATH 中找 ffmpeg（Win 上通常为 ffmpeg.exe）
 *
 * 优先级：环境变量 → 缓存 ~/.rdkstudio/local-whisper-cache.json → 自动探测 PATH 与常见目录；再无则 Const-me main.exe。
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';

const RDK_DIR = path.join(os.homedir(), '.rdkstudio');
const WHISPER_CACHE_FILE = path.join(RDK_DIR, 'local-whisper-cache.json');

export interface SharedWhisperSttConfig {
  language: string;
  timeoutMs: number;
  ffmpegPath: string;
}

export interface WhisperCppSttConfig extends SharedWhisperSttConfig {
  cliPath: string;
  modelPath: string;
}

export interface WhisperDesktopSttConfig extends SharedWhisperSttConfig {
  mainPath: string;
  modelPath: string;
}

/**
 * Windows：若给定路径不存在且无 .exe 后缀，则尝试追加 .exe（与 macOS/Linux 仅使用原路径）。
 */
function resolveLocalExecutable(userPath: string): string {
  const p = userPath.trim();
  if (!p) return p;
  if (process.platform !== 'win32') return p;
  if (existsSync(p)) return p;
  const ext = path.extname(p).toLowerCase();
  if (ext === '.exe') return p;
  const withExe = `${p}.exe`;
  return existsSync(withExe) ? withExe : p;
}

function sharedFromEnv(): SharedWhisperSttConfig {
  const language = process.env.RDK_STUDIO_WHISPER_LANGUAGE?.trim() || 'auto';
  const rawTimeout = process.env.RDK_STUDIO_WHISPER_TIMEOUT_MS?.trim();
  const parsed = rawTimeout ? Number.parseInt(rawTimeout, 10) : 300_000;
  const timeoutMs = Number.isFinite(parsed)
    ? Math.max(10_000, Math.min(600_000, parsed))
    : 300_000;
  const ffmpegRaw = process.env.RDK_STUDIO_FFMPEG?.trim();
  const ffmpegPath = ffmpegRaw ? resolveLocalExecutable(ffmpegRaw) : 'ffmpeg';
  return { language, timeoutMs, ffmpegPath };
}

/** 环境变量显式指定（最高优先级） */
function loadWhisperCppConfigFromEnv(): WhisperCppSttConfig | null {
  const cliPathRaw = process.env.RDK_STUDIO_WHISPER_CPP?.trim();
  if (!cliPathRaw) return null;
  const cliPath = resolveLocalExecutable(cliPathRaw);
  const modelPath =
    process.env.RDK_STUDIO_WHISPER_CPP_MODEL?.trim()
    || process.env.RDK_STUDIO_WHISPER_MODEL?.trim();
  if (!modelPath) return null;
  const shared = sharedFromEnv();
  return { cliPath, modelPath, ...shared };
}

function whichExecutable(cmd: string): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`where ${cmd}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }).trim();
      const line = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line && existsSync(line)) return line;
    } else {
      const out = execSync(`which ${cmd}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out && existsSync(out)) return out;
    }
  } catch {
    /* not in PATH */
  }
  return null;
}

/** 常见安装位置（未配环境变量时） */
function candidateWhisperCliPaths(): string[] {
  const home = os.homedir();
  const uniq = new Set<string>();
  const add = (p: string | null | undefined) => {
    const s = typeof p === 'string' ? p.trim() : '';
    if (s) uniq.add(s);
  };
  add(whichExecutable('whisper-cli'));
  add(whichExecutable('whisper-cpp'));
  add(path.join(home, 'whisper.cpp', 'build', 'bin', 'whisper-cli'));
  add(path.join(home, 'whisper.cpp', 'build', 'bin', 'Release', 'whisper-cli.exe'));
  add(path.join(home, 'dev', 'whisper.cpp', 'build', 'bin', 'whisper-cli'));
  add('/opt/homebrew/bin/whisper-cli');
  add('/usr/local/bin/whisper-cli');
  add('/opt/homebrew/opt/whisper-cpp/bin/whisper-cli');
  return [...uniq];
}

/** 各尺寸完整模型的最小字节数（低于此值视为下载不完整） */
function expectedMinModelSize(fileName: string): number {
  const n = fileName.toLowerCase();
  if (n.includes('large')) return 2_500_000_000;
  if (n.includes('medium')) return 1_400_000_000;
  if (n.includes('small')) return 450_000_000;
  if (n.includes('base')) return 130_000_000;
  if (n.includes('tiny')) return 70_000_000;
  return 70_000_000;
}

/** 多语言 + 快语速场景下优先选质量更好的模型（small/medium > base > tiny）；large 太慢降一档 */
function rankGgmlModel(filePath: string): number {
  const n = path.basename(filePath).toLowerCase();
  if (n.includes('small')) return 0;
  if (n.includes('medium')) return 1;
  if (n.includes('base')) return 2;
  if (n.includes('large')) return 3;
  if (n.includes('tiny')) return 4;
  return 2;
}

function findGgmlModelNearCli(cliPath: string): string | null {
  const home = os.homedir();
  const cliDir = path.dirname(path.resolve(cliPath));
  const dirs = [
    path.join(home, '.rdkstudio', 'models'),
    path.join(home, 'whisper.cpp', 'models'),
    path.join(home, 'dev', 'whisper.cpp', 'models'),
    path.join(cliDir, '..', '..', 'models'),
    path.join(cliDir, '..', 'models'),
    path.join(cliDir, 'models'),
  ];
  const found: string[] = [];
  for (const d of dirs) {
    try {
      const norm = path.resolve(d);
      if (!existsSync(norm)) continue;
      const names = readdirSync(norm);
      for (const f of names) {
        if (!/^ggml-.*\.bin$/i.test(f)) continue;
        const full = path.join(norm, f);
        if (!existsSync(full)) continue;
        try {
          const sz = statSync(full).size;
          const minSize = expectedMinModelSize(f);
          if (sz < minSize) continue;
        } catch { continue; }
        found.push(full);
      }
    } catch {
      /* ignore */
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => rankGgmlModel(a) - rankGgmlModel(b));
  return found[0];
}

function loadWhisperCppCacheDisk(): { cliPath: string; modelPath: string } | null {
  try {
    const raw = readFileSync(WHISPER_CACHE_FILE, 'utf8');
    const j = JSON.parse(raw) as { cliPath?: string; modelPath?: string };
    if (
      typeof j.cliPath === 'string'
      && typeof j.modelPath === 'string'
      && existsSync(j.cliPath)
      && existsSync(j.modelPath)
    ) {
      return { cliPath: j.cliPath, modelPath: j.modelPath };
    }
  } catch {
    /* no cache */
  }
  return null;
}

function saveWhisperCppCacheDisk(cliPath: string, modelPath: string): void {
  try {
    mkdirSync(RDK_DIR, { recursive: true });
    writeFileSync(
      WHISPER_CACHE_FILE,
      `${JSON.stringify({ cliPath, modelPath, updatedAt: Date.now() }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

function probeWhisperCppAuto(): { cliPath: string; modelPath: string } | null {
  for (const raw of candidateWhisperCliPaths()) {
    const cliPath = process.platform === 'win32' ? resolveLocalExecutable(raw) : raw;
    if (!cliPath || !existsSync(cliPath)) continue;
    const modelPath = findGgmlModelNearCli(cliPath);
    if (!modelPath) continue;
    saveWhisperCppCacheDisk(cliPath, modelPath);
    console.log(`[local-whisper] 已自动探测 whisper-cli 与模型（已写入 ${WHISPER_CACHE_FILE}）`);
    return { cliPath, modelPath };
  }
  return null;
}

export function loadWhisperCppConfig(): WhisperCppSttConfig | null {
  const fromEnv = loadWhisperCppConfigFromEnv();
  if (fromEnv) return fromEnv;

  const cached = loadWhisperCppCacheDisk();
  if (cached) {
    const shared = sharedFromEnv();
    return { cliPath: cached.cliPath, modelPath: cached.modelPath, ...shared };
  }

  const probed = probeWhisperCppAuto();
  if (!probed) return null;
  const shared = sharedFromEnv();
  return { cliPath: probed.cliPath, modelPath: probed.modelPath, ...shared };
}

export function loadWhisperDesktopConfig(): WhisperDesktopSttConfig | null {
  const mainPathRaw = process.env.RDK_STUDIO_WHISPER_MAIN?.trim();
  const modelPath = process.env.RDK_STUDIO_WHISPER_MODEL?.trim();
  if (!mainPathRaw || !modelPath) return null;
  const mainPath = resolveLocalExecutable(mainPathRaw);
  const shared = sharedFromEnv();
  return { mainPath, modelPath, ...shared };
}

export function isLocalWhisperConfigured(): boolean {
  return loadWhisperCppConfig() !== null || loadWhisperDesktopConfig() !== null;
}

/** @deprecated 使用 isLocalWhisperConfigured */
export function isWhisperDesktopConfigured(): boolean {
  return isLocalWhisperConfigured();
}

function runCmd(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: process.env,
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.stdout?.on('data', () => {});
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 8000);
      killer.unref();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function ensureWav16kMono(
  ffmpegPath: string,
  inputPath: string,
  outWav: string,
  timeoutMs: number,
): Promise<void> {
  const args = [
    '-y',
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-sample_fmt',
    's16',
    outWav,
  ];
  const { code, stderr } = await runCmd(ffmpegPath, args, path.dirname(outWav), Math.min(timeoutMs, 180_000));
  if (code !== 0) {
    throw new Error(`ffmpeg 转换失败（请安装 ffmpeg 并确保在 PATH 中）: ${stderr.slice(0, 420) || `exit ${code}`}`);
  }
}

function stripWhisperTxtTimestamps(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WHISPER_CPP_NATIVE_EXT = new Set(['.wav', '.mp3', '.flac', '.ogg']);

async function transcribeWhisperCppFromFile(
  audioPath: string,
  cfg: WhisperCppSttConfig,
): Promise<string> {
  const workDir = path.dirname(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  let inputForCli = audioPath;
  let tmpWav: string | null = null;

  try {
    if (!WHISPER_CPP_NATIVE_EXT.has(ext)) {
      tmpWav = path.join(
        workDir,
        `rdk-cpp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`,
      );
      await ensureWav16kMono(cfg.ffmpegPath, audioPath, tmpWav, cfg.timeoutMs);
      inputForCli = tmpWav;
    }

    const outBase = path.join(workDir, `rdk-cpp-out-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const cpuCount = Math.max(2, Math.min(8, os.cpus().length));
    const args = [
      '-m', cfg.modelPath,
      '-f', inputForCli,
      '-otxt',
      '-nt',
      '-np',
      '-l', cfg.language,
      '-t', String(cpuCount),
      '-et', '2.8',
      '-of', outBase,
    ];
    const { code, stderr } = await runCmd(cfg.cliPath, args, workDir, cfg.timeoutMs);
    if (code !== 0) {
      throw new Error(stderr.trim().slice(0, 800) || `whisper.cpp 退出码 ${code}`);
    }

    const txtPath = `${outBase}.txt`;
    const raw = await fs.readFile(txtPath, 'utf8');
    await fs.unlink(txtPath).catch(() => {});

    const text = stripWhisperTxtTimestamps(raw);
    if (!text) {
      throw new Error('whisper.cpp 生成的文本为空');
    }
    return text;
  } finally {
    if (tmpWav) {
      await fs.unlink(tmpWav).catch(() => {});
    }
  }
}

async function transcribeConstMeFromFile(
  audioPath: string,
  cfg: WhisperDesktopSttConfig,
): Promise<string> {
  const workDir = path.dirname(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  let inputForCli = audioPath;
  let tmpWav: string | null = null;

  try {
    if (ext !== '.wav') {
      tmpWav = path.join(
        workDir,
        `rdk-whisper-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`,
      );
      await ensureWav16kMono(cfg.ffmpegPath, audioPath, tmpWav, cfg.timeoutMs);
      inputForCli = tmpWav;
    }

    const args = ['-m', cfg.modelPath, '-otxt', '-nt', '-l', cfg.language, inputForCli];
    const { code, stderr } = await runCmd(cfg.mainPath, args, workDir, cfg.timeoutMs);
    if (code !== 0) {
      throw new Error(stderr.trim().slice(0, 800) || `Whisper main.exe 退出码 ${code}`);
    }

    const stem = path.basename(inputForCli, path.extname(inputForCli));
    const txtPath = path.join(workDir, `${stem}.txt`);
    const raw = await fs.readFile(txtPath, 'utf8');
    await fs.unlink(txtPath).catch(() => {});

    const text = stripWhisperTxtTimestamps(raw);
    if (!text) {
      throw new Error('Whisper 生成的文本为空');
    }
    return text;
  } finally {
    if (tmpWav) {
      await fs.unlink(tmpWav).catch(() => {});
    }
  }
}

/**
 * 已配置时返回转写文本；未配置任一路径时返回 null；已配置但执行失败时抛错。
 * 顺序：whisper.cpp → Const-me main.exe。
 */
export async function transcribeLocalWhisperFromFile(audioPath: string): Promise<string | null> {
  const cpp = loadWhisperCppConfig();
  if (cpp) {
    return transcribeWhisperCppFromFile(audioPath, cpp);
  }
  const desktop = loadWhisperDesktopConfig();
  if (desktop) {
    return transcribeConstMeFromFile(audioPath, desktop);
  }
  return null;
}

/** @deprecated 使用 transcribeLocalWhisperFromFile */
export async function transcribeWhisperDesktopFromFile(audioPath: string): Promise<string | null> {
  return transcribeLocalWhisperFromFile(audioPath);
}
