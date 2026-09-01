/**
 * 网络契约扫描共享工具(零依赖,仅 node 内置模块)。
 *
 * 服务于 FreeWorkBuddy self-hosting 工作流 A(蓝图 §3.2)的两道 CI 门禁:
 *   - scripts/check-network-contract-registry.mjs:生产源码 /api/ 路径字面量 ↔
 *     docs/contracts/network-contract-registry.json 双向覆盖校验;
 *   - scripts/check-self-host-egress.mjs:生产源码外部域名 ↔
 *     docs/contracts/external-domain-inventory.json 台账校验。
 *
 * 两道门禁采用不同的提取策略,刻意不一致:
 *   - /api/ 路径用「字符串字面量提取」(状态机剥离注释):注释里的示例路径
 *     不算调用,登记它们只会制造噪音;
 *   - 域名用「全文正则」(含注释):宁可多登记也不漏掉一个真实 egress 面,
 *     注释里的官方/第三方域名同样是 self-host 改造时的移除清单。
 *
 * 字符串字面量提取器是一个小型词法状态机:处理单引号 / 双引号 / 模板字符串
 * (含 ${...} 插值与转义)、行注释、块注释,以及正则字面量(避免 /['"]/ 这类
 * 带引号的正则体把状态机带偏)。模板插值统一替换为 ':param' 占位符。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 视为代码文本的扩展名;JSON 配置(如 config/endpoint*.json)也参与扫描。 */
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json',
]);

/** 目录/文件名排除规则(与 registry 的 registryCoverage.scanExcludes 对齐)。 */
const EXCLUDED_DIR_NAMES = new Set([
  '__tests__', 'fixtures', 'dist', 'node_modules', 'build', 'out',
  '.git', '.cindy-worktrees', '.xdt-worktrees',
]);
const EXCLUDED_FILE_PATTERNS = [
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.generated\.[cm]?[jt]sx?$/,
];

/**
 * 递归收集扫描文件。roots 是相对 repoRoot 的目录或文件路径。
 * extraExcludes 是可选的 glob 排除项(相对 repoRoot,支持 '**' 跨段与 '*' 单段内匹配),
 * 用于 registry registryCoverage.scanExcludes 声明的范围排除。
 * 返回绝对路径数组,排序保证输出稳定。
 */
export function listScanFiles(repoRoot, roots, extraExcludes = []) {
  const excludeMatchers = extraExcludes.map((pattern) => globToMatcher(pattern));
  const isExcluded = (relPath) =>
    excludeMatchers.some((m) => m(relPath));
  const files = [];
  const walk = (absPath) => {
    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch {
      return; // root 声明了不存在的路径(可选 root),跳过
    }
    const rel = path.relative(repoRoot, absPath);
    if (stat.isFile()) {
      if (isExcluded(rel)) return;
      const base = path.basename(absPath);
      if (!CODE_EXTENSIONS.has(path.extname(absPath))) return;
      if (EXCLUDED_FILE_PATTERNS.some((re) => re.test(base))) return;
      files.push(absPath);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(absPath)) {
      if (EXCLUDED_DIR_NAMES.has(entry)) continue;
      walk(path.join(absPath, entry));
    }
  };
  for (const root of roots) walk(path.resolve(repoRoot, root));
  return files.sort();
}

/** 把 glob 模式(支持 '**' 跨段与 '*' 单段内匹配)转成相对路径段匹配器。 */
function globToMatcher(pattern) {
  const segments = pattern.split('/');
  const matchFrom = (relSegments, i) => {
    if (i === segments.length) return true; // pattern 段耗尽即命中(目录/前缀语义)
    const seg = segments[i];
    if (seg === '**') {
      // '**' 可匹配零个或多个段;非尾部的 '**' 至少吃掉一段避免歧义回溯
      for (let take = 0; take <= relSegments.length; take += 1) {
        if (matchFrom(relSegments.slice(take), i + 1)) return true;
      }
      return false;
    }
    if (relSegments.length === 0) return false;
    const re = new RegExp(
      `^${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]*')}$`,
    );
    return re.test(relSegments[0]) && matchFrom(relSegments.slice(1), i + 1);
  };
  return (relPath) => matchFrom(relPath.split(path.sep), 0);
}

/**
 * 从源码文本提取字符串字面量内容。
 * 返回数组,每项 { value, line }。模板插值已替换为 ':param';
 * 正则字面量与注释被跳过。
 */
