/**
 * 「关于」弹窗中的**本版本更新说明**（非泛化产品介绍）。
 * 发版时按 package.json 版本与近期提交（git log）同步更新；与根目录 CHANGELOG.md 宜保持一致。
 */
export const UPDATE_NOTES_ZH: string[] = [
  '设备文件：上传/保存与 SSH 读列对齐；root 登录避免多余 sudo；exec 排空与超时；Electron 选文件改为 sr-only + label。',
  'CORS / Socket.IO：默认放行端口与后端监听 8787 一致，修复本机访问时握手失败。',
  '工作台与文件：仪表盘静态引用修复；设备文件编码与大文件 SSH 读取改进。',
  '桌面与连接：Type-C 本机 IP 校验、发版脚本与添加设备流程。',
  'OpenClaw / 入门：onboarding 与 hello、SFTP 写入、工具中止与 quickActiveId；套件端 apt 锁等待等。',
  '工作区 IDE：健康检查按 CODE_SERVER_HTTP_PORT（9888）探测 code-server。',
];

/** 与 UPDATE_NOTES_ZH 一一对应 */
export const UPDATE_NOTES_EN: string[] = [
  'Device files: upload/save path aligned with SSH read/list; skip redundant sudo for root; drain exec & timeouts; Electron file picker uses sr-only + label.',
  'CORS / Socket.IO: allowlist default port matches backend (8787); fixes WS handshake when opened from localhost.',
  'Workbench & files: dashboard static import fix; device-file encoding and large-file SSH read.',
  'Desktop & pairing: Type-C PC IP verification, release scripts, add-device flow.',
  'OpenClaw & onboarding: hello flow, SFTP write, tool abort & quickActiveId; apt lock wait on device.',
  'Workspace IDE: health probe uses CODE_SERVER_HTTP_PORT (9888) for code-server.',
];

/** @deprecated 使用 UPDATE_NOTES_ZH，保留别名以免外部误引 */
export const RELEASE_NOTES_ZH = UPDATE_NOTES_ZH;
/** @deprecated 使用 UPDATE_NOTES_EN */
export const RELEASE_NOTES_EN = UPDATE_NOTES_EN;

/** 界面展示用，如 v1.0.3（不含构建日期） */
export function getAppVersionShort() {
  const v = import.meta.env.VITE_APP_VERSION || '0.0.0';
  return `v${v}`;
}
