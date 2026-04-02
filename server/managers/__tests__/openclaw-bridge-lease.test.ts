import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenClawDeploymentManager } from '../OpenClawDeploymentManager.js';

describe('OpenClawDeploymentManager bridge lease', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('schedules destroyConnection after last release when idle delay elapses', async () => {
    vi.useFakeTimers();
    const mgr = new OpenClawDeploymentManager(path.join(process.cwd(), 'build-resources'));
    const destroySpy = vi.spyOn(mgr, 'destroyConnection').mockImplementation(() => {});

    mgr.acquireOpenClawBridgeLease('10.0.0.5');
    mgr.releaseOpenClawBridgeLease('10.0.0.5');
    expect(destroySpy).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledWith('10.0.0.5');
  });

  it('does not destroy while refcount > 1', async () => {
    vi.useFakeTimers();
    const mgr = new OpenClawDeploymentManager(path.join(process.cwd(), 'build-resources'));
    const destroySpy = vi.spyOn(mgr, 'destroyConnection').mockImplementation(() => {});

    mgr.acquireOpenClawBridgeLease('10.0.0.6');
    mgr.acquireOpenClawBridgeLease('10.0.0.6');
    mgr.releaseOpenClawBridgeLease('10.0.0.6');
    await vi.runOnlyPendingTimersAsync();
    expect(destroySpy).not.toHaveBeenCalled();
    mgr.releaseOpenClawBridgeLease('10.0.0.6');
    await vi.runOnlyPendingTimersAsync();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('acquire cancels pending idle teardown', async () => {
    vi.useFakeTimers();
    const mgr = new OpenClawDeploymentManager(path.join(process.cwd(), 'build-resources'));
    const destroySpy = vi.spyOn(mgr, 'destroyConnection').mockImplementation(() => {});

    mgr.acquireOpenClawBridgeLease('10.0.0.7');
    mgr.releaseOpenClawBridgeLease('10.0.0.7');
    mgr.acquireOpenClawBridgeLease('10.0.0.7');
    await vi.runOnlyPendingTimersAsync();
    expect(destroySpy).not.toHaveBeenCalled();
    mgr.releaseOpenClawBridgeLease('10.0.0.7');
    await vi.runOnlyPendingTimersAsync();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('double release on stale counter does not schedule teardown', async () => {
    vi.useFakeTimers();
    const mgr = new OpenClawDeploymentManager(path.join(process.cwd(), 'build-resources'));
    const destroySpy = vi.spyOn(mgr, 'destroyConnection').mockImplementation(() => {});

    mgr.releaseOpenClawBridgeLease('10.0.0.8');
    await vi.runOnlyPendingTimersAsync();
    expect(destroySpy).not.toHaveBeenCalled();
  });
});
