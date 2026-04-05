import { useMemo } from 'react';
import { getCapabilityDisplayLabel } from '../ai';
import type { Task } from '../ai';
import type { RdkClawTimelineEntry } from '../hooks/useAIChatStore';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { isDeviceShownOnline } from '../utils/device-connection';

const ACTIVE_ORCHESTRATOR = new Set<Task['status']>(['pending', 'confirming', 'running']);

function statusOrder(s: Task['status']): number {
  if (s === 'running') return 0;
  if (s === 'confirming') return 1;
  if (s === 'pending') return 2;
  return 9;
}

function activeStepHint(task: Task): string | null {
  const running = task.steps.find((s) => s.status === 'running');
  if (running) return running.label;
  const pending = task.steps.find((s) => s.status === 'pending');
  if (pending) return pending.label;
  return null;
}

function taskStatusLabel(
  t: (k: string, zh: string) => string,
  status: Task['status'],
): string {
  if (status === 'running') return t('dock.task.status.running', '执行中');
  if (status === 'done') return t('dock.task.status.done', '完成');
  if (status === 'failed') return t('dock.task.status.failed', '失败');
  if (status === 'confirming') return t('dock.task.status.confirming', '待确认');
  return t('dock.task.status.pending', '等待');
}

/** 时间线中最近一条可展示的执行/工具语句 */
function pickTimelineExecutionHint(timeline: RdkClawTimelineEntry[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    if (e.kind === 'board_tool' || e.kind === 'tool_start' || e.kind === 'progress') {
      const s = (e.title || e.detail || '').trim();
      if (s) return s.length > 72 ? `${s.slice(0, 72)}…` : s;
    }
  }
  const last = timeline[timeline.length - 1];
  const s = (last?.title || last?.detail || '').trim();
  if (!s) return null;
  return s.length > 72 ? `${s.slice(0, 72)}…` : s;
}

/**
 * 顶栏：工作台正在执行的任务 ——
 * - RDKClaw 对话流式/工具（时间线）、智能体计划、后台对话
 * - 烧录、流程检查、全局 Loading、ROS 录制
 * - 旧版编排器 taskHistory（与 Dock「任务」同源）
 */
