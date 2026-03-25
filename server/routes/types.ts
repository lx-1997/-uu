import type { Express } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { OpenClawDeploymentManager } from '../managers/OpenClawDeploymentManager.js';
import type { RDKClawApp } from '../rdkclaw/app.js';

export interface RouteDeps {
  app: Express;
  io: SocketIOServer;
  openClawManager: OpenClawDeploymentManager;
  rdkclaw: RDKClawApp;
  resolvePassword: (req: import('express').Request, device: { password?: string }) => { password: string };
  sendApiError: (
    res: import('express').Response,
    status: number,
    code: string,
    message: string,
    opts?: { retryable?: boolean },
  ) => void;
}
