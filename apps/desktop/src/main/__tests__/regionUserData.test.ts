import { describe, expect, it } from 'vitest';
import { resolveRegionUserDataDirName } from '../regionUserData';
import { BRAND_IDENTITY, type BrandIdentity } from '@cindy/maker-shared/brand-identity';

/**
 * 同机双装的核心不变量:保持已发布的 cn=Cindy、global=CindyGlobal 映射，数据库 /
 * 登录态 / 单实例锁 / sessionData 随 userData 目录天然隔离。此模块跑在 main 入口
 * 最早期，回归 = 两个区域的包共库串台(P0)，所以把所有象限全部锁死。
 */
describe('resolveRegionUserDataDirName', () => {
  const ARGV = ['Cindy.exe'] as const;

  it('packaged + global → 覆写为 CindyGlobal(与 cn 分库)', () => {
    expect(
      resolveRegionUserDataDirName({ isPackaged: true, region: 'global', argv: ARGV }),
    ).toBe('CindyGlobal');
  });

  it('packaged + cn → null(区域目录名 = productName 默认,保持原生行为)', () => {
    expect(
      resolveRegionUserDataDirName({ isPackaged: true, region: 'cn', argv: ARGV }),
    ).toBeNull();
  });

  it('dev(非 packaged)按区域选择正式 profile，隔离沙箱再基于它派生', () => {
    expect(
      resolveRegionUserDataDirName({ isPackaged: false, region: 'cn', argv: ARGV }),
    ).toBeNull();
    expect(
      resolveRegionUserDataDirName({ isPackaged: false, region: 'global', argv: ARGV }),
    ).toBe('CindyGlobal');
    expect(
      resolveRegionUserDataDirName({ isPackaged: false, region: 'dev', argv: ARGV }),
    ).toBe('CindyDev');
  });

  it('显式 Chromium --user-data-dir 时不覆写,尊重调用方', () => {
    expect(
      resolveRegionUserDataDirName({
        isPackaged: true,
        region: 'global',
        argv: ['Cindy.exe', '--smoke-test', '--user-data-dir=C:\\tmp\\xdt-smoke-x'],
      }),
    ).toBeNull();
    expect(
      resolveRegionUserDataDirName({
        isPackaged: true,
        region: 'global',
        argv: ['Cindy.exe', '--user-data-dir', 'C:\\tmp\\xdt-smoke-x'],
      }),
    ).toBeNull();
  });

  it('XDT_USER_DATA_DIR 仍保留区域默认 profile 作为隔离 epoch 基线', () => {
    expect(
      resolveRegionUserDataDirName({
        isPackaged: false,
        region: 'global',
        argv: ARGV,
        envUserDataDir: '/tmp/custom-profile',
      }),
    ).toBe('CindyGlobal');
  });

  // ---- 独立发行(工作流 B):与官方数据分库(蓝图 §3.3 验收)----
  const SELFHOST_IDENTITY: BrandIdentity = {
    ...BRAND_IDENTITY,
    displayName: 'FreeWorkBuddy',
    primaryScheme: 'freeworkbuddy',
    legacySchemes: [],
    appIdByRegion: { cn: 'me.freeworkbuddy.desktop', global: 'me.freeworkbuddy.desktop', dev: 'me.freeworkbuddy.desktop' },
    userDataDirName: 'FreeWorkBuddy',
    userDataDirNameByRegion: { cn: 'FreeWorkBuddy', global: 'FreeWorkBuddy', dev: 'FreeWorkBuddy' },
    legacyUserDataDirNames: [],
    legacyUserDataDirNamesByRegion: { cn: [], global: [], dev: [] },
    legacyDialogueUserDataDirNamesByRegion: { cn: [], global: [], dev: [] },
    dbFilePrefix: 'freeworkbuddy-selfhost',
    legacyDbFilePrefixes: [],
    updaterName: 'freeworkbuddy-selfhost-updater',
    cdnPrefix: 'freeworkbuddy-selfhost',
    executableName: 'FreeWorkBuddy',
    executableNameByRegion: { cn: 'FreeWorkBuddy', global: 'FreeWorkBuddy', dev: 'FreeWorkBuddy' },
  };

  it('独立发行:任意 region 都无条件覆写到 profile 的 userData 目录', () => {
    for (const region of ['cn', 'global', 'dev'] as const) {
      expect(
        resolveRegionUserDataDirName({
          isPackaged: true,
          region,
          argv: ARGV,
          identity: SELFHOST_IDENTITY,
        }),
      ).toBe('FreeWorkBuddy');
    }
    // 与官方 userData 目录名不同,绝不落到 Cindy / CindyGlobal / CindyDev。
    expect(resolveRegionUserDataDirName({ isPackaged: true, region: 'global', argv: ARGV, identity: SELFHOST_IDENTITY }))
      .not.toBe('CindyGlobal');
  });

  it('独立发行:显式 --user-data-dir 仍尊重调用方', () => {
    expect(
      resolveRegionUserDataDirName({
        isPackaged: true,
        region: 'global',
        argv: ['FreeWorkBuddy.app', '--user-data-dir=/tmp/fwb'],
        identity: SELFHOST_IDENTITY,
      }),
    ).toBeNull();
  });

  it('identity 缺省 = 官方行为不变(向后兼容)', () => {
    expect(
      resolveRegionUserDataDirName({ isPackaged: true, region: 'cn', argv: ARGV }),
    ).toBeNull();
  });
});
