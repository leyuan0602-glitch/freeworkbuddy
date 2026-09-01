#!/usr/bin/env node

/**
 * no-egress-smoke.mjs — Self-host 发行包的 no-egress 运行时验收
 * (FreeWorkBuddy 蓝图 §3.4 工作流 C;§3.18 Phase 1 验收「官方请求为 0」)。
 *
 * 启动 packaged 产物(带 `--no-egress-audit`),让它跑完**完整启动链**
 * (endpoint 自举 / capability / 各服务首包 / renderer 稳定),settle 窗口结束后
 * main 把请求域审计写到 `<userData>/no-egress-requests.json` 并退出;本脚本读取
 * 报告并与 docs/contracts/external-domain-inventory.json 断言:
 *
 *   1. official-runtime 处置的域名(官方 Cindy 域,含其子域)请求数 = 0;
 *   2. 出现过的每个域名都能在 inventory 中找到登记(allowSubdomains 归属),
 *      意外新增 egress 面即失败。
 *
 * 与 smoke-packaged.mjs 的关系:同一「packaged exe + scratch userData +
 * 结构化退出」模式,但**不 short-circuit 启动链**(--smoke-test 跳过窗口/服务;
 * 本脚本要观察完整启动的真实网络面)。
 *
 * 用法:
 *   node scripts/no-egress-smoke.mjs --platform=darwin --arch=arm64 [--out-dir=...] \
 *     [--app-name=FreeWorkBuddy] [--settle-ms=8000]
 *
 * 定位:验收 self-host 发行包;官方构建跑本脚本会在第 1 条断言失败(它启动即
 * 请求官方 endpoint.json 自举)——这正是断言正确的证据。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..');
const AUDIT_REPORT_FILE = 'no-egress-requests.json';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return {
    platform: out.platform || process.platform,
    arch: out.arch || process.arch,
    outDir: out['out-dir'] || null,
    appName: out['app-name'] || 'FreeWorkBuddy',
    settleMs: Math.max(3000, Number(out['settle-ms'] || 8000)),
    inventoryPath: out.inventory
      ? path.resolve(out.inventory)
      : path.join(REPO_ROOT, 'docs', 'contracts', 'external-domain-inventory.json'),
    timeoutMs: Math.max(20000, Number(out['timeout-ms'] || 60000)),
  };
}

const options = parseArgs();
if (!['win32', 'darwin', 'linux'].includes(options.platform)) {
  console.error(`[no-egress] ERROR: unsupported --platform=${options.platform}`);
  process.exit(1);
}

// ── Locate packaged executable(与 smoke-packaged.mjs 同布局约定)──

function resolveExePath() {
  const outRoot = options.outDir || path.join(DESKTOP_ROOT, 'out');
  const base = path.join(outRoot, `${options.appName}-${options.platform}-${options.arch}`);
  if (options.platform === 'darwin') {
    return path.join(base, `${options.appName}.app`, 'Contents', 'MacOS', options.appName);
  }
  if (options.platform === 'win32') {
    return path.join(base, `${options.appName}.exe`);
  }
  return path.join(base, options.appName);
}

const exePath = resolveExePath();
if (!fs.existsSync(exePath)) {
  console.error(`[no-egress] FAIL: packaged executable not found at ${exePath}`);
  console.error('[no-egress]       先跑 forge package(带 CINDY_DISTRIBUTION_PROFILE=freeworkbuddy-selfhost)。');
  process.exit(1);
}
console.log(`[no-egress] executable: ${exePath}`);
console.log(`[no-egress] settle=${options.settleMs}ms timeout=${options.timeoutMs}ms`);

// ── inventory 官方域集合 ──

function loadInventory() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(options.inventoryPath, 'utf8'));
  } catch (err) {
    console.error(`[no-egress] FAIL: inventory 读取失败(${options.inventoryPath}): ${err.message}`);
    process.exit(1);
  }
  const officialExact = new Set();
  const officialParents = new Set(); // allowSubdomains=false 的官方母域:子域必须零请求,按父域匹配
  const registeredExact = new Set();
  const registeredParents = [];
  for (const entry of raw.domains ?? []) {
    if (entry.category === 'official-cindy' && entry.disposition === 'official-runtime') {
      if (entry.allowSubdomains === true) {
        officialExact.add(entry.host);
      } else {
        officialParents.add(entry.host);
      }
    }
    registeredExact.add(entry.host);
    if (entry.allowSubdomains === true) registeredParents.push(entry.host);
  }
  return { officialExact, officialParents, registeredExact, registeredParents };
}

function hostMatchesAny(host, exactSet, parents) {
  if (exactSet.has(host)) return true;
  return parents.some((parent) => host === parent || host.endsWith(`.${parent}`));
}

// ── Spawn & settle ──

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'fwb-no-egress-'));
console.log(`[no-egress] userData: ${tmpUserData}`);

const child = spawn(
  exePath,
  ['--no-egress-audit', `--user-data-dir=${tmpUserData}`],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, XDT_NO_EGRESS_AUDIT: '1', ELECTRON_DISABLE_SANDBOX: '1' },
  },
);

let stderrBuf = '';
child.stderr.on('data', (chunk) => {
  stderrBuf += chunk.toString();
});

const timeoutHandle = setTimeout(() => {
  console.error(`[no-egress] ERROR: timeout after ${options.timeoutMs}ms, killing process`);
  try { child.kill('SIGKILL'); } catch { /* noop */ }
}, options.timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timeoutHandle);
  console.log(`[no-egress] child exited: ${signal ? `signal=${signal}` : `code=${code}`}`);

  const reportPath = path.join(tmpUserData, AUDIT_REPORT_FILE);
  if (!fs.existsSync(reportPath)) {
    console.error('[no-egress] FAIL: audit report missing(main 未写出 no-egress-requests.json)');
    if (stderrBuf.trim()) console.error(stderrBuf.trim().split('\n').slice(-15).join('\n'));
    cleanup();
    process.exit(1);
  }

  /** @type {{ hosts: Record<string, number> }} */
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.error(`[no-egress] FAIL: report parse error: ${err.message}`);
    cleanup();
    process.exit(1);
  }

  const hosts = Object.keys(report.hosts ?? {});
  console.log(`[no-egress] observed ${hosts.length} distinct hosts:`);
  for (const host of hosts) {
    console.log(`[no-egress]   ${host} ×${report.hosts[host]}`);
  }

  const inventory = loadInventory();
  // 断言 1:官方域零请求
  const officialHits = hosts.filter((h) => hostMatchesAny(h, inventory.officialExact, [...inventory.officialParents]));
  if (officialHits.length > 0) {
    console.error(`[no-egress] FAIL: official egress detected: ${officialHits.join(', ')}`);
    cleanup();
    process.exit(1);
  }
  // 断言 2:所有域名已登记
  const unregistered = hosts.filter((h) => !hostMatchesAny(h, inventory.registeredExact, inventory.registeredParents));
  if (unregistered.length > 0) {
    console.error(`[no-egress] FAIL: unregistered egress hosts(先登记 docs/contracts/external-domain-inventory.json): ${unregistered.join(', ')}`);
    cleanup();
    process.exit(1);
  }

  console.log('✅ no-egress smoke passed: official requests = 0, all egress hosts registered');
  cleanup();
  process.exit(0);

  function cleanup() {
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

child.on('error', (err) => {
  clearTimeout(timeoutHandle);
  console.error(`[no-egress] FAIL: spawn error: ${err.message}`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(1);
});
