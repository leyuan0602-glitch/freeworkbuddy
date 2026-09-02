import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { createBetterSqliteDatabase } from '../localDb/betterSqliteFactory';
import {
  importLegacyDb,
  intersectColumns,
  resolveLegacyDbPath,
  SESSION_COLUMNS,
  MESSAGE_COLUMNS,
} from '../legacyImport/importAdapter';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'xdt-legacy-import-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 建最小新库 fixture(与真实 localDb 同名的两张核心表)。 */
function createTargetDb(file: string): Database.Database {
  const db = createBetterSqliteDatabase(file);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      working_dir TEXT,
      model TEXT,
      provider_id TEXT,
      agent_kind TEXT,
      pinned_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      created_at INTEGER
    );
  `);
  return db;
}

interface FixtureRow {
  id: string;
  title?: string;
  working_dir?: string;
}

/** 建最小旧库 fixture;带 legacy_only 列以验证交集丢弃。 */
function createLegacyDb(
  file: string,
  options?: { withMessages?: boolean; sessionRows?: FixtureRow[] },
): Database.Database {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      working_dir TEXT,
      legacy_only TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
  if (options?.withMessages !== false) {
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        legacy_msg_col TEXT,
        created_at INTEGER
      );
    `);
  }
  const insert = db.prepare(
    'INSERT INTO sessions (id, title, working_dir, legacy_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  (options?.sessionRows ?? [
    { id: 's-1', title: '任务一', working_dir: '/tmp/a' },
    { id: 's-2', title: '任务二', working_dir: '/tmp/b' },
  ]).forEach((row, i) => {
    insert.run(row.id, row.title ?? null, row.working_dir ?? null, 'x', 1000 + i, 2000 + i);
  });
  if (options?.withMessages !== false) {
    const insertMsg = db.prepare(
      'INSERT INTO messages (id, session_id, role, content, legacy_msg_col, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertMsg.run('m-1', 's-1', 'user', '你好', 'x', 1100);
    insertMsg.run('m-2', 's-1', 'assistant', '回复', 'x', 1200);
  }
  return db;
}

describe('intersectColumns', () => {
  it('按 wanted 顺序取交集', () => {
    expect(intersectColumns(['b', 'a', 'c'], ['a', 'b', 'z'])).toEqual(['a', 'b']);
  });
});

