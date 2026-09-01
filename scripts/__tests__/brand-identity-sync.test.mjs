// brand-identity-sync.test.mjs — 品牌标识符「TS 单点 ↔ .mjs 脚本镜像字面量」一致性断言。
//
// 背景:packages/maker-shared/src/brandIdentity.ts 是标识符层身份的单一事实源,
// 但 smoke / restart 等 .mjs 脚本无法 import TS,只能在各自文件顶部
// 镜像字面量(均带注释指回单点)。本测试用正则读 TS 源码抽出字面量,与各脚本的
// 镜像常量逐一比对——单点翻转后漏改任何一处镜像,这里立刻红灯。
//
// 刻意用「读源码 + 正则」而不 import 被测脚本:避免脚本模块顶层副作用
// (ali-oss / env 加载等),node --test 环境零依赖即可跑。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** 从源码里抽取形如 `<key>: '<value>'` 或 `const <key> = '<value>'` 的单引号字面量。 */
function extractLiteral(source, regex, label) {
  const match = regex.exec(source);
  assert.ok(match, `pattern not found: ${label} (${regex})`);
  return match[1];
}

const brandIdentitySource = readSource('packages/maker-shared/src/brandIdentity.ts');
const EXECUTABLE_NAME = extractLiteral(
  brandIdentitySource,
  /executableName:\s*'([^']+)'/,
  'brandIdentity.ts executableName',
);
const USER_DATA_DIR_NAME = extractLiteral(
  brandIdentitySource,
  /userDataDirName:\s*'([^']+)'/,
  'brandIdentity.ts userDataDirName',
);
/**
 * 从源码里抽取形如 `<mapName>: Object.freeze({ cn: '...', ... })` 的区域映射。
 * 锚定到 `Object.freeze({` 赋值处:字段名可能还出现在 interface 声明里。
 */
function extractRegionMap(source, mapName, label) {
  // 名字与 Object.freeze 之间允许类型注解(如 `: Readonly<Record<...>> =`)。
  const blockRe = new RegExp(`${mapName}\\s*[:=][^=]*?Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`);
  const block = blockRe.exec(source);
  assert.ok(block, `pattern not found: ${label} (${blockRe})`);
  const map = {};
  for (const [, key, , value] of block[1].matchAll(
    /(cn|global|dev):\s*(['"])([^'"]+)\2/g,
  )) {
    map[key] = value;
  }
  assert.deepEqual(Object.keys(map).sort(), ['cn', 'dev', 'global'], `${label} 缺区域键`);
  return map;
}

test('ci/lib.mjs PACKAGED_APP_NAME_BY_REGION mirrors brandIdentity.executableNameByRegion', () => {
  const expected = extractRegionMap(
    brandIdentitySource,
    'executableNameByRegion',
    'brandIdentity.ts executableNameByRegion',
  );
  const libSource = readSource('apps/desktop/scripts/ci/lib.mjs');
  const actual = extractRegionMap(
    libSource,
    'PACKAGED_APP_NAME_BY_REGION',
    'ci/lib.mjs PACKAGED_APP_NAME_BY_REGION',
  );
  assert.deepEqual(actual, expected);
});

test('smoke-packaged.mjs PACKAGED_APP_NAME mirrors brandIdentity.executableName', () => {
  const smokeSource = readSource('apps/desktop/scripts/smoke-packaged.mjs');
  const value = extractLiteral(
    smokeSource,
    /const PACKAGED_APP_NAME = '([^']+)';/,
    'smoke-packaged.mjs PACKAGED_APP_NAME',
  );
  assert.equal(value, EXECUTABLE_NAME);
});

test('restart-desktop-remote.mjs BRAND_USER_DATA_DIR_NAME mirrors brandIdentity.userDataDirName', () => {
  const restartSource = readSource('scripts/restart-desktop-remote.mjs');
  const value = extractLiteral(
    restartSource,
    /export const BRAND_USER_DATA_DIR_NAME = '([^']+)';/,
    'restart-desktop-remote.mjs BRAND_USER_DATA_DIR_NAME',
  );
  assert.equal(value, USER_DATA_DIR_NAME);
});

