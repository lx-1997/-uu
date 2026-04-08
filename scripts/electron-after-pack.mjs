/**
 * electron-builder afterPack：在生成 NSIS/DMG/AppImage 等安装包之前，把 RELEASES.json 写入应用 resources，
 * 使安装后的程序目录内可见（与输出目录旁的 RELEASES.json 同源结构；artifacts 在构建结束前可能为空）。
 */
import { writeStubReleasesIntoAppOutDir } from './write-desktop-releases.mjs';

export default async function electronAfterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const rootDir = packager?.projectDir || process.cwd();
  writeStubReleasesIntoAppOutDir(appOutDir, rootDir, electronPlatformName);
}
