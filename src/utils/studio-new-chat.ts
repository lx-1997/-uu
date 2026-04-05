import type { Task } from '../ai/types';

type Tr = (key: string, zh: string) => string;

/** 让 React 先提交 setState（如 stopAllRuns 会追加一条系统消息），再 flush/clear，避免 chatMessagesRef 仍指向旧快照 */
function waitForReactCommit(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 与 `useUIStore().showConfirm` / ConfirmDialog 一致，避免 window.confirm */
export type StudioShowConfirm = (
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { variant?: 'default' | 'danger'; confirmLabel?: string; onDismiss?: () => void },
) => void;

/** 是否有流式回复、本地任务队列或后台任务仍占用 Agent 侧 */
export function hasActiveStudioWork(opts: {
  aiTyping: boolean;
  taskHistory: Task[];
  backgroundRuns?: Array<{ status: 'running' | 'ended' }>;
}): boolean {
  return (
    opts.aiTyping
    || opts.taskHistory.some((tk) => tk.status === 'running')
    || (opts.backgroundRuns?.some((b) => b.status === 'running') ?? false)
  );
}

/** 新对话：若仍有生成或任务，先确认再 stopAllRuns，最后 clearChatHistory */
export async function confirmAndBeginNewChat(opts: {
  aiTyping: boolean;
  taskHistory: Task[];
  backgroundRuns?: Array<{ status: 'running' | 'ended' }>;
  t: Tr;
  showConfirm: StudioShowConfirm;
  stopAllRuns: () => void | Promise<void>;
  clearChatHistory: () => void;
}): Promise<void> {
  const busy = hasActiveStudioWork({
    aiTyping: opts.aiTyping,
    taskHistory: opts.taskHistory,
    backgroundRuns: opts.backgroundRuns,
  });
  if (!busy) {
    opts.clearChatHistory();
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    opts.showConfirm(
      opts.t('dock.newChat.busyTitle', '停止当前回复？'),
      opts.t(
        'dock.newChat.busyConfirm',
        '当前仍有回复或任务在执行。确定停止并开启新对话吗？未完成的回复将中断。',
      ),
      () => {
        void (async () => {
          await opts.stopAllRuns();
          await waitForReactCommit();
          opts.clearChatHistory();
          finish();
        })();
      },
      {
        confirmLabel: opts.t('confirm.ok', '确定'),
        onDismiss: finish,
      },
    );
  });
}

/**
 * 切换会话前：若有任务/回复，提示将取消并释放板端资源（单设备单长会话窗口）。
 * 确认后调用 stopAllRuns，再交由 resumeStudioThread。
 */
export async function confirmSwitchStudioThread(opts: {
  aiTyping: boolean;
  taskHistory: Task[];
  backgroundRuns?: Array<{ status: 'running' | 'ended' }>;
  t: Tr;
  showConfirm: StudioShowConfirm;
  stopAllRuns: () => void | Promise<void>;
}): Promise<boolean> {
  const busy = hasActiveStudioWork({
    aiTyping: opts.aiTyping,
    taskHistory: opts.taskHistory,
    backgroundRuns: opts.backgroundRuns,
  });
  if (!busy) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    opts.showConfirm(
      opts.t('chat.switch.threadBusyTitle', '切换会话？'),
      opts.t(
        'chat.switch.threadBusyConfirm',
        '当前仍有回复或任务在运行（含后台任务）。切换会话将停止并取消这些任务，以便释放板端资源；同一设备同一时刻只保留一个长会话窗口。\n\n确定切换吗？',
      ),
      () => {
        void (async () => {
          await opts.stopAllRuns();
          await waitForReactCommit();
          finish(true);
        })();
      },
      {
        confirmLabel: opts.t('confirm.ok', '确定'),
        onDismiss: () => finish(false),
      },
    );
  });
}
