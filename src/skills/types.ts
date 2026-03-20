import type { Tab } from '../app-types';

export interface SkillAPI {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: string;
  response?: string;
  caution?: string;
}

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  metadata: {
    rdkstudio?: {
      category?: string;
      icon?: string;
      requires?: { device?: boolean; services?: string[] };
      tab?: Tab;
    };
  };
  body: string;
  apis: SkillAPI[];
  clientActions: string[];
  filePath?: string;
}

export interface SkillInvocation {
  skillName: string;
  action: string;
  params?: Record<string, unknown>;
}

export type ClientActionType =
  | { type: 'navigate'; tab: Tab }
  | { type: 'openSettings' }
  | { type: 'openVnc' }
  | { type: 'createTerminal' }
  | { type: 'startDiagnostic' }
  | { type: 'scanDevices' }
  | { type: 'runFlowValidation' }
  | { type: 'toast'; message: string; level: 'success' | 'error' | 'warning' | 'info' };
