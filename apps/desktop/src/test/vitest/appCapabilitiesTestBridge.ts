/**
 * 测试用发行 capability 桥 helper:给单测提供「官方发行默认」(全 true)的
 * capability 快照。
 *
 * 背景:useAppCapabilities 在 Electron 桥不可用时 fail closed(FALLBACK_CLOSED
 * 全 false)。单元测试宿主没有 preload 桥,任何直接调用 useAppCapabilities 的
 * 组件都会走 fallback,把 billing/usage/imbot/登录入口等 UI 全部隐藏,导致既有
 * 断言「入口存在」的用例批量失败。官方发行(capability 全开)下这些入口本来
 * 就可见,所以测试显式注入全 true 快照,让组件行为与官方构建一致。
 *
 * 用法:测试文件在 beforeEach 里构造 window.electronAPI 时,用
 * `withAppCapabilities({...})` 包一层,把 capability 桥字段合并进去:
 *
 *   Object.defineProperty(window, 'electronAPI', {
 *     configurable: true,
 *     value: withAppCapabilities({ platform: 'darwin', ... }),
 *   });
 *
 * 注意:不要把本文件注册为 vitest 全局 setupFiles——threads 池 worker 上
 * 全局 setupFiles 会触发确定性 SIGSEGV(2026-09 本机 Node 24 实测,原因
 * 未深究,改走 per-test 显式注入后稳定)。需要验证「能力关闭」语义的用例,
 * 显式提供 `appCapabilities` 对应投影即可(withAppCapabilities 的覆盖优先级
 * 高于默认全 true);注意 hook 的模块级 cachedSnapshot 只在首个 getSnapshot
 * 时读一次桥,如需动态切换要 vi.resetModules + 重新 import,或走
 * onAppCapabilitiesChanged 回调。
 */

export const FULL_OPEN_CAPABILITIES: Record<string, boolean> = Object.freeze({
  canUseAccount: true,
  canUseDeviceLink: true,
  canUseManagedModels: true,
  canUseManagedVoice: true,
  canUseOAuthBroker: true,
  canUseHostedTelegramHook: true,
  canUseHostedXHook: true,
  canUseHostedSlackHook: true,
  canUploadPublicAssets: true,
  canUseFeedback: true,
  canUseSkillHubCloud: true,
  canUsePluginMarket: true,
  canPublishPlugins: true,
  canSendHeartbeat: true,
  canCheckDesktopUpdates: true,
  canOpenWebsite: true,
  canSendTelemetry: true,
});

/**
 * 把「官方发行默认」的 capability 桥字段并进测试自建的 electronAPI 对象。
 * 测试自己提供的 appCapabilities / onAppCapabilitiesChanged 优先(便于按用例
 * 定制能力投影)。
 */
export function withAppCapabilities<T extends Record<string, unknown>>(
  api: T,
): T & { appCapabilities: Record<string, boolean>; onAppCapabilitiesChanged: () => () => void } {
  return {
    appCapabilities: { ...FULL_OPEN_CAPABILITIES },
    onAppCapabilitiesChanged: () => () => {},
    ...api,
  };
}
