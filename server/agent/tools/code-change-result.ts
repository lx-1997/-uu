/**
 * 工具结果 JSON：供前端在会话中展示「改了什么」（本机 write/edit 与套件端 device_file_write）。
 * 与 useAIChatStore 中 __type === 'code_change' 分支对齐。
 */

export type CodeChangePayload = {
  __type: 'code_change';
  /** 本机工作区或套件端设备 */
  scope: 'workspace' | 'device';
  /** 展示用路径（相对 workspace 或设备绝对路径） */
  path: string;
  /** write | edit | overwrite */
  op: 'write' | 'edit' | 'overwrite';
  /** 一行摘要，给模型与侧边栏状态行用 */
  summary: string;
  /** 供用户阅读的 diff/前后对照（可能截断） */
  preview: string;
};

const MAX_PREVIEW_CHARS = 24_000;

function truncate(s: string, max: number): string {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n… [预览已截断，共 ${t.length} 字符]`;
}

/** 粗略统计增删（按行近似，供 summary） */
function lineDelta(before: string, after: string): { plus: number; minus: number } {
  const a = before.split('\n');
  const b = after.split('\n');
  return { plus: Math.max(0, b.length - a.length), minus: Math.max(0, a.length - b.length) };
}

/**
 * 构造写入/覆盖类变更的预览（整文件前后对照）。
 */
export function buildCodeChangeJson(params: {
  scope: 'workspace' | 'device';
  path: string;
  op: 'write' | 'overwrite';
  before: string;
  after: string;
}): string {
  const { scope, path, op, before, after } = params;
  const isNew = !before.length;
  const { plus, minus } = lineDelta(before, after);
  const summary = isNew
    ? `新建 ${path}（${after.split('\n').length} 行）`
    : `覆盖 ${path}（约 +${plus} / -${minus} 行，以预览为准）`;
  const preview = isNew
    ? truncate(`--- 新文件\n+++ ${path}\n\n${after}`, MAX_PREVIEW_CHARS)
    : truncate(
        `--- 修改前\n${before}\n\n+++ 修改后\n${after}`,
        MAX_PREVIEW_CHARS,
      );
  const payload: CodeChangePayload = {
    __type: 'code_change',
    scope,
    path,
    op,
    summary,
    preview: truncate(preview, MAX_PREVIEW_CHARS),
  };
  return JSON.stringify(payload);
}

/**
 * edit 工具：只展示替换片段附近上下文，避免整文件撑爆上下文。
 */
export function buildEditCodeChangeJson(params: {
  scope: 'workspace' | 'device';
  path: string;
  oldString: string;
  newString: string;
}): string {
  const { scope, path, oldString, newString } = params;
  const summary = `编辑 ${path}（替换 ${oldString.split('\n').length}→${newString.split('\n').length} 行片段）`;
  const preview = truncate(
    [
      '--- 被替换片段（old_string）',
      oldString,
      '',
      '+++ 新片段（new_string）',
      newString,
    ].join('\n'),
    MAX_PREVIEW_CHARS,
  );
  const payload: CodeChangePayload = {
    __type: 'code_change',
    scope,
    path,
    op: 'edit',
    summary,
    preview,
  };
  return JSON.stringify(payload);
}
