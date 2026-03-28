/**
 * 将模型侧大块 message_delta 切成稳定节奏的小段再 push 到 SSE，
 * 避免前端一次收到整句/整段时「一坨一坨」的跳变感。
 *
 * 与非文本事件（工具、message_end 等）交错前必须 flushSync，保证顺序正确。
 */
export class TextDeltaSmoother {
  private buf = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly emitDelta: (chunk: string) => void,
    private readonly tickMs: number,
    private readonly minPerTick: number,
  ) {}

  static create(
    emitDelta: (chunk: string) => void,
    opts?: { tickMs?: number; minPerTick?: number },
  ): TextDeltaSmoother {
    const tickMs = Math.max(8, Math.min(22, opts?.tickMs ?? 10));
    const minPerTick = Math.max(1, Math.min(3, opts?.minPerTick ?? 1));
    return new TextDeltaSmoother(emitDelta, tickMs, minPerTick);
  }

  push(rawDelta: string) {
    if (!rawDelta) return;
    this.buf += rawDelta;
    this.ensureTimer();
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), this.tickMs);
  }

  private stopTimer() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private pump() {
    if (this.buf.length === 0) {
      this.stopTimer();
      return;
    }
    const len = this.buf.length;
    // 小口高频：单次 chunk 尽量小，靠 tick 连发堆丝滑感，避免「一大口」顿一下
    const adaptive =
      len > 520 ? 6 : len > 220 ? 4 : len > 80 ? 3 : len > 28 ? 2 : this.minPerTick;
    const take = Math.min(len, adaptive);
    const chunk = this.buf.slice(0, take);
    this.buf = this.buf.slice(take);
    this.emitDelta(chunk);
  }

  /** 在与 tool / message_end 等事件之前调用：停表并把积压正文一次性发出 */
  flushSync() {
    this.stopTimer();
    if (!this.buf) return;
    const rest = this.buf;
    this.buf = '';
    this.emitDelta(rest);
  }

  dispose() {
    this.flushSync();
  }
}
