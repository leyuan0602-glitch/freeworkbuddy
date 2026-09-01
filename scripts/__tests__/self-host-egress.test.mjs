// self-host-egress.test.mjs — 外部域名台账门禁的单元测试。
//
// 覆盖 scripts/check-self-host-egress.mjs 的核心判定(通过 --json 与临时
// fixture 端到端)与 inventory 匹配语义(精确/allowSubdomains/officialStrict)。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function buildCheck(tmp) {
  // 复用真实脚本,把 INVENTORY_PATH 与 REPO_ROOT 重定向到临时目录。
  const script = fs.readFileSync(path.join(ROOT, 'scripts/check-self-host-egress.mjs'), 'utf8')
    .replace("'docs/contracts/external-domain-inventory.json'", "'inventory.json'")
    .replace("const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
      'const REPO_ROOT = process.env.FAKE_REPO_ROOT;');
  fs.writeFileSync(path.join(tmp, 'check.mjs'), script.replace("'./shared/network-scan.mjs'",
    JSON.stringify(path.join(ROOT, 'scripts/shared/network-scan.mjs'))));
}

function runCheck(tmp) {
  const env = { ...process.env, FAKE_REPO_ROOT: tmp };
  return JSON.parse(execFileSync('node', [path.join(tmp, 'check.mjs'), '--json'], {
    encoding: 'utf8', env, cwd: tmp,
  }));
}

const BASE_ENTRY = {
  host: 'example.com',
  category: 'test-stub',
  disposition: 'test-stub',
};

function writeInventory(tmp, domains) {
  fs.writeFileSync(path.join(tmp, 'inventory.json'), JSON.stringify({
    version: 1,
    scanRoots: ['src'],
    domains,
  }));
}

test('未登记域名失败;allowSubdomains 覆盖子域', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-'));
  try {
    buildCheck(tmp);
    fs.mkdirSync(path.join(tmp, 'src'));
    // 场景 1:新域名未登记
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('https://unknown.example.net/x');");
    writeInventory(tmp, [{ ...BASE_ENTRY, allowSubdomains: true }]);
    let out;
    try {
      out = runCheck(tmp);
      assert.fail('should fail');
    } catch (e) {
      out = JSON.parse(e.stdout);
    }
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((x) => x.includes('unknown.example.net')), out.errors.join('\n'));

    // 场景 2:子域被 allowSubdomains 条目覆盖
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('https://api.example.com/x');");
    out = runCheck(tmp);
    assert.equal(out.ok, true, JSON.stringify(out.errors ?? [], null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('official-cindy 母域不吸收子域(allowSubdomains: false)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-'));
  try {
    buildCheck(tmp);
    fs.mkdirSync(path.join(tmp, 'src'));
    writeInventory(tmp, [
      { host: 'official.example', category: 'official-cindy', disposition: 'official-runtime', allowSubdomains: false },
    ]);
    // 精确母域 OK
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('https://official.example/x');");
    let out = runCheck(tmp);
    assert.equal(out.ok, true, JSON.stringify(out.errors ?? [], null, 2));
    // 新子域必须逐个登记
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('https://new.official.example/x');");
    try {
      out = runCheck(tmp);
      assert.fail('should fail');
    } catch (e) {
      out = JSON.parse(e.stdout);
    }
    assert.ok(out.errors.some((x) => x.includes('new.official.example')), out.errors.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('台账腐化:条目在扫描中消失即失败;manualEntry 豁免', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-'));
  try {
    buildCheck(tmp);
    fs.mkdirSync(path.join(tmp, 'src'));
    writeInventory(tmp, [
      { host: 'gone.example', category: 'doc-reference', disposition: 'doc-only' },
      { host: 'kept.example', category: 'doc-reference', disposition: 'doc-only', manualEntry: true },
    ]);
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "// nothing here");
    let out;
    try {
      out = runCheck(tmp);
      assert.fail('should fail');
    } catch (e) {
      out = JSON.parse(e.stdout);
    }
    assert.ok(out.errors.some((x) => x.includes('gone.example')), out.errors.join('\n'));
    assert.ok(!out.errors.some((x) => x.includes('kept.example')), out.errors.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('needs-triage 条目直接失败(强制分类)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-'));
  try {
    buildCheck(tmp);
    fs.mkdirSync(path.join(tmp, 'src'));
    writeInventory(tmp, [
      { host: 'tbd.example', category: 'unclassified', disposition: 'needs-triage' },
    ]);
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "fetch('https://tbd.example/');");
    let out;
    try {
      out = runCheck(tmp);
      assert.fail('should fail');
    } catch (e) {
      out = JSON.parse(e.stdout);
    }
    assert.ok(out.errors.some((x) => x.includes('needs-triage')), out.errors.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('当前仓库 inventory 校验通过', () => {
  const out = JSON.parse(execFileSync('node', [
    path.join(ROOT, 'scripts/check-self-host-egress.mjs'), '--json',
  ], { encoding: 'utf8' }));
  assert.equal(out.ok, true, JSON.stringify(out.errors ?? [], null, 2));
  assert.ok(out.domains >= 200);
});
