/**
 * noEgressAudit — no-egress 验收的运行时请求域审计(蓝图 §3.4 工作流 C)。
 *
 * 仅当显式请求时激活(packages 产物验收用,不影响正常发行):
 *   - argv 含 `--no-egress-audit`,或
 *   - env `XDT_NO_EGRESS_AUDIT=1`。
 *
 * 语义:挂 defaultSession 的 webRequest 记录**全部出站请求的域名 + 计数**
 * (不阻止、不改写——审计不是拦截;断网/拦截形态由 CI 的网络层负责),在
 * settle 窗口结束后把报告写到 `<userData>/no-egress-requests.json` 并退出。
 * 报告只含主机名与次数,不含 URL path / query(可能携带用户内容)。
 *
 * 消费方:apps/desktop/scripts/no-egress-smoke.mjs 读报告并与
 * docs/contracts/external-domain-inventory.json 的 official-runtime 域断言
 * 零交集(官方请求为 0)、且全部域均已登记(无意外 egress 面)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, session, type Session } from 'electron';
import { createLogger } from './logger';

const log = createLogger('no-egress-audit');

const AUDIT_FLAG_ARGV = '--no-egress-audit';
const AUDIT_FLAG_ENV = 'XDT_NO_EGRESS_AUDIT';
export const AUDIT_REPORT_FILE_NAME = 'no-egress-requests.json';
/** 默认 settle 窗口:完整启动链 + 各服务首包 + renderer 稳定期。 */
export const DEFAULT_SETTLE_MS = 8_000;

export function isNoEgressAuditRequested(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes(AUDIT_FLAG_ARGV) || env[AUDIT_FLAG_ENV] === '1';
}

interface HostCounts {
  [host: string]: number;
}

const hostCounts: HostCounts = {};
let installed = false;
let reportPath: string | null = null;

function recordUrl(url: string): void {
  try {
    const host = new URL(url).host;
    if (!host) return;
    hostCounts[host] = (hostCounts[host] ?? 0) + 1;
  } catch {
    // 非 http(s)/ws URL(about:、devtools:、file:、chrome-extension:)不计。
  }
}

/**
 * 挂全局请求审计。必须在一切可能发请求的初始化之前调用(ready 最前端)。
 * 重复调用是 no-op(启动流程单次调用;防未来多点调用重复计数)。
 */
export function installNoEgressAudit(targetSession: Session = session.defaultSession): void {
  if (installed) return;
  installed = true;
  targetSession.webRequest.onBeforeRequest((_details, callback) => {
    // 审计不干预:一律放行(采集层;网络层阻断由 CI 环境负责)。
    callback({});
  });
  targetSession.webRequest.onCompleted((details) => {
    recordUrl(details.url);
  });
  targetSession.webRequest.onErrorOccurred((details) => {
    // 失败的请求同样计入(断网下的官方域名尝试本身就是 no-egress 证据)。
    recordUrl(details.url);
  });
  log.info('no-egress audit installed (recording outbound hosts only)');
}

/**
 * settle 窗口结束后写报告并退出。独立于业务初始化位置:install 时即排程,
 * 保证无论启动链走到哪一步,验收进程都会收敛退出(不挂 CI)。
 */
export function scheduleNoEgressAuditQuit(settleMs = DEFAULT_SETTLE_MS): void {
  if (reportPath !== null) return; // 已排程
  const targetPath = path.join(app.getPath('userData'), AUDIT_REPORT_FILE_NAME);
  reportPath = targetPath;
  setTimeout(() => {
    try {
      const payload = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        settleMs,
        hosts: Object.fromEntries(
          Object.entries(hostCounts).sort(([a], [b]) => a.localeCompare(b)),
        ),
      };
      // 临时文件 + rename 原子落位(与 endpointManifestCache 同策略)。
      const tmp = `${targetPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, targetPath);
      log.info(`no-egress audit report written: ${targetPath} (${Object.keys(hostCounts).length} hosts)`);
    } catch (err) {
      log.error('failed to write no-egress audit report: %s', err instanceof Error ? err.message : String(err));
    } finally {
      // 验收进程用 exit 直接收敛:启动链的 graceful shutdown 会等 disposer,
      // 验收不依赖也不等待它(报告已同步落盘)。
      app.exit(0);
    }
  }, settleMs);
}