export function extractStringLiterals(content) {
  const literals = [];
  let line = 1;
  let i = 0;
  const n = content.length;

  // 前一个非空白字符,用于区分「除法」与「正则字面量」起点
  let prevSignificant = '';
  const startsRegex = () =>
    prevSignificant === '' ||
    '=(,[{(!&|?:;+-*%~^<>'.includes(prevSignificant) ||
    (prevSignificant === '/' ); // 上一 token 是除号或正则结束的情况,保守按正则处理
  let inTemplateBraceDepth = 0; // 模板插值 ${ } 的嵌套深度(相对当前模板)

  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : '';
    if (ch === '\n') { line += 1; i += 1; continue; }

    // —— 注释 ——
    if (ch === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    // —— 正则字面量(跳过,防止 /['"]/ 破坏字符串状态)——
    if (ch === '/' && startsRegex()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = content[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break; // 跨行不可能是正则,按普通 '/' 回退
        if (inClass) { if (c === ']') inClass = false; }
        else if (c === '[') inClass = true;
        else if (c === '/') { closed = true; break; }
        j += 1;
      }
      if (closed) {
        // 跳过 flags
        let k = j + 1;
        while (k < n && /[a-z]/.test(content[k])) k += 1;
        prevSignificant = ')';
        i = k;
        continue;
      }
      // 未闭合:按普通除号处理
      prevSignificant = '/';
      i += 1;
      continue;
    }
    // —— 字符串 ——
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < n) {
        const c = content[j];
        if (c === '\\') { value += content[j + 1] ?? ''; j += 2; continue; }
        if (c === quote) break;
        if (c === '\n') break; // 未闭合,放弃该字面量
        value += c;
        j += 1;
      }
      literals.push({ value, line });
      prevSignificant = quote;
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      // 模板字符串:收集内容并把 ${...} 插值替换为 ':param'
      let j = i + 1;
      let value = '';
      let depth = 0;
      while (j < n) {
        const c = content[j];
        if (c === '\\') { value += content[j + 1] ?? ''; j += 2; continue; }
        if (c === '`') break;
        if (c === '$' && content[j + 1] === '{') {
          value += ':param';
          depth = 1;
          j += 2;
          while (j < n && depth > 0) {
            const d = content[j];
            if (d === '\\') { j += 2; continue; }
            if (d === '{') depth += 1;
            else if (d === '}') depth -= 1;
            else if (d === '\n') line += 1;
            else if (d === '`') {
              // 插值里嵌套模板(罕见):粗略跳到对应反引号
              j += 1;
              while (j < n && content[j] !== '`') { if (content[j] === '\\') j += 1; j += 1; }
            }
            j += 1;
          }
          continue;
        }
        if (c === '\n') line += 1;
        value += c;
        j += 1;
      }
      literals.push({ value, line });
      prevSignificant = '`';
      i = j + 1;
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i += 1;
  }
  void inTemplateBraceDepth;
  return literals;
}

/**
 * 从字面量内容提取以 /api/ 开头(或 registry 声明的其他绝对路径)的路径,
 * 归一化:query('?' 起)截断、去尾斜杠、连续斜杠压平。
 * 返回 Set<string>,如 '/api/auth/:param/request-code'。
 */
export function extractApiPaths(literalValues) {
  const found = new Set();
  for (const value of literalValues) {
    // 只匹配看起来是路径起始的位置:上一字符不能是 import 别名/相对路径/@别名
    // ('@/api/client'、'./api/gatewayHttp.js'、'v1/api' 都不是网络路径);
    // 但 `${base}/api/...` 归一化后的 ':param' 前缀要放行。
    const re = /(?:(?<=:param)|(?<![A-Za-z0-9_.@]))\/api\/[A-Za-z0-9/_:.$@-]*/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      let p = m[0];
      const q = p.indexOf('?');
      if (q >= 0) p = p.slice(0, q);
      p = p.replace(/\/{2,}/g, '/');
      // 尾部紧贴段尾的 ':param'(前字符非 '/',即 `${qs}`/`?v=${x}` 型 query 或
      // 扩展名拼接)截断;'/x/:param' 型末段插值保留。中间的 ':param/...' 不受影响。
      p = p.replace(/(?<=[^/]):param$/, '');
      while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      if (p.length > '/api/'.length - 1) found.add(p);
    }
  }
  return found;
}

/** 全文提取外部 URL host(含注释,保守策略)。返回 Set<host 小写>。 */
export function extractUrlHosts(rawContent) {
  const found = new Set();
  const re = /(?:https?|wss?):\/\/([a-zA-Z0-9.-]+)/gi;
  let m;
  while ((m = re.exec(rawContent)) !== null) {
    let host = m[1].toLowerCase().replace(/\.$/, '');
    if (!host || !host.includes('.')) continue; // 无点(localhost、占位)不登记
    if (host.includes('..')) continue;
    if (!/^[a-z0-9.-]+$/.test(host)) continue;
    found.add(host);
  }
  return found;
}

/**
 * 扫描出的归一化路径与 registry path 模板是否匹配。
 * 逐段比较:相等,或任一侧是 ':name' 参数段。
 */
export function pathMatchesTemplate(scannedPath, templatePath) {
  const a = scannedPath.split('/');
  const b = templatePath.split('/');
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i].startsWith(':') && a[i].length > 1) continue;
    if (b[i].startsWith(':') && b[i].length > 1) continue;
    return false;
  }
  return true;
}