export default function RuntimeActiveTaskQueue() {
  const { t, isEn } = useI18n();
  const {
    taskHistory,
    cancelRunningTask,
    setChatExpanded,
    setShowTaskPanel,
    setActiveTab,
    agentExecution,
    agentPlan,
    backgroundRuns,
    aiTyping,
    rdkClawRunTimeline,
    isFlashing,
    flashPhase,
    flashProgress,
    isFlowChecking,
    isLoading,
    loadingMsg,
    rosRecording,
    currentDevice,
    devices,
  } = useAppState();

  const taskQueueFocusDevice = useMemo(
    () => currentDevice ?? (devices.length > 0 ? devices[0] : undefined),
    [currentDevice, devices],
  );
  const deviceOnline = Boolean(taskQueueFocusDevice && isDeviceShownOnline(taskQueueFocusDevice));

  const activeOrchestratorTasks = useMemo(() => {
    const list = taskHistory.filter((x) => ACTIVE_ORCHESTRATOR.has(x.status));
    return [...list].sort(
      (a, b) => statusOrder(a.status) - statusOrder(b.status) || b.createdAt - a.createdAt,
    );
  }, [taskHistory]);

  const backgroundRunning = useMemo(
    () => backgroundRuns.filter((r) => r.status === 'running'),
    [backgroundRuns],
  );

  const timelineHint = useMemo(
    () => pickTimelineExecutionHint(rdkClawRunTimeline),
    [rdkClawRunTimeline],
  );

  const rdkWorkspaceBusy =
    aiTyping || (agentExecution.running && agentExecution.totalSteps > 0);
  const agentChipActive = agentExecution.running && agentExecution.totalSteps > 0;

  const flashChipActive = isFlashing;
  const flowChipActive = isFlowChecking;
  const loadingChipActive = isLoading && Boolean(String(loadingMsg || '').trim());
  const rosChipActive = rosRecording;

  const hasChips =
    flashChipActive
    || flowChipActive
    || loadingChipActive
    || rosChipActive
    || rdkWorkspaceBusy
    || backgroundRunning.length > 0
    || activeOrchestratorTasks.length > 0;

  const openDockTasks = () => {
    setChatExpanded(true);
    setShowTaskPanel(true);
  };

  const openDockChat = () => {
    setChatExpanded(true);
  };

  return (
    <div
      className={`runtime-task-queue ${!hasChips ? 'runtime-task-queue--idle' : ''}`}
      role="region"
      aria-label={t('runtimeTasks.regionWorkspace', '工作台进行中的任务')}
    >
      <div className="runtime-task-queue-inner">
        <span className="runtime-task-queue-label">
          <span className="material-symbols-outlined runtime-task-queue-label-icon" aria-hidden>
            pending_actions
          </span>
          {t('runtimeTasks.titleWorkspaceExec', '工作台执行')}
        </span>

        {!hasChips && (
          <span className="runtime-task-queue-status">
            {deviceOnline
              ? t(
                  'runtimeTasks.emptyWorkspaceExec',
                  '当前无进行中的任务。可在工作台发起「一句话开发」、设备体检，或在对话中下达指令，进度将显示于此。',
                )
              : t(
                  'runtimeTasks.emptyWorkspaceExecNoDevice',
                  '当前无进行中的任务。请先添加并连接开发板以使用完整能力；若想循序渐进了解平台，可在工作台点击「重新开始引导」进入新手引导。有任务执行时，进度将显示于此。',
                )}
          </span>
        )}

        {hasChips && (
          <div className="runtime-task-queue-chips">
            {flashChipActive && (
              <button
                type="button"
                className="runtime-task-chip"
                onClick={() => setActiveTab('flasher')}
                title={t('runtimeTasks.openFlasher', '打开烧录工具')}
              >
                <span className="material-symbols-outlined runtime-task-chip-spin" aria-hidden>
                  progress_activity
                </span>
                <span className="runtime-task-chip-text">
                  <span className="runtime-task-chip-kind">
                    {t('runtimeTasks.flashInProgress', '镜像烧录')}
                  </span>
                  <span className="runtime-task-chip-step">
                    {flashPhase}
                    {typeof flashProgress === 'number' && flashProgress >= 0
                      ? ` · ${Math.round(flashProgress)}%`
                      : ''}
                  </span>
                </span>
              </button>
            )}

            {flowChipActive && (
              <button
                type="button"
                className="runtime-task-chip"
                onClick={() => setActiveTab('dashboard')}
                title={t('runtimeTasks.flowCheckHint', '流程编排检查进行中')}
              >
                <span className="material-symbols-outlined runtime-task-chip-spin" aria-hidden>
                  account_tree
                </span>
                <span className="runtime-task-chip-text">
                  <span className="runtime-task-chip-kind">
                    {t('runtimeTasks.flowChecking', '流程检查')}
                  </span>
                  <span className="runtime-task-chip-step">
                    {t('runtimeTasks.flowCheckingDetail', 'Node-RED / ROS 校验…')}
                  </span>
                </span>
              </button>
            )}

            {loadingChipActive && (
              <div className="runtime-task-chip runtime-task-chip--static">
                <span className="material-symbols-outlined runtime-task-chip-spin" aria-hidden>
                  hourglass_top
                </span>
                <span className="runtime-task-chip-text">
                  <span className="runtime-task-chip-kind">
                    {t('runtimeTasks.workspaceLoading', '加载中')}
                  </span>
                  <span className="runtime-task-chip-step">{loadingMsg}</span>
                </span>
              </div>
            )}

            {rosChipActive && (
              <button
                type="button"
                className="runtime-task-chip"
                onClick={() => setActiveTab('dashboard')}
                title={t('runtimeTasks.openDashboard', '打开工作台')}
              >
                <span className="material-symbols-outlined runtime-task-chip-spin" aria-hidden>
                  fiber_manual_record
                </span>
                <span className="runtime-task-chip-text">
                  <span className="runtime-task-chip-kind">
                    {t('runtimeTasks.rosRecording', 'ROS 录制')}
                  </span>
                  <span className="runtime-task-chip-step">
                    {t('runtimeTasks.rosRecordingDetail', '话题录制进行中')}
                  </span>
                </span>
              </button>
            )}

            {rdkWorkspaceBusy && (
              <button
                type="button"
                className="runtime-task-chip"
                onClick={openDockChat}
                title={t('runtimeTasks.openRdkDock', '打开 RDKClaw 对话')}
              >
                <span className="material-symbols-outlined runtime-task-chip-spin" aria-hidden>
                  smart_toy
                </span>
                <span className="runtime-task-chip-text">
                  <span className="runtime-task-chip-kind">
                    {t('runtimeTasks.rdkclawExecuting', 'RDKClaw 执行')}
                  </span>
                  <span className="runtime-task-chip-step">
                    {agentChipActive && (
                      <>
                        {agentPlan?.summary?.trim()
                          ? `${agentPlan.summary.trim().slice(0, 40)}${agentPlan.summary.trim().length > 40 ? '…' : ''} · `
                          : ''}
                        {agentExecution.currentStep}/{agentExecution.totalSteps}
                        {(aiTyping || timelineHint) ? ' · ' : ''}
                      </>
                    )}
                    {(timelineHint
                      || (aiTyping
                        ? t('runtimeTasks.studioThinking', '思考与工具执行中…')
                        : ''))}
                  </span>
                </span>
              </button>
            )}

            {backgroundRunning.map((r) => (
              <button
                key={r.runId}
                type="button"
                className="runtime-task-chip"
                onClick={openDockChat}
                title={t('runtimeTasks.openBackgroundRun', '打开对话查看后台任务')}
              >
                <span className="material-symbols-outlined runtime-task-chip-spin" aria-hidden>
                  clouds
                </span>
                <span className="runtime-task-chip-text">
                  <span className="runtime-task-chip-kind">
                    {t('runtimeTasks.backgroundRun', '后台对话')}
                  </span>
                  <span className="runtime-task-chip-detail mono">{r.runId.slice(0, 8)}…</span>
                </span>
              </button>
            ))}

            {activeOrchestratorTasks.map((task) => {
              const hint = activeStepHint(task);
              return (
                <div key={task.id} className="runtime-task-chip-row">
                  <button
                    type="button"
                    className="runtime-task-chip"
                    onClick={openDockTasks}
                    title={t('runtimeTasks.openTaskDock', '打开对话与任务面板')}
                  >
                    <span
                      className={`material-symbols-outlined ${task.status === 'running' ? 'runtime-task-chip-spin' : ''}`}
                      aria-hidden
                    >
                      {task.status === 'running' ? 'progress_activity' : 'task_alt'}
                    </span>
                    <span className="runtime-task-chip-text">
                      <span className="runtime-task-chip-kind">
                        {getCapabilityDisplayLabel(task.capabilityId, isEn)}
                      </span>
                      <span className="runtime-task-chip-step">
                        {taskStatusLabel(t, task.status)}
                        {hint ? ` · ${hint}` : ''}
                      </span>
                    </span>
                  </button>
                  {task.status === 'running' && (
                    <button
                      type="button"
                      className="runtime-task-chip-cancel"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelRunningTask(task.id);
                      }}
                    >
                      {t('dock.task.cancel', '取消')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
