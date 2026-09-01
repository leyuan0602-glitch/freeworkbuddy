// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { useAppCapabilities as useAppCapabilitiesType } from '../useAppCapabilities';

/**
 * 工作流 E:renderer capability hook 的桥接行为——首帧 sendSync 值、
 * 推送更新、桥缺失时 fail closed。
 * hook 模块含跨渲染的缓存(useSyncExternalStore 单例),用例间 resetModules 隔离。
 */

async function loadHook() {
  vi.resetModules();
  const mod = await import('../useAppCapabilities');
  return mod.useAppCapabilities;
}
type HookType = typeof useAppCapabilitiesType;

type Listener = (capabilities: Record<string, boolean>) => void;

function installBridge(initial: Record<string, boolean> | null) {
  const listeners = new Set<Listener>();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    appCapabilities: initial,
    onAppCapabilitiesChanged: (cb: Listener) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    push: (caps: Record<string, boolean>) => {
      for (const l of listeners) l(caps);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('useAppCapabilities', () => {
  it('首帧取 sendSync 快照,推送后更新', async () => {
    const useAppCapabilities = (await loadHook()) as HookType;
    const bridge = installBridge({ canUseAccount: true, canUseDeviceLink: false });
    const { result } = renderHook(() => useAppCapabilities());
    expect(result.current.canUseAccount).toBe(true);
    expect(result.current.canUseDeviceLink).toBe(false);

    act(() => {
      bridge.push({ canUseAccount: false, canUseDeviceLink: true });
    });
    expect(result.current.canUseAccount).toBe(false);
    expect(result.current.canUseDeviceLink).toBe(true);
  });

  it('桥缺失时 fail closed:全部能力 false', async () => {
    const useAppCapabilities = (await loadHook()) as HookType;
    const { result } = renderHook(() => useAppCapabilities());
    for (const value of Object.values(result.current)) {
      expect(value).toBe(false);
    }
  });
});
