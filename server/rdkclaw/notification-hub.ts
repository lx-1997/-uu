import type { Server as SocketIOServer } from "socket.io";

export interface RDKClawNotification {
  type:
    | "autonomy_start"
    | "autonomy_result"
    | "autonomy_error"
    | "channel_message_inbound"
    | "channel_message_ack"
    | "channel_message_outbound"
    | "channel_message_error";
  title: string;
  message: string;
  taskId?: string;
  level?: "info" | "success" | "warning" | "error";
  sessionId?: string;
  ts: number;
  payload?: Record<string, unknown>;
}

/**
 * Rate-limited notification broadcaster.
 *
 * Uses a sliding-window counter to prevent flooding all connected clients
 * when autonomy tasks fire rapidly. High-level events (error/success)
 * always pass through; only informational bursts are throttled.
 */
const RATE_WINDOW_MS = 5000;
const MAX_PER_WINDOW = 30;

export class NotificationHub {
  private io: SocketIOServer;
  private windowStart = 0;
  private windowCount = 0;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  publish(notification: RDKClawNotification) {
    const now = Date.now();
    if (now - this.windowStart > RATE_WINDOW_MS) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount++;

    const isHighPriority =
      notification.level === 'error' ||
      notification.level === 'success' ||
      notification.type === 'autonomy_error';

    if (!isHighPriority && this.windowCount > MAX_PER_WINDOW) {
      return;
    }

    this.io.emit("rdkclaw:notify", notification);
  }
}

