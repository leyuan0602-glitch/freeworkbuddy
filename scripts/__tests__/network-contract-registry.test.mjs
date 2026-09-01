// network-contract-registry.test.mjs — 网络契约扫描器与 registry 门禁的单元测试。
//
// 覆盖 scripts/shared/network-scan.mjs 的提取/归一化语义与
// scripts/check-network-contract-registry.mjs 的校验规则(通过 --json 输出做
// 端到端断言)。不 mock 文件系统:直接对临时目录构造 fixture。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  extractApiPaths,
  extractStringLiterals,
  extractUrlHosts,
  listScanFiles,
  pathMatchesTemplate,
} from '../shared/network-scan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ---------- extractStringLiterals:词法状态机 ----------

test('字面量提取:字符串/模板/注释/正则', () => {
  const src = [
    "// const a = '/api/comment-noise';",
    "/* const b = '/api/block-noise'; */",
    "const c = '/api/real';",
    'const d = `/api/tpl/${id}/sub`;',
    "const e = 'escaped \\' quote';",
    "const re = /api\\/regex-like['\"]/; const f = '/api/after-regex';",
    "const g = `nested ${`inner ${x}`} end`;",
  ].join('\n');
  const literals = extractStringLiterals(src).map((l) => l.value);
  assert.ok(literals.includes('/api/real'));
  assert.ok(literals.includes('/api/tpl/:param/sub'));
  assert.ok(literals.includes('/api/after-regex'));
  assert.ok(!literals.some((v) => v.includes('comment-noise')));
  assert.ok(!literals.some((v) => v.includes('block-noise')));
  // 嵌套模板的插值整体归一
  assert.ok(literals.some((v) => v === 'nested :param end'));
});

test('字面量提取:行号与转义', () => {
  const src = "const a = 'x';\nconst b = 'y\\'z';\n";
  const literals = extractStringLiterals(src);
  assert.deepEqual(literals.map((l) => l.line), [1, 2]);
  assert.equal(literals[1].value, "y'z");
});

// ---------- extractApiPaths:归一化 ----------

test('api path 归一化:query 截断/插值段/尾部拼接', () => {
  const paths = extractApiPaths([
    '/api/plugins?:param',                                    // `${qs}` 型
    '/api/skills-hub/skills/:param/files:param',              // `${qs}` 紧贴段尾
    '/api/device-link/devices/:param',                        // 末段插值保留
    '/api/auth/:param/request-code',                          // 中段插值
    '/api/x/:param/refine?provider=:param',                   // 中段 + query
    '@/api/client',                                           // import 别名,排除
    './api/gatewayHttp.js',                                   // 相对 import,排除
    'v1/api/x',                                               // 版本前缀,排除
    ':param/api/after-base',                                  // `${base}/api/...`,放行
    '/api/oss/presign-put',                                   // 普通路径
  ]);
  assert.ok(paths.has('/api/plugins'));
  assert.ok(paths.has('/api/skills-hub/skills/:param/files'));
  assert.ok(paths.has('/api/device-link/devices/:param'));
  assert.ok(paths.has('/api/auth/:param/request-code'));
  assert.ok(paths.has('/api/x/:param/refine'));
  assert.ok(paths.has('/api/after-base'));
  assert.ok(paths.has('/api/oss/presign-put'));
  assert.ok(!paths.has('/api/client'));
  assert.ok(!paths.has('/api/x'));
  assert.ok(!paths.has('/api/gatewayHttp.js'));
});

// ---------- pathMatchesTemplate ----------

test('模板匹配:参数段互配、段数必须一致', () => {
  assert.ok(pathMatchesTemplate('/api/auth/:param/refresh', '/api/auth/:channel/refresh'));
  assert.ok(pathMatchesTemplate('/api/plugins', '/api/plugins'));
  assert.ok(!pathMatchesTemplate('/api/plugins', '/api/plugins/:id'));
  assert.ok(!pathMatchesTemplate('/api/plugins/:id', '/api/plugins'));
  assert.ok(pathMatchesTemplate('/api/a/b/c', '/api/a/:x/c')); // :param 段匹配任意单段
  assert.ok(!pathMatchesTemplate('/api/a/b/c/d', '/api/a/:x/c')); // 段数不一致
});

// ---------- extractUrlHosts ----------

