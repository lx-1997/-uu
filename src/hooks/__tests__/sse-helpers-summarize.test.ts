import { describe, it, expect } from 'vitest';
import { summarizeToolArgs } from '../sse-helpers.js';

describe('summarizeToolArgs', () => {
  it('shows full file content instead of <N chars> for device_file_write', () => {
    const script = '#!/bin/bash\necho hello\n';
    const s = summarizeToolArgs({
      path: '/userdata/start_yolo_world.sh',
      content: script,
    });
    expect(s).toContain('path: /userdata/start_yolo_world.sh');
    expect(s).toContain('content:');
    expect(s).toContain('#!/bin/bash');
    expect(s).toContain('echo hello');
    expect(s).not.toMatch(/content: <\d+ chars>/);
  });

  it('shows full strings for workspace write/edit (本机)', () => {
    const w = summarizeToolArgs({
      file_path: 'src/a.ts',
      content: 'export const x = 1;\n',
    });
    expect(w).toContain('file_path:');
    expect(w).toContain('export const x');
    const e = summarizeToolArgs({
      file_path: 'src/a.ts',
      old_string: 'foo',
      new_string: 'bar\nbaz',
    });
    expect(e).toContain('old_string:');
    expect(e).toContain('foo');
    expect(e).toContain('new_string:');
    expect(e).toContain('bar');
  });

  it('shows message / task / context for OpenClaw-style args', () => {
    const s = summarizeToolArgs({
      message: '请检查摄像头\n第二行',
      task: '部署检测',
      context: '板型 X5',
    });
    expect(s).toContain('请检查摄像头');
    expect(s).toContain('部署检测');
    expect(s).toContain('板型 X5');
  });

  it('pretty-prints object/array instead of [object]', () => {
    const s = summarizeToolArgs({
      targetDeviceIds: ['a', 'b'],
      nested: { x: 1 },
    });
    expect(s).not.toContain('[object]');
    expect(s).toContain('"a"');
    expect(s).toContain('"x"');
  });

  it('truncates extremely large content with a notice', () => {
    const huge = 'x'.repeat(50 * 1024);
    const s = summarizeToolArgs({ path: '/tmp/x', content: huge });
    expect(s).toContain('已截断');
    expect(s.length).toBeLessThan(huge.length);
  });
});
