import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import path from 'node:path';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

// ── mocks(全部在 import 被测模块前声明)──
const state = vi.hoisted(() => ({
  appDataDir: '',
  guardImpl: (() => {}) as (event: unknown) => void,
  targetDb: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.appDataDir },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler);
    },
  },
}));

vi.mock('../security/trustedAppRenderer.js', () => ({
  assertTrustedAppRendererEvent: (event: unknown) => state.guardImpl(event),
}));

vi.mock('../localDb/index.js', () => ({
  getCurrentDbPath: () => (state.targetDb ? path.join(state.appDataDir, 'target.db') : null),
  getRawDb: () => state.targetDb,
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { registerLegacyImportIpc, isAcceptableLegacyPath } from '../legacyImport/ipc';
import { LEGACY_IMPORT_DISCOVER_CHANNEL, LEGACY_IMPORT_EXECUTE_CHANNEL } from '../../shared/legacyImport';

const EVENT = {} as unknown as Parameters<(...args: unknown[]) => void>[0];

function seedLegacyDb(userId: string, rows: Array<{ id: string; title: string }>): string {
  const dir = path.join(state.appDataDir, 'Cindy');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `cindy-${userId}.db`);
  const db = new Database(file);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
  const insert = db.prepare('INSERT INTO sessions (id, title) VALUES (?, ?)');
  for (const row of rows) insert.run(row.id, row.title);
  db.close();
  return file;
}

beforeEach(() => {
  state.appDataDir = mkdtempSync(path.join(tmpdir(), 'xdt-legacy-ipc-'));
  state.guardImpl = () => {};
  // registerLegacyImportIpc 有模块级 registered 幂等标志:整个文件只注册一次,
  // handlers 跨用例共享(注册只收 handler,不依赖 appDataDir)。
  registerLegacyImportIpc();
});

afterEach(() => {
  state.targetDb?.close();
  state.targetDb = null;
  rmSync(state.appDataDir, { recursive: true, force: true });
});

function createTargetDb(): Database.Database {
  const db = new Database(path.join(state.appDataDir, 'target.db'));
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
  db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, client_id TEXT, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  return db;
}

describe('legacy-import IPC', () => {
  it('注册两个 channel', () => {
    expect(state.handlers.has(LEGACY_IMPORT_DISCOVER_CHANNEL)).toBe(true);
    expect(state.handlers.has(LEGACY_IMPORT_EXECUTE_CHANNEL)).toBe(true);
  });

  it('discover 返回候选目录与发现结果', () => {
    seedLegacyDb('alice', [{ id: 's-1', title: '任务一' }]);
    const result = state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT) as {
      appDataDir: string;
      databases: Array<{ userId: string }>;
    };
    expect(result.appDataDir).toBe(state.appDataDir);
    expect(result.databases.map((d) => d.userId)).toEqual(['alice']);
  });

  it('sender 闸拒绝时 handler 直接抛错(discover)', () => {
    state.guardImpl = () => {
      throw new Error('[PERMISSION_DENIED] denied');
    };
    expect(() => state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT)).toThrow('PERMISSION_DENIED');
  });

  it('execute:来自 discover 的路径导入成功', () => {
    const file = seedLegacyDb('bob', [{ id: 's-1', title: '任务一' }]);
    state.targetDb = createTargetDb();
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT);
    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, {
      filePaths: [file],
    }) as { results: Array<{ ok: boolean; sessions: { rowsInserted: number } }> };
    expect(result.results).toHaveLength(1);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].sessions.rowsInserted).toBe(1);
    expect((state.targetDb as Database.Database).prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });

  it('execute:候选目录外的路径被拒(path-not-from-discovery),不触碰目标库', () => {
    state.targetDb = createTargetDb();
    const outside = path.join(state.appDataDir, 'elsewhere', 'cindy-evil.db');
    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, {
      filePaths: [outside],
    }) as { results: Array<{ ok: boolean; rejected?: string }> };
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].rejected).toBe('path-not-from-discovery');
    expect((state.targetDb as Database.Database).prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('execute:空列表 / 超长条目直接返回空结果', () => {
    state.targetDb = createTargetDb();
    expect(state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, { filePaths: [] })).toEqual({ results: [] });
    expect(
      state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, { filePaths: ['x'.repeat(8192)] }),
    ).toEqual({ results: [] });
  });

  it('execute:目标库未初始化时抛受控错误', () => {
    state.targetDb = null;
    const file = seedLegacyDb('carol', [{ id: 's-1', title: 'x' }]);
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT);
    expect(() =>
      state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, { filePaths: [file] }),
    ).toThrow('not initialized');
  });

  it('isAcceptableLegacyPath:只放行 discovery 中的原始 regular file', () => {
    const file = seedLegacyDb('dave', [{ id: 's-1', title: 'x' }]);
    const discovery = state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT) as Parameters<
      typeof isAcceptableLegacyPath
    >[1];
    expect(isAcceptableLegacyPath(file, discovery)).toBe(true);
    expect(isAcceptableLegacyPath(path.join(path.dirname(file), 'cindy-new.db'), discovery)).toBe(false);
    expect(isAcceptableLegacyPath(path.join(state.appDataDir, 'evil.db'), discovery)).toBe(false);
    expect(isAcceptableLegacyPath('/etc/passwd', discovery)).toBe(false);
  });

  it('execute:拒绝未经过当前 renderer discover 授权的新文件', () => {
    const discovered = seedLegacyDb('grant', [{ id: 's-1', title: 'x' }]);
    state.targetDb = createTargetDb();
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT);

    const added = path.join(path.dirname(discovered), 'cindy-added.db');
    const db = new Database(added);
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
    db.close();

    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, {
      filePaths: [added],
    }) as { results: Array<{ rejected?: string }> };
    expect(result.results[0].rejected).toBe('path-not-from-discovery');
  });

  it('execute:discovery grant 不可被另一个 renderer 复用', () => {
    const discovered = seedLegacyDb('owner', [{ id: 's-1', title: 'x' }]);
    state.targetDb = createTargetDb();
    const firstRendererEvent = { sender: {} };
    const secondRendererEvent = { sender: {} };
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(firstRendererEvent);

    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(secondRendererEvent, {
      filePaths: [discovered],
    }) as { results: Array<{ rejected?: string }> };
    expect(result.results[0].rejected).toBe('path-not-from-discovery');
  });

  it('execute:discover 后文件 metadata 改变时拒绝', () => {
    const discovered = seedLegacyDb('changed', [{ id: 's-1', title: 'safe' }]);
    state.targetDb = createTargetDb();
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT);
    appendFileSync(discovered, 'changed-after-discovery');

    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, {
      filePaths: [discovered],
    }) as { results: Array<{ rejected?: string }> };
    expect(result.results[0].rejected).toBe('path-not-from-discovery');
  });

  it('execute:discover 后替换为 symlink 时拒绝且不读取链接目标', () => {
    const discovered = seedLegacyDb('swap', [{ id: 's-1', title: 'safe' }]);
    state.targetDb = createTargetDb();
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT);

    const outside = path.join(state.appDataDir, 'outside.db');
    const outsideDb = new Database(outside);
    outsideDb.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
    outsideDb.prepare('INSERT INTO sessions (id, title) VALUES (?, ?)').run('outside', 'outside');
    outsideDb.close();
    rmSync(discovered);
    symlinkSync(outside, discovered);

    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, {
      filePaths: [discovered],
    }) as { results: Array<{ rejected?: string }> };
    expect(result.results[0].rejected).toBe('path-not-from-discovery');
    expect(state.targetDb.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('execute:拒绝带 .. 的候选目录路径逃逸', () => {
    seedLegacyDb('base', [{ id: 's-1', title: 'safe' }]);
    state.targetDb = createTargetDb();
    state.handlers.get(LEGACY_IMPORT_DISCOVER_CHANNEL)!(EVENT);
    const outside = path.join(state.appDataDir, 'cindy-escape.db');
    writeFileSync(outside, 'not a database');
    const escaped = path.join(state.appDataDir, 'Cindy', '..', 'cindy-escape.db');

    const result = state.handlers.get(LEGACY_IMPORT_EXECUTE_CHANNEL)!(EVENT, {
      filePaths: [escaped],
    }) as { results: Array<{ rejected?: string }> };
    expect(result.results[0].rejected).toBe('path-not-from-discovery');
  });
});
