/**
 * 发版时在此维护「产品功能」短列表（面向用户，随版本更新）。
 * 构建版本号来自 Vite 注入的 package.json version；构建日期为构建当日 UTC 日期。
 */
export const RELEASE_NOTES_ZH: string[] = [
  '工作台：连接 RDK 开发板，查看内存/温度/运行时间等状态，快捷进入终端、OpenClaw 与设备体检',
  'AI 与技能：RDKClaw 对话编排，OpenClaw 板端 Agent、技能工坊创建与部署',
  '远程开发：SSH、设备文件、远程桌面（noVNC）、在线 IDE，集中完成日常开发',
  '板端能力：ROS2、硬件监控、镜像烧录/备份、NodeHub/ModelZoo 等扩展入口',
  '账号与合规：支持统一登录；可选匿名日活统计用于改进产品（不含聊天正文）',
];

/** 与 RELEASE_NOTES_ZH 一一对应 */
export const RELEASE_NOTES_EN: string[] = [
  'Dashboard: connect boards, view memory/temp/uptime, quick access to terminal, OpenClaw, and health checks',
  'AI & skills: RDKClaw orchestration; OpenClaw on-device agent; skill studio create & deploy',
  'Remote dev: SSH, device files, noVNC desktop, web IDE',
  'Board: ROS2, hardware tools, flash/backup, NodeHub/ModelZoo entry points',
  'Account & compliance: SSO; optional anonymous daily stats (no chat content)',
];

export function getAppVersionLabel() {
  const v = import.meta.env.VITE_APP_VERSION || '0.0.0';
  const d = import.meta.env.VITE_APP_BUILD_DATE || '';
  return d ? `v${v} · ${d}` : `v${v}`;
}