describe('importLegacyDb', () => {
  it('交集列导入:legacy 独有列被丢弃并进诊断', () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u1');
    const legacy = createLegacyDb(legacyFile);
    legacy.close();
    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const stats = importLegacyDb(legacyFile, target);
      expect(stats.ok).toBe(true);
      expect(stats.sessions.rowsInserted).toBe(2);
      expect(stats.messages.rowsInserted).toBe(2);
      expect(stats.sessions.droppedLegacyColumns).toEqual(['legacy_only']);
      expect(stats.messages.droppedLegacyColumns).toEqual(['legacy_msg_col']);
      // 交集列实际落库
      const row = target.prepare('SELECT id, title, working_dir FROM sessions WHERE id = ?').get('s-1') as {
        title: string;
        working_dir: string;
      };
      expect(row.title).toBe('任务一');
      expect(row.working_dir).toBe('/tmp/a');
      const msg = target.prepare('SELECT content FROM messages WHERE id = ?').get('m-1') as { content: string };
      expect(msg.content).toBe('你好');
    } finally {
      target.close();
    }
  });

  it('幂等:重复执行不产生重复行(第二遍全部 skipped)', () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u2');
    const legacy = createLegacyDb(legacyFile);
    legacy.close();
    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const first = importLegacyDb(legacyFile, target);
      expect(first.ok).toBe(true);
      expect(first.sessions.rowsInserted).toBe(2);
      const second = importLegacyDb(legacyFile, target);
      expect(second.ok).toBe(true);
      expect(second.sessions.rowsInserted).toBe(0);
      expect(second.sessions.rowsSkipped).toBe(2);
      expect(second.messages.rowsInserted).toBe(0);
      expect(second.messages.rowsSkipped).toBe(2);
      expect(target.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 2 });
      expect(target.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 2 });
    } finally {
      target.close();
    }
  });

  it('旧库无 messages 表:tableMissing 标注,不算失败', () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u3');
    const legacy = createLegacyDb(legacyFile, { withMessages: false });
    legacy.close();
    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const stats = importLegacyDb(legacyFile, target);
      expect(stats.ok).toBe(true);
      expect(stats.messages.tableMissing).toBe(true);
      expect(stats.sessions.rowsInserted).toBe(2);
    } finally {
      target.close();
    }
  });

  it('超预算:不写入任何行,errorKind=budget-exceeded 且库级 ok=false', () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u4');
    const legacy = createLegacyDb(legacyFile); // 2 条 messages
    legacy.close();
    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const stats = importLegacyDb(legacyFile, target, { maxRows: 1 });
      expect(stats.messages.errorKind).toBe('budget-exceeded');
      expect(stats.ok).toBe(false);
      expect(stats.errorKind).toBe('budget-exceeded');
      expect(target.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
    } finally {
      target.close();
    }
  });

  it('只读承诺:导入后旧库文件字节与 mtime 不变', async () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u5');
    const legacy = createLegacyDb(legacyFile);
    legacy.close();
    const beforeBytes = fs.readFileSync(legacyFile);
    const beforeStat = fs.statSync(legacyFile);
    // mtime 精度问题:取一个明确的历史锚点断言不被更新
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(legacyFile, old, old);

    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const stats = importLegacyDb(legacyFile, target);
      expect(stats.ok).toBe(true);
    } finally {
      target.close();
    }
    expect(fs.readFileSync(legacyFile).equals(beforeBytes)).toBe(true);
    const afterStat = fs.statSync(legacyFile);
    expect(afterStat.mtimeMs).toBe(old.getTime());
    void beforeStat;
  });

  it('损坏文件:errorKind=corrupt-db,不抛异常', () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u6');
    fs.writeFileSync(legacyFile, 'this is not a sqlite database'.repeat(50));
    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const stats = importLegacyDb(legacyFile, target);
      expect(stats.ok).toBe(false);
      expect(stats.errorKind).toBe('corrupt-db');
    } finally {
      target.close();
    }
  });

  it('文件不存在:errorKind 非空,不抛异常', () => {
    const targetFile = path.join(dir, 'target.db');
    const target = createTargetDb(targetFile);
    try {
      const stats = importLegacyDb(resolveLegacyDbPath(dir, 'missing'), target);
      expect(stats.ok).toBe(false);
      expect(stats.errorKind).toBe('txn-failed');
    } finally {
      target.close();
    }
  });

  it('WANTED 列在新库缺失时自动收窄(插入列 = 三方交集)', () => {
    const legacyFile = resolveLegacyDbPath(dir, 'u7');
    const legacy = createLegacyDb(legacyFile);
    legacy.close();
    const targetFile = path.join(dir, 'target.db');
    const target = createBetterSqliteDatabase(targetFile);
    // 新库缺 model/provider_id/agent_kind/pinned_at 列
    target.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, working_dir TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE messages (id TEXT PRIMARY KEY, client_id TEXT, session_id TEXT, role TEXT, content TEXT, created_at INTEGER);
    `);
    try {
      const stats = importLegacyDb(legacyFile, target);
      expect(stats.ok).toBe(true);
      expect(stats.sessions.rowsInserted).toBe(2);
    } finally {
      target.close();
    }
  });

  it('SESSION/MESSAGE 常量覆盖蓝图要求的核心列', () => {
    expect([...SESSION_COLUMNS]).toContain('id');
    expect([...MESSAGE_COLUMNS]).toContain('content');
  });
});