test('desktop dev userData region map mirrors brandIdentity.userDataDirNameByRegion', () => {
  const expected = extractRegionMap(
    brandIdentitySource,
    'userDataDirNameByRegion',
    'brandIdentity.ts userDataDirNameByRegion',
  );
  const regionSource = readSource('scripts/shared/desktop-dev-region.mjs');
  const actual = extractRegionMap(
    regionSource,
    'DESKTOP_USER_DATA_DIR_NAME_BY_REGION',
    'desktop-dev-region.mjs DESKTOP_USER_DATA_DIR_NAME_BY_REGION',
  );
  assert.deepEqual(actual, expected);
});

test('desktop package.json productName mirrors brandIdentity.userDataDirName', () => {
  // Electron userData 目录名默认派生自 productName;brandIdentity.userDataDirName
  // 的注释也声明二者同源——两边漂移会让主进程 <userData>-dev 沙箱与 restart 脚本
  // 的 XDT_USER_DATA_DIR 落在不同目录。
  const pkg = JSON.parse(readSource('apps/desktop/package.json'));
  assert.equal(pkg.productName, USER_DATA_DIR_NAME);
});

// ---- FreeWorkBuddy self-hosting 工作流 B(蓝图 §3.3):distributionProfile 镜像锁 ----
// distributionProfile.ts 官方 profile 派生自 brandIdentity.ts,但法律链接与
// endpoint 信任根在各自消费单点有独立字面量,此处锁定两处镜像不漂移。

