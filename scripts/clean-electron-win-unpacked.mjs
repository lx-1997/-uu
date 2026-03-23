/**
 * electron-builder 会先清空 release/win-unpacked；若 RDK Studio 仍在运行或资源管理器打开该目录，
 * Windows 会锁住 d3dcompiler_47.dll 等文件，导致 Access is denied。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '..', 'release', 'win-unpacked');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(target)) return;

  const lastError = { message: '' };
  for (let i = 0; i < 8; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (e) {
      lastError.message = e instanceof Error ? e.message : String(e);
      await sleep(400 * (i + 1));
    }
  }

  console.error('');
  console.error('[clean-electron-win-unpacked] 无法删除 release\\win-unpacked');
  console.error('请先：1) 退出所有「RDK Studio」进程（任务管理器结束任务）');
  console.error('        2) 关闭打开该文件夹的资源管理器窗口');
  console.error('        3) 暂时排除杀毒软件对该目录的实时扫描（若仍失败）');
  console.error('底层错误:', lastError.message);
  console.error('');
  process.exit(1);
}

main();
