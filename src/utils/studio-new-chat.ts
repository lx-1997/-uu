import type { Task } from '../ai/types';

type Tr = (key: string, zh: string) => string;

/** 新对话：若仍有生成或任务，先确认再 stopAllRuns，最后 clearChatHistory */
export async function confirmAndBeginNewChat(opts: {
  aiTyping: boolean;
  taskHistory: Task[];
  t: Tr;
  stopAllRuns: () => void | Promise<void>;
  clearChatHistory: () => void;
}): Promise<void> {
  const busy = opts.aiTyping || opts.taskHistory.some((tk) => tk.status === 'running');
  if (busy) {
    const ok = window.confirm(
      opts.t(
        'dock.newChat.busyConfirm',
        '当前仍有回复或任务在执行。确定停止并开启新对话吗？未完成的回复将中断。',
      ),
    );
    if (!ok) return;
    await opts.stopAllRuns();
  }
  opts.clearChatHistory();
}
