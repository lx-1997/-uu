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

export class NotificationHub {
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  publish(notification: RDKClawNotification) {
    this.io.emit("rdkclaw:notify", notification);
  }
}

