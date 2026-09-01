#!/usr/bin/env node
/**
 * no-egress 域名台账门禁(FreeWorkBuddy self-hosting 工作流 A/C,蓝图 §3.2、§3.4)。
 *
 * 校验 docs/contracts/external-domain-inventory.json 与生产代码(含注释)的
 * 一致性:
 *   1. inventory 结构合法:每个域名条目必须有 category + disposition,类别与
 *      处置在允许枚举内;不允许 needs-triage 长期滞留;
 *   2. 【反向】扫描到的每个 host(https?/wss? 全文正则,含注释——保守策略)
 *      必须精确命中条目,或落在某条 allowSubdomains 条目之下;
 *   3. 【正向】inventory 中每个非手工条目必须在扫描中出现,防止台账腐化。
 *
 * official-cindy 母域条目 allowSubdomains: false:官方域名下新增子域必须逐个
 * 登记。Phase 1(工作流 C)清官方域名时,本文件是移除清单;Self-host 发行版
 * 的验收是 official-runtime 处置的域名运行时请求为 0(no-egress 运行时测试另建)。
 *
 * CI 接线:.github/workflows/ci.yml(pnpm check:self-host-egress)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractUrlHosts, listScanFiles } from './shared/network-scan.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = 'docs/contracts/external-domain-inventory.json';

const CATEGORIES = new Set([
  'official-cindy', 'model-provider', 'integration-provider', 'content-source',
  'diagram-service', 'doc-reference', 'cdn-asset', 'analytics', 'log-backend',
  'package-registry', 'test-stub', 'local-address', 'unclassified',
]);
const DISPOSITIONS = new Set([
  'official-runtime', 'user-configured-egress', 'feature-scoped-egress',
  'build-injected', 'doc-only', 'test-stub', 'local-only', 'needs-triage',
]);

function hostMatchesInventory(host, domains) {
  const exact = domains.find((d) => d.host === host);
  if (exact) return exact;
  // 子域:仅 allowSubdomains 条目参与;official-cindy 母域显式 false
  const wildcard = domains.find(
    (d) => d.allowSubdomains === true && host.endsWith(`.${d.host}`),
  );
  return wildcard ?? null;
}

function main() {
  const errors = [];
  const invAbs = path.join(REPO_ROOT, INVENTORY_PATH);
  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(invAbs, 'utf8'));
  } catch (e) {
    console.error(`✗ ${INVENTORY_PATH} 无法解析: ${e.message}`);
    process.exit(1);
  }

  if (inventory.version !== 1) err(errors, `inventory.version 必须是 1,实际: ${inventory.version}`);
  if (!Array.isArray(inventory.domains)) err(errors, 'inventory.domains 必须是数组');

  const seenHosts = new Set();
  for (const [i, d] of inventory.domains.entries()) {
    const label = `domains[${i}](${d?.host ?? '?'})`;
    if (typeof d.host !== 'string' || d.host.length === 0) {
      err(errors, `${label} 缺少 host`);
      continue;
    }
    if (seenHosts.has(d.host)) err(errors, `${label} host 重复: ${d.host}`);
    seenHosts.add(d.host);
    if (!CATEGORIES.has(d.category)) err(errors, `${label} category 非法: ${d.category}`);
    if (!DISPOSITIONS.has(d.disposition)) err(errors, `${label} disposition 非法: ${d.disposition}`);
    if (d.category === 'unclassified' || d.disposition === 'needs-triage') {
      err(errors, `${label} 仍处于 needs-triage,必须完成分类`);
    }
    if (d.officialParent && d.category !== 'official-cindy') {
      err(errors, `${label} 声明了 officialParent 但 category 不是 official-cindy`);
    }
  }

  const scanRoots = inventory.scanRoots ?? [];
  if (scanRoots.length === 0) err(errors, 'inventory.scanRoots 必须非空');
  const files = listScanFiles(REPO_ROOT, scanRoots);

  /** @type {Map<string, string>} host -> 首个出处文件 */
  const scannedHosts = new Map();
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, file);
    for (const host of extractUrlHosts(content)) {
      if (!scannedHosts.has(host)) scannedHosts.set(host, rel);
    }
  }

  // 反向:扫描到的 host 必须命中台账
  for (const [host, origin] of [...scannedHosts.entries()].sort()) {
    const entry = hostMatchesInventory(host, inventory.domains);
    if (!entry) {
      err(errors,
        `未登记外部域名: ${host}(出处 ${origin})。`
        + ' 请在 docs/contracts/external-domain-inventory.json 登记 category/disposition;'
        + ' 若属于官方 Cindy 域新子域,同时说明其服务用途(母域 allowSubdomains=false)。');
      continue;
    }
    // official-cindy 母域 allowSubdomains=false,精确命中才放行;子域必须逐个登记
    if (entry.allowSubdomains === false && entry.host !== host) {
      err(errors, `官方母域不吸收子域,必须逐个登记: ${host}(出处 ${origin})`);
    }
  }

  // 正向:台账条目必须仍能被扫描看到(手工条目除外)
  for (const d of inventory.domains) {
    if (d.manualEntry === true) continue;
    if (d.allowSubdomains === true && !scannedHosts.has(d.host)) {
      // 通配条目自身可以不直接出现,但至少要有一个子域被扫到
      const anyChild = [...scannedHosts.keys()].some((h) => h.endsWith(`.${d.host}`));
      if (!anyChild) {
        err(errors, `inventory 条目 ${d.host}(allowSubdomains)在扫描中无任何命中,疑似过期`);
      }
      continue;
    }
    if (!scannedHosts.has(d.host)) {
      err(errors, `inventory 条目 ${d.host} 在扫描中未出现(代码已移除请同步删条目;确属保留请标 manualEntry: true)`);
    }
  }

  const jsonOut = process.argv.includes('--json');
  if (errors.length > 0) {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, errors }, null, 2));
    } else {
      console.error(`✗ external-domain-inventory 校验失败(${errors.length}):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
    process.exit(1);
  }
  if (jsonOut) {
    console.log(JSON.stringify({
      ok: true,
      domains: inventory.domains.length,
      scannedFiles: files.length,
      scannedHosts: scannedHosts.size,
    }, null, 2));
  } else {
    console.log(
      `✓ external-domain-inventory OK: ${inventory.domains.length} domains / `
      + `${files.length} scanned files / ${scannedHosts.size} scanned hosts`,
    );
  }
}

function err(errors, msg) {
  errors.push(msg);
}

main();