test('host 提取:大小写归一、占位符过滤', () => {
  const hosts = extractUrlHosts([
    'see https://Example.COM/path and wss://Hook.Cindy.App/ws',
    '// localhost 无点不入册:',
    'const bad = "https://placeholder";',
    'dots..ignored = "https://a..b.com";',
  ].join('\n'));
  assert.ok(hosts.has('example.com'));
  assert.ok(hosts.has('hook.cindy.app'));
  assert.ok(!hosts.has('placeholder'));
  assert.ok(!hosts.has('a..b.com'));
});

// ---------- listScanFiles:排除规则 ----------

test('扫描文件收集:扩展名与目录排除 + glob 排除', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nscan-'));
  try {
    fs.writeFileSync(path.join(tmp, 'a.ts'), '');
    fs.writeFileSync(path.join(tmp, 'b.test.ts'), '');
    fs.writeFileSync(path.join(tmp, 'c.md'), '');
    fs.mkdirSync(path.join(tmp, '__tests__'));
    fs.writeFileSync(path.join(tmp, '__tests__', 'd.ts'), '');
    fs.mkdirSync(path.join(tmp, 'vendor-pkg'));
    fs.writeFileSync(path.join(tmp, 'vendor-pkg', 'e.js'), '');
    const files = listScanFiles(tmp, ['.'], ['vendor-pkg']).map((f) => path.basename(f));
    assert.deepEqual(files, ['a.ts']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- 端到端:当前仓库 registry 通过 ----------

test('当前仓库 registry 校验通过(双向覆盖无缺口)', () => {
  const out = JSON.parse(execFileSync('node', [
    path.join(ROOT, 'scripts/check-network-contract-registry.mjs'), '--json',
  ], { encoding: 'utf8' }));
  assert.equal(out.ok, true, JSON.stringify(out.errors ?? [], null, 2));
  assert.ok(out.routes >= 100);
  assert.ok(out.scannedPaths >= 50);
});

// ---------- 失败路径:临时目录注入未登记调用 ----------

test('门禁能抓住新增未登记 /api/ 调用与 registry 腐化', () => {
  // 用最小 registry + 临时源码验证失败路径,不动仓库真实文件。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nreg-'));
  try {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/check-network-contract-registry.mjs'), 'utf8')
      .replace("'docs/contracts/network-contract-registry.json'", "'registry.json'")
      .replace("const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
        'const REPO_ROOT = process.env.FAKE_REPO_ROOT;');
    fs.writeFileSync(path.join(tmp, 'check.mjs'), script.replace("'./shared/network-scan.mjs'",
      JSON.stringify(path.join(ROOT, 'scripts/shared/network-scan.mjs'))));

    const registry = {
      version: 1,
      confidenceScale: { A: 'a', B: 'b', C: 'c' },
      registryCoverage: { scanRoots: ['src'] },
      websocketChannels: [],
      routes: [
        {
          id: 'x.known', owner: 'auth', capability: 'canUseAccount', transport: 'http',
          method: 'GET', path: '/api/known', callsites: ['src/a.ts'], auth: 'none',
          requestSchema: null, responseSchema: null, errorCodes: [], timeoutMs: null,
          retry: 'n', idempotency: 'read-only', sideEffects: 'none',
          confidence: 'A', protocolVersion: null, tests: [],
        },
      ],
    };
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'registry.json'), JSON.stringify(registry));
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('/api/known');");
    const env = { ...process.env, FAKE_REPO_ROOT: tmp };

    // 1) 登记了但源码没有 → 不报(known 存在);新增 unknown → 报
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('/api/known'); fetch('/api/unknown');");
    let out;
    try {
      execFileSync('node', [path.join(tmp, 'check.mjs'), '--json'], { encoding: 'utf8', env, cwd: tmp });
      assert.fail('should fail');
    } catch (e) {
      out = JSON.parse(e.stdout);
    }
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((x) => x.includes('/api/unknown')), out.errors.join('\n'));

    // 2) 源码删掉 known,registry 未同步 → 腐化报错
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('/api/unknown2');");
    try {
      execFileSync('node', [path.join(tmp, 'check.mjs'), '--json'], { encoding: 'utf8', env, cwd: tmp });
      assert.fail('should fail');
    } catch (e) {
      out = JSON.parse(e.stdout);
    }
    assert.ok(out.errors.some((x) => x.includes('/api/known') && x.includes('腐化')), out.errors.join('\n'));

    // 3) 幂等通过
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('/api/known');");
    out = JSON.parse(execFileSync('node', [path.join(tmp, 'check.mjs'), '--json'], { encoding: 'utf8', env, cwd: tmp }));
    assert.equal(out.ok, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