test('distributionProfile OFFICIAL_LEGAL_LINKS_BY_REGION mirrors desktop legalLinks.ts', () => {
  // 镜像合同:distributionProfile.ts 的官方法律链接必须包含 legalLinks.ts 的
  // 全部 URL 字面量;dev 归 cn 系的区域归属由 distributionProfile 的 vitest
  // 快照测试锁定(这边只锁 URL 集合,避免解析嵌套结构)。
  const profileSource = readSource('packages/maker-shared/src/distributionProfile.ts');
  const legalSource = readSource('apps/desktop/src/shared/legalLinks.ts');
  const legalUrls = [...legalSource.matchAll(/'(https:\/\/protocol\.xd\.(?:cn|com)\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(legalUrls.length >= 4, 'legalLinks.ts 字面量抽取异常');
  for (const url of legalUrls) {
    assert.ok(
      profileSource.includes(url),
      `legalLinks.ts 的链接未镜像进 distributionProfile.ts: ${url}`,
    );
  }
});

test('distributionProfile OFFICIAL_TRUSTED_ENDPOINT_DOMAINS mirrors endpointManifestCache REGION_ENDPOINT_DOMAIN', () => {
  const profileSource = readSource('packages/maker-shared/src/distributionProfile.ts');
  const block = /OFFICIAL_TRUSTED_ENDPOINT_DOMAINS[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(profileSource);
  assert.ok(block, 'OFFICIAL_TRUSTED_ENDPOINT_DOMAINS 字面量未找到');
  const profileDomains = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const cacheSource = readSource('apps/desktop/src/main/endpointManifestCache.ts');
  const cacheBlock = /export const REGION_ENDPOINT_DOMAIN[^{]*\{([\s\S]*?)\}/.exec(cacheSource);
  assert.ok(cacheBlock, 'endpointManifestCache REGION_ENDPOINT_DOMAIN 字面量未找到');
  // 只取域名形状的字符串(类型注解里的 'cn'/'global' 键名要排除)。
  const cacheDomains = [...new Set([...cacheBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((v) => v.includes('.')))];
  assert.ok(cacheDomains.length >= 2, 'REGION_ENDPOINT_DOMAIN 域名抽取异常');
  assert.deepEqual(
    [...profileDomains].sort(),
    [...cacheDomains].sort(),
    '官方 endpoint 信任根漂移:两处必须同改',
  );
});

test('distribution profile 构建期 env 名在 forge 与 vite 两处一致', () => {
  // FreeWorkBuddy self-hosting 工作流 B:构建期 profile 选取入口必须同源,
  // 否则打包身份(bundle id / exe)与运行时烘烐身份(AUMID / deep link / userData)
  // 会从两个 env 各自解读 → 身份撕裂。
  const forgeSource = readSource('apps/desktop/forge.config.ts');
  const viteSource = readSource('apps/desktop/vite.main.config.ts');
  const runtimeSource = readSource('apps/desktop/src/shared/brandRegion.ts');
  const mainEntrySource = readSource('apps/desktop/src/main/index.ts');
  for (const env of ['VITE_CINDY_DISTRIBUTION_ID', 'VITE_CINDY_DISTRIBUTION_IDENTITY']) {
    assert.ok(viteSource.includes(env), `vite.main.config 缺少发行身份 define: ${env}`);
    assert.ok(runtimeSource.includes(env), `brandRegion.ts 未消费发行身份 define: ${env}`);
    assert.ok(forgeSource.includes(`process.env.${env}`), `forge.config 未回写发行身份 env: ${env}`);
  }
  // 构建期 profile 选取 env:forge 是唯一 resolve 入口(单一事实源),vite 只透传。
  assert.ok(forgeSource.includes('CINDY_DISTRIBUTION_PROFILE'), 'forge.config 未消费构建期 profile env');
  assert.ok(
    forgeSource.includes('resolveDistributionProfile'),
    'forge.config 必须经 resolveDistributionProfile 选取 profile(单一事实源)',
  );
  // userData 切换点消费注入 identity(独立发行数据分库的运行时半边)。
  assert.ok(
    mainEntrySource.includes('CURRENT_BRAND_IDENTITY'),
    'main 入口未把发行 identity 传入 regionUserData(独立发行 userData 分库失效)',
  );
});

test('mobile distribution-profile.cjs 镜像与 maker-shared 单点逐字段一致', () => {
  // app.config.js 在 Expo config 求值链(CJS)里无法 import maker-shared TS,
  // 按「CJS 镜像 + 镜像测试锁定」模式同步。单点翻转漏改镜像 → 立即红灯。
  const mobileMirror = readSource('apps/mobile/scripts/lib/distribution-profile.cjs');
  const profileSource = readSource('packages/maker-shared/src/distributionProfile.ts');
  const pick = (source, name) => {
    const block = new RegExp(`${name}[^\\[\\{]*[\\[\\{]([\\s\\S]*?)[\\]\\}]`).exec(source);
    assert.ok(block, `${name} 字面量未找到`);
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((v) => v.includes('.'));
  };
  // Mobile 身份字段:ios/android bundle 与 scheme 必须与 maker-shared 的
  // SELFHOST_FREEWORKBUDDY_PROFILE.brand 完全一致。
  const mobileIds = pick(mobileMirror, 'SELFHOST_FREEWORKBUDDY_MOBILE');
  for (const id of ['me.freeworkbuddy.ios', 'me.freeworkbuddy.android']) {
    assert.ok(mobileIds.includes(id), `mobile 镜像缺少 ${id}`);
    assert.ok(profileSource.includes(id), `maker-shared 单点缺少 ${id}(镜像测试两侧都要在)`);
  }
  assert.ok(
    mobileMirror.includes("scheme: 'freeworkbuddy'") && profileSource.includes("urlSchemes: Object.freeze(['freeworkbuddy'])"),
    '独立发行 scheme 两侧不一致',
  );
  // 官方 distributionId 集合同步。
  for (const id of ['cindy-cn', 'cindy-global', 'cindy-dev']) {
    assert.ok(mobileMirror.includes(`'${id}'`), `mobile 镜像缺官方 id ${id}`);
    assert.ok(profileSource.includes(`'${id}'`), `maker-shared 单点缺官方 id ${id}`);
  }
});
