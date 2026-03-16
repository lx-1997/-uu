#!/usr/bin/env node

const baseUrl = process.env.RDK_API_BASE_URL || 'http://127.0.0.1:8787';
const targetDeviceId = process.env.RDK_DEVICE_ID || '';
const devicePassword = process.env.RDK_DEVICE_PASSWORD || '';

const checks = [];

function pushCheck(name, ok, detail, mode = 'api') {
  checks.push({ name, ok, detail, mode });
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

function summarize() {
  const grouped = checks.reduce((acc, c) => {
    acc[c.mode] = acc[c.mode] || [];
    acc[c.mode].push(c);
    return acc;
  }, {});

  for (const mode of Object.keys(grouped)) {
    console.log(`\n[${mode.toUpperCase()}]`);
    for (const item of grouped[mode]) {
      console.log(`${item.ok ? '✅' : '❌'} ${item.name} - ${item.detail}`);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nSummary: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

async function staticChecks() {
  const fs = await import('node:fs/promises');
  const orchestratorPath = new URL('../src/ai/orchestrator.ts', import.meta.url);
  const text = await fs.readFile(orchestratorPath, 'utf-8');

  const suspiciousMetricRe = /\b\d{2,}(?:[.,]\d+)?\s*(?:%|°C|FPS|GB|MB|次|Hz)\b/g;
  const hits = text.match(suspiciousMetricRe) || [];
  pushCheck('AI 编排硬编码指标扫描', hits.length === 0, hits.length ? `发现 ${hits.length} 处可疑硬编码: ${hits.slice(0, 5).join(', ')}` : '未发现可疑硬编码指标', 'static');
}

async function routeChecks() {
  const routeCases = [
    { name: '健康检查', method: 'GET', path: '/api/health', expect: (s) => s === 200 },
    { name: '设备列表', method: 'GET', path: '/api/devices', expect: (s) => s === 200 },
    { name: '诊断路由存在', method: 'GET', path: '/api/devices/non-exists/diagnostics', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: 'ROS 路由存在', method: 'GET', path: '/api/devices/non-exists/ros/topics', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: 'Node-RED 路由存在', method: 'GET', path: '/api/devices/non-exists/services/node-red', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: 'VNC 路由存在', method: 'GET', path: '/api/devices/non-exists/services/vnc', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: '文件列表路由存在', method: 'GET', path: '/api/devices/non-exists/files/list?path=/', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: '文件读取路由存在', method: 'GET', path: '/api/devices/non-exists/files/read?path=/etc/hosts', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: '文件下载路由存在', method: 'GET', path: '/api/devices/non-exists/files/download?path=/etc/hosts', expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: '模型部署路由存在', method: 'POST', path: '/api/devices/non-exists/models/deploy', body: { command: 'echo test' }, expect: (s) => s === 404 || s === 400 || s === 500 },
    { name: '示例运行路由存在', method: 'POST', path: '/api/devices/non-exists/examples/run', body: { command: 'echo test' }, expect: (s) => s === 404 || s === 400 || s === 500 },
  ];

  for (const c of routeCases) {
    try {
      const res = await request(c.path, {
        method: c.method,
        headers: c.body ? { 'content-type': 'application/json' } : undefined,
        body: c.body ? JSON.stringify(c.body) : undefined,
      });
      pushCheck(c.name, c.expect(res.status), `HTTP ${res.status}`);
    } catch (error) {
      pushCheck(c.name, false, error instanceof Error ? error.message : String(error));
    }
  }
}

async function realDeviceChecks() {
  try {
    const devicesRes = await request('/api/devices');
    const devices = Array.isArray(devicesRes.body?.devices) ? devicesRes.body.devices : [];

    if (!devices.length) {
      pushCheck('实机联调', false, '未发现已配置设备（请先在 UI 添加设备）', 'device');
      return;
    }

    const device = targetDeviceId ? devices.find((d) => d.id === targetDeviceId) : devices[0];
    if (!device) {
      pushCheck('实机联调', false, `未找到设备 ${targetDeviceId}`, 'device');
      return;
    }

    const headers = {
      'content-type': 'application/json',
      ...(devicePassword ? { 'x-device-password': devicePassword } : {}),
    };

    const deviceChecks = [
      { name: '设备诊断', method: 'GET', path: `/api/devices/${device.id}/diagnostics` },
      { name: 'ROS 话题', method: 'GET', path: `/api/devices/${device.id}/ros/topics` },
      { name: 'Node-RED 状态', method: 'GET', path: `/api/devices/${device.id}/services/node-red` },
      { name: 'VNC 状态', method: 'GET', path: `/api/devices/${device.id}/services/vnc` },
      { name: '文件列表', method: 'GET', path: `/api/devices/${device.id}/files/list?path=/` },
      { name: '文件读取', method: 'GET', path: `/api/devices/${device.id}/files/read?path=/etc/hosts` },
      { name: 'OpenClaw 状态命令', method: 'POST', path: '/api/openclaw/agent-action', body: { action: 'status', host: device.host, username: device.username } },
    ];

    for (const c of deviceChecks) {
      const options = {
        method: c.method,
        headers: c.method === 'POST' ? headers : (devicePassword ? { 'x-device-password': devicePassword } : undefined),
        body: c.body ? JSON.stringify(c.body) : undefined,
      };

      try {
        const res = await request(c.path, options);
        const passed = res.status >= 200 && res.status < 300;
        const detail = passed ? '通过' : `HTTP ${res.status} ${(res.body && res.body.error) ? `- ${res.body.error}` : ''}`;
        pushCheck(c.name, passed, detail, 'device');
      } catch (error) {
        pushCheck(c.name, false, error instanceof Error ? error.message : String(error), 'device');
      }
    }
  } catch (error) {
    pushCheck('实机联调初始化', false, error instanceof Error ? error.message : String(error), 'device');
  }
}

(async () => {
  console.log(`Verifying modules against: ${baseUrl}`);
  await staticChecks();
  await routeChecks();
  await realDeviceChecks();
  summarize();
})();
