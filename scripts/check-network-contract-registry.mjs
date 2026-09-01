#!/usr/bin/env node
/**
 * 网络契约 registry 门禁(FreeWorkBuddy self-hosting 工作流 A,蓝图 §3.2)。
 *
 * 校验 docs/contracts/network-contract-registry.json:
 *   1. JSON 可解析、顶层与每条 route/websocketChannel 的字段完整、枚举合法;
 *   2. callsites / tests 引用的文件真实存在(防 registry 腐化);
 *   3. 【双向覆盖】生产源码字符串字面量中的 '/api/...' 路径(模板插值归一为
 *      ':param',query 截断)必须匹配 registry 中某条 template route;
 *      反向:registry 中每条 template route 必须能被至少一个扫描字面量匹配——
 *      删代码不改 registry、或登记虚构 route,同样失败。
 *   4. sourceLiteral 型 route(非 /api/ 前缀,如 /heartbeat、/latest)要求该
 *      字面量出现在扫描字面量原文中。
 *
 * CI 接线:.github/workflows/ci.yml(pnpm check:network-contract)。
 * 用法:node scripts/check-network-contract-registry.mjs [--json](--json 输出
 * 机器可读结果,供测试复用)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractApiPaths,
  extractStringLiterals,
  listScanFiles,
  pathMatchesTemplate,
} from './shared/network-scan.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = 'docs/contracts/network-contract-registry.json';

const OWNERS = new Set([
  'auth', 'device-link', 'model-access', 'billing', 'voice', 'oss', 'oauth-broker',
  'feedback', 'heartbeat', 'skillhub', 'plugin-market', 'plugin-publisher',
  'hooks', 'desktop-update', 'mobile-update', 'log-upload', 'telemetry',
]);
const METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS',
]);
const CONFIDENCES = new Set(['A', 'B', 'C']);
const TRANSPORTS = new Set(['http', 'websocket', 'http-redirect', 'object-storage']);
const PATH_VALIDATIONS = new Set(['template', 'source-literal', 'none']);

function err(errors, msg) {
  errors.push(msg);
}

function validateRoute(route, errors, index) {
  const label = `routes[${index}]${route?.id ? `(${route.id})` : ''}`;
  for (const field of ['id', 'owner', 'capability', 'transport', 'method', 'path', 'auth', 'confidence']) {
    if (typeof route[field] !== 'string' || route[field].length === 0) {
      err(errors, `${label} 缺少必填字段 ${field}`);
    }
  }
  if (!Array.isArray(route.callsites) || route.callsites.length === 0) {
    err(errors, `${label} 缺少 callsites(至少一个调用点)`);
  }
  if (route.id && !/^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/.test(route.id)) {
    err(errors, `${label} id 必须是点分层级标识(如 auth.token),实际: ${route.id}`);
  }
  if (route.owner && !OWNERS.has(route.owner)) {
    err(errors, `${label} owner 非法: ${route.owner}(允许: ${[...OWNERS].join(', ')})`);
  }
  if (route.transport && !TRANSPORTS.has(route.transport)) {
    err(errors, `${label} transport 非法: ${route.transport}`);
  }
  if (route.method && !METHODS.has(route.method)) {
    err(errors, `${label} method 非法: ${route.method}`);
  }
  if (route.confidence && !CONFIDENCES.has(route.confidence)) {
    err(errors, `${label} confidence 非法: ${route.confidence}(允许 A/B/C)`);
  }
  const pv = route.pathValidation ?? 'template';
  if (!PATH_VALIDATIONS.has(pv)) {
    err(errors, `${label} pathValidation 非法: ${pv}`);
  }
  if (pv === 'template' && typeof route.path === 'string' && !route.path.startsWith('/')) {
    err(errors, `${label} template 型 path 必须以 / 开头: ${route.path}`);
  }
  if (pv === 'source-literal' && (typeof route.sourceLiteral !== 'string' || route.sourceLiteral.length === 0)) {
    err(errors, `${label} source-literal 型必须提供 sourceLiteral`);
  }
  if (route.confidence === 'C' && !route.notes) {
    err(errors, `${label} C 级条目必须用 notes 说明推断依据(蓝图置信度合同)`);
  }
}

function main() {
  const errors = [];
  const registryAbs = path.join(REPO_ROOT, REGISTRY_PATH);
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryAbs, 'utf8'));
  } catch (e) {
    console.error(`✗ ${REGISTRY_PATH} 无法解析: ${e.message}`);
    process.exit(1);
  }

  if (registry.version !== 1) err(errors, `registry.version 必须是 1,实际: ${registry.version}`);
  if (!Array.isArray(registry.routes)) err(errors, 'registry.routes 必须是数组');
  if (!Array.isArray(registry.websocketChannels)) err(errors, 'registry.websocketChannels 必须是数组');
  if (!registry.confidenceScale?.A || !registry.confidenceScale?.B || !registry.confidenceScale?.C) {
    err(errors, 'registry.confidenceScale 必须定义 A/B/C 三级语义');
  }

  const ids = new Set();
  for (const [i, route] of (registry.routes ?? []).entries()) {
    validateRoute(route, errors, i);
    if (route.id) {
      if (ids.has(route.id)) err(errors, `route id 重复: ${route.id}`);
      ids.add(route.id);
    }
  }
  for (const [i, ws] of (registry.websocketChannels ?? []).entries()) {
    for (const field of ['id', 'owner', 'capability', 'url']) {
      if (typeof ws[field] !== 'string' || ws[field].length === 0) {
        err(errors, `websocketChannels[${i}] 缺少必填字段 ${field}`);
      }
    }
    if (ws.owner && !OWNERS.has(ws.owner)) {
      err(errors, `websocketChannels[${i}] owner 非法: ${ws.owner}`);
    }
  }

  // —— callsites / tests 文件存在性 ——
  for (const route of registry.routes ?? []) {
    for (const cs of route.callsites ?? []) {
      const file = cs.split('#')[0];
      if (!fs.existsSync(path.join(REPO_ROOT, file))) {
        err(errors, `route ${route.id}: callsite 文件不存在: ${file}`);
      }
    }
    for (const t of route.tests ?? []) {
      if (!fs.existsSync(path.join(REPO_ROOT, t))) {
        err(errors, `route ${route.id}: 测试文件不存在: ${t}`);
      }
    }
  }

  // —— 双向覆盖:扫描源码 ——
  const scanRoots = registry.registryCoverage?.scanRoots ?? [];
  if (scanRoots.length === 0) err(errors, 'registry.registryCoverage.scanRoots 必须非空');
  const scanExcludes = (registry.registryCoverage?.scanExcludes ?? []).map((x) => (typeof x === 'string' ? x : x?.pattern)).filter(Boolean);
  const files = listScanFiles(REPO_ROOT, scanRoots, scanExcludes);
  if (files.length === 0) {
    err(errors, '扫描范围为空,检查 registryCoverage.scanRoots');
  }

  /** @type {Map<string, {path: string, file: string, line: number}>} 归一化 path -> 首个出处 */
  const scannedPaths = new Map();
  /** @type {string[]} 所有字面量原文(sourceLiteral 校验用) */
  const rawLiterals = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const literals = extractStringLiterals(content);
    const rel = path.relative(REPO_ROOT, file);
    for (const lit of literals) rawLiterals.push(lit.value);
    for (const p of extractApiPaths(literals.map((l) => l.value))) {
      if (!scannedPaths.has(p)) {
        const src = literals.find((l) => l.value.includes(p));
        scannedPaths.set(p, { path: p, file: rel, line: src?.line ?? 0 });
      }
    }
  }

  // 反向:每个扫描 path 必须匹配某条 template route,或命中豁免登记。
  // pathExemptions: 精确匹配(如 logLabel 字面量);pathPrefixExemptions: 前缀
  // 匹配(第三方直连 API 的固定路径,如 Anthropic OAuth)。
  const pathExemptions = new Set(
    (registry.registryCoverage?.pathExemptions ?? []).map((x) => (typeof x === 'string' ? x : x?.path)).filter(Boolean),
  );
  const pathPrefixExemptions = registry.registryCoverage?.pathPrefixExemptions ?? [];
  const templateRoutes = (registry.routes ?? []).filter(
    (r) => (r.pathValidation ?? 'template') === 'template',
  );
  const templatePaths = [...new Set(templateRoutes.map((r) => r.path))];
  for (const [p, origin] of scannedPaths) {
    if (pathExemptions.has(p)) continue;
    if (pathPrefixExemptions.some((x) => p === x.path || p.startsWith(`${x.path}/`))) continue;
    const matched = templatePaths.some((t) => pathMatchesTemplate(p, t));
    if (!matched) {
      err(errors,
        `源码路径未登记 registry: ${p}(出处 ${origin.file}:${origin.line})。`
        + ' 若是新增生产网络调用,请在 docs/contracts/network-contract-registry.json 登记;'
        + ' 若是本地进程间 HTTP(非远端 egress),在 registry.registryCoverage.pathExemptions 登记并注明理由。');
    }
  }

  // 正向:每条 template route 必须被至少一个扫描 path 匹配
  for (const t of templatePaths) {
    const matched = [...scannedPaths.keys()].some((p) => pathMatchesTemplate(p, t));
    if (!matched) {
      err(errors, `registry route 无对应源码调用(path 腐化或代码已删除): ${t}`);
    }
  }

  // source-literal 校验
  for (const route of registry.routes ?? []) {
    if ((route.pathValidation ?? 'template') !== 'source-literal') continue;
    const lit = route.sourceLiteral ?? '';
    const found = rawLiterals.some((v) => v.includes(lit));
    if (!found) {
      err(errors, `registry route ${route.id} 的 sourceLiteral 在源码字面量中未找到: ${lit}`);
    }
  }

  const jsonOut = process.argv.includes('--json');
  if (errors.length > 0) {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: false, errors }, null, 2));
    } else {
      console.error(`✗ network-contract-registry 校验失败(${errors.length}):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
    process.exit(1);
  }
  if (jsonOut) {
    console.log(JSON.stringify({
      ok: true,
      routes: registry.routes.length,
      websocketChannels: registry.websocketChannels.length,
      scannedFiles: files.length,
      scannedPaths: scannedPaths.size,
    }, null, 2));
  } else {
    console.log(
      `✓ network-contract-registry OK: ${registry.routes.length} routes / `
      + `${registry.websocketChannels.length} ws channels / `
      + `${files.length} scanned files / ${scannedPaths.size} scanned api paths`,
    );
  }
}

main();
