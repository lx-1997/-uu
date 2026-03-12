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

export function fetchAIReply(
  messages: Array<{ role: string; content: string }>,
  deviceName?: string,
  deviceIp?: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, deviceName, deviceIp }),
    signal: controller.signal,
  })
    .then(async (r) => {
      clearTimeout(timer);
      if (!r.ok) throw new Error('API error');
      const data = (await r.json()) as { reply: string };
      return data.reply;
    })
    .catch(() => {
      clearTimeout(timer);
      return null;
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