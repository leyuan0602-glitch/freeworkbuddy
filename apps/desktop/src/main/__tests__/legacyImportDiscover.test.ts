import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import fs from 'node:fs';
import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import {
  discoverLegacyDatabases,
  LEGACY_DB_MAX_BYTES,
  LEGACY_USER_DATA_DIR_NAMES,
  pickLatestLegacyDbFromNames,
} from '../legacyImport/discover';

let appData: string;

beforeEach(() => {
  appData = mkdtempSync(path.join(tmpdir(), 'xdt-legacy-discover-'));
});

afterEach(() => {
  rmSync(appData, { recursive: true, force: true });
});

/** 在指定官方 region 目录下建一个最小合法旧库。 */
function seedLegacyDb(region: keyof typeof LEGACY_USER_DATA_DIR_NAMES, userId: string): string {
  const dir = path.join(appData, LEGACY_USER_DATA_DIR_NAMES[region]);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `cindy-${userId}.db`);
  const db = new Database(file);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)');
  db.close();
  return file;
}

describe('discoverLegacyDatabases', () => {
  it('cn/global/dev 三个候选目录都检查;存在的目录返回 region 标注', () => {
    const cnFile = seedLegacyDb('cn', 'alice');
    const globalFile = seedLegacyDb('global', 'bob');
    const result = discoverLegacyDatabases(appData);
    expect(result.checkedDirs.map((d) => path.basename(d.dir))).toEqual([
      'Cindy',
      'CindyGlobal',
      'CindyDev',
    ]);
    expect(result.databases.map((d) => d.region)).toEqual(['cn', 'global']);
    expect(result.databases[0]).toMatchObject({ filePath: cnFile, userId: 'alice' });
    expect(result.databases[1]).toMatchObject({ filePath: globalFile, userId: 'bob' });
  });

  it('候选目录都不存在:零发现、零异常', () => {
    const result = discoverLegacyDatabases(appData);
    expect(result.databases).toEqual([]);
    expect(result.checkedDirs.every((d) => !d.exists)).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('pickLatestLegacyDbFromNames', () => {
  it('同目录多份旧库只取 mtime 最新一份,其余进 warnings', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    const older = path.join(dir, 'cindy-u-old.db');
    const newer = path.join(dir, 'cindy-u-new.db');
    for (const f of [older, newer]) {
      const db = new Database(f);
      db.close();
    }
    const past = new Date(Date.now() - 60_000);
    utimesSync(older, past, past);
    const nowDate = new Date();
    utimesSync(newer, nowDate, nowDate);

    const { db, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(db?.filePath).toBe(newer);
    expect(db?.userId).toBe('u-new');
    expect(warnings.some((w) => w.includes('older-than-latest') && w.includes('cindy-u-old.db'))).toBe(true);
  });

  it('symlink 即使指向常规文件也拒收', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    const real = path.join(dir, 'real.db');
    const db = new Database(real);
    db.close();
    const link = path.join(dir, 'cindy-u-link.db');
    symlinkSync(real, link);

    const { db: picked, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(picked).toBeNull();
    expect(warnings.some((w) => w.includes('not-regular-file') && w.includes('cindy-u-link.db'))).toBe(true);
  });

  it('-wal.db / -shm.db 伴随文件不参与发现', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'cindy-u.db-wal.db'), 'x');
    writeFileSync(path.join(dir, 'cindy-u.db-shm.db'), 'x');

    const { db, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(db).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('mtime 在未来超过 1 天:拒收', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'cindy-u-future.db');
    const db = new Database(file);
    db.close();
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    utimesSync(file, future, future);

    const { db: picked, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(picked).toBeNull();
    expect(warnings.some((w) => w.includes('future-mtime'))).toBe(true);
  });

  it('超过体积上限(512MB,稀疏文件模拟):拒收', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'cindy-u-huge.db');
    writeFileSync(file, '');
    truncateSync(file, LEGACY_DB_MAX_BYTES + 1); // 稀疏文件,不占实际磁盘

    const { db, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(db).toBeNull();
    expect(warnings.some((w) => w.includes('too-large'))).toBe(true);
  });

  it('空 userId(cindy-.db):拒收', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'cindy-.db');
    const db = new Database(file);
    db.close();

    const { db: picked, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(picked).toBeNull();
    expect(warnings.some((w) => w.includes('empty-user-id'))).toBe(true);
  });

  it('非 cindy-*.db 文件被忽略', () => {
    const dir = path.join(appData, 'Cindy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'other.db'), 'x');
    writeFileSync(path.join(dir, 'cindy-notes.txt'), 'x');

    const { db, warnings } = pickLatestLegacyDbFromNames(dir, fs.readdirSync(dir), Date.now());
    expect(db).toBeNull();
    expect(warnings).toEqual([]);
  });
});
