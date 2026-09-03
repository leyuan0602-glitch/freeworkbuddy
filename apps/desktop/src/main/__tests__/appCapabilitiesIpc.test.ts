import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'local' as 'local' | 'cloud',
  boundaryPending: false,
  ownerStable: true,
  capabilityDefaults: null as Record<string, boolean> | null,
  endpoints: {
    authApiBaseUrl: 'https://auth.example',
    deviceLinkApiBaseUrl: 'https://device.example',
    modelAccessApiBaseUrl: 'https://models.example',
    voiceApiBaseUrl: 'https://voice.example',
    oauthBrokerApiBaseUrl: 'https://oauth.example',
    telegramHookWsUrl: 'wss://telegram.example',
    xHookWsUrl: 'wss://x.example',
    slackHookWsUrl: 'wss://slack.example',
    ossApiBaseUrl: 'https://oss.example',
    githubApiBaseUrl: 'https://github.example',
    skillhubApiBaseUrl: 'https://skills.example',
    pluginApiBaseUrl: 'https://plugins.example',
    heartbeatUrl: 'https://heartbeat.example',
    cdnBaseUrl: 'https://cdn.example',
    websiteUrl: 'https://www.example',
  } as Record<string, string> | null,
  endpointsError: false,
}));

vi.mock('../appSessionState.js', () => ({
  getActiveAppSession: () => ({ mode: state.mode, dataOwnerId: 'owner-a', generation: 0 }),
  isAppSessionBoundaryPending: () => state.boundaryPending,
}));

vi.mock('../authBoundaryQuarantine.js', () => ({
  isGhostSkillProjectionBoundaryStableForOwner: () => state.ownerStable,
}));

vi.mock('../../shared/brandRegion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/brandRegion')>();
  return {
    ...actual,
    get CURRENT_DISTRIBUTION_CAPABILITY_DEFAULTS() {
      return state.capabilityDefaults;
    },
  };
});

vi.mock('../clientEndpointsService', () => ({
  getResolvedClientEndpoints: () => {
    if (state.endpointsError) throw new Error('not initialized');
    return state.endpoints;
  },
}));

import { requireAppCapability } from '../appCapabilities.js';

describe('requireAppCapability IPC errors', () => {
  beforeEach(() => {
    state.mode = 'local';
    state.boundaryPending = false;
    state.ownerStable = true;
    state.capabilityDefaults = null;
    state.endpointsError = false;
    if (state.endpoints) {
      state.endpoints.deviceLinkApiBaseUrl = 'https://device.example';
      state.endpoints.skillhubApiBaseUrl = 'https://skills.example';
    }
  });

  it('encodes unavailable account capabilities as permission errors', () => {
    expect(() => requireAppCapability('canUseSkillHubCloud')).toThrow(/\[PERMISSION_DENIED\]/);
  });

  it('encodes owner-boundary failures as retryable precondition errors', () => {
    state.mode = 'cloud';
    state.boundaryPending = true;
    expect(() => requireAppCapability('canUseDeviceLink')).toThrow(/\[PRECONDITION_FAILED\]/);
  });

  it('keeps normal cloud capabilities available when only the Ghost projection owner differs', () => {
    state.mode = 'cloud';
    state.ownerStable = false;
    expect(() => requireAppCapability('canUseCindyAccountServices')).not.toThrow();
    expect(() => requireAppCapability('canUseCindyGateway')).not.toThrow();
    expect(() => requireAppCapability('canUseDeviceLink')).not.toThrow();
    expect(() => requireAppCapability('canUseSkillHubCloud')).not.toThrow();
    expect(() => requireAppCapability('canUseCindyOAuthBroker')).not.toThrow();
    expect(() => requireAppCapability('canUseCindyHeartbeat')).not.toThrow();
  });

  it('rejects a cloud capability disabled by distribution policy', () => {
    state.mode = 'cloud';
    state.capabilityDefaults = { canUseDeviceLink: false };

    expect(() => requireAppCapability('canUseDeviceLink')).toThrow(/\[PERMISSION_DENIED\]/);
  });

  it('rejects a cloud capability whose required endpoint is absent', () => {
    state.mode = 'cloud';
    state.endpoints!.skillhubApiBaseUrl = '';

    expect(() => requireAppCapability('canUseSkillHubCloud')).toThrow(/\[PERMISSION_DENIED\]/);
  });

  it('fails closed while the endpoint manifest is unavailable', () => {
    state.mode = 'cloud';
    state.endpointsError = true;

    expect(() => requireAppCapability('canUseDeviceLink')).toThrow(/\[PERMISSION_DENIED\]/);
  });
});
