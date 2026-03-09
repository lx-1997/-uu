import type { ChatMessage, Device, DevicePayload, OpenClawPayload } from './types';

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Request failed');
  }

  return (await response.json()) as T;
}

export function fetchDevices() {
  return request<{ devices: Device[] }>('/api/devices');
}

export function connectDevice(payload: DevicePayload) {
  return request<{ device: Device }>('/api/devices/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeDevice(deviceId: string) {
  return request<{ removedId: string }>(`/api/devices/${deviceId}`, {
    method: 'DELETE',
  });
}

export function sendChat(messages: ChatMessage[]) {
  return request<{ message: ChatMessage }>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
}

export function runOpenClaw(deviceId: string, payload: OpenClawPayload, password: string) {
  return request<{ output: string; device: Device }>(`/api/devices/${deviceId}/openclaw`, {
    method: 'POST',
    headers: {
      'x-device-password': password,
    },
    body: JSON.stringify(payload),
  });
}