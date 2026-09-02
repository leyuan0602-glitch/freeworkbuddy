import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleAlert, HardDriveDownload, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import type {
  LegacyImportDbStats,
  LegacyImportDiscoveryResult,
} from '../../../shared/legacyImport';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const KNOWN_ERROR_KINDS = new Set([
  'corrupt-db',
  'no-such-table',
  'txn-failed',
  'budget-exceeded',
]);

function errorKindLabel(t: (key: string) => string, kind: string | null): string {
  if (!kind) return '';
  if (KNOWN_ERROR_KINDS.has(kind)) return t(`settings.legacyImport.kind.${kind}`);
  return kind;
}

/**
 * 旧官方发行版数据显式导入(蓝图 §3.16)。显式两段式:先只读扫描,再勾选导入;
 * 导入失败时旧数据保持原样。凭据(BYOK/登录态)不导入,由文案明确说明。
 */
export function LegacyImportSection() {
  const { t } = useTranslation();
  const [discovery, setDiscovery] = useState<LegacyImportDiscoveryResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<LegacyImportDbStats[] | null>(null);

  const runDiscover = useCallback(async () => {
    setScanning(true);
    setResults(null);
    try {
      const result = await window.electronAPI.legacyImport.discover();
      setDiscovery(result);
      setSelected(new Set());
    } finally {
      setScanning(false);
    }
  }, []);

  const toggleDb = useCallback((filePath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const importSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const result = await window.electronAPI.legacyImport.execute([...selected]);
      setResults(result.results);
      setSelected(new Set());
    } finally {
      setImporting(false);
    }
  }, [selected]);

  const databases = discovery?.databases ?? [];

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl',
        'border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]',
        'p-4',
      )}
    >
      <div className="flex min-w-0 flex-col gap-1 xl:flex-row xl:items-end xl:justify-between xl:gap-6">
        <div className="min-w-0 max-w-[620px]">
          <h3 className="text-15 font-medium leading-[1.2] text-[var(--settings-section-title)]">
            {t('settings.legacyImport.title')}
          </h3>
          <p className="mt-1 text-12 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('settings.legacyImport.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={runDiscover}
          disabled={scanning}
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-full px-4 text-12 font-medium active:scale-[0.98] xl:self-end',
            'border border-[var(--settings-btn-secondary-border)]',
            'bg-[var(--settings-btn-secondary-bg)] text-[var(--settings-btn-secondary-text)]',
            'transition-colors hover:bg-[var(--settings-menu-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <Spinner icon={HardDriveDownload} size={14} spinning={scanning} />
          {scanning ? t('settings.legacyImport.scanning') : t('settings.legacyImport.scan')}
        </button>
      </div>

      {discovery && (
        <div className="flex min-w-0 flex-col gap-2">
          {databases.length === 0 ? (
            <div className="rounded-lg border border-[var(--settings-input-border)] px-3 py-3">
              <p className="text-12 font-medium text-[var(--settings-section-sublabel)]">
                {t('settings.legacyImport.empty')}
              </p>
              <p className="mt-1 text-11 leading-[1.5] text-[var(--settings-section-desc)]">
                {t('settings.legacyImport.emptyHint')}
              </p>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-col gap-1.5">
                {databases.map((db) => (
                  <label
                    key={db.filePath}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5',
                      'border border-[var(--settings-input-border)]',
                      'hover:bg-[var(--settings-menu-bg-hover)] select-none',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(db.filePath)}
                      onChange={() => toggleDb(db.filePath)}
                      className="h-4 w-4 shrink-0 accent-[var(--settings-menu-text-selected)]"
                    />
                    <span
                      className={cn(
                        'shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-10 uppercase',
                        'border-[var(--settings-input-border)] text-[var(--settings-section-desc)]',
                      )}
                    >
                      {db.region}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-12 text-[var(--settings-section-sublabel)]">
                      {t('settings.legacyImport.userDb', { userId: db.userId })}
                    </span>
                    <span className="shrink-0 text-11 tabular-nums text-[var(--settings-section-desc)]">
                      {formatBytes(db.sizeBytes)}
                    </span>
                  </label>
                ))}
              </div>
              {discovery.warnings.length > 0 && (
                <p
                  title={discovery.warnings.join('\n')}
                  className="text-11 leading-[1.5] text-[var(--settings-section-desc)]"
                >
                  {t('settings.legacyImport.warnings', { count: discovery.warnings.length })}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-11 leading-[1.5] text-[var(--settings-section-desc)]">
                  {t('settings.legacyImport.credentialsNote')}
                </p>
                <button
                  type="button"
                  onClick={importSelected}
                  disabled={selected.size === 0 || importing}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-12 font-medium active:scale-[0.98]',
                    'border border-[var(--settings-btn-primary-border)]',
                    'bg-[var(--settings-btn-primary-bg)] text-[var(--settings-btn-primary-text)]',
                    'transition-colors hover:bg-[var(--settings-btn-primary-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  <Spinner icon={RefreshCw} size={14} spinning={importing} />
                  {importing
                    ? t('settings.legacyImport.importing')
                    : t('settings.legacyImport.importSelected', { count: selected.size })}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5 border-t border-[var(--settings-input-border)] pt-3">
          {results.map((item) => {
            const ok = item.ok && !item.rejected;
            const kindLabel = item.rejected
              ? t('settings.legacyImport.kind.rejected')
              : errorKindLabel(t, item.errorKind ?? item.sessions.errorKind ?? item.messages.errorKind);
            return (
              <div key={item.filePath} className="flex min-w-0 items-start gap-2 px-1">
                {ok ? (
                  <CircleCheck size={14} className="mt-0.5 shrink-0 text-[var(--settings-menu-text-selected)]" />
                ) : (
                  <CircleAlert size={14} className="mt-0.5 shrink-0 text-[var(--settings-section-sublabel)]" />
                )}
                <p className="min-w-0 flex-1 text-12 leading-[1.5] text-[var(--settings-section-sublabel)]">
                  {ok
                    ? t('settings.legacyImport.resultOk', {
                        sessions: item.sessions.rowsInserted,
                        messages: item.messages.rowsInserted,
                        skipped: item.sessions.rowsSkipped + item.messages.rowsSkipped,
                      })
                    : t('settings.legacyImport.resultFailed', { kind: kindLabel })}
                  {ok &&
                    (item.sessions.droppedLegacyColumns.length > 0 ||
                      item.messages.droppedLegacyColumns.length > 0) && (
                      <span className="text-[var(--settings-section-desc)]">
                        {' '}
                        {t('settings.legacyImport.droppedColumns', {
                          count:
                            item.sessions.droppedLegacyColumns.length +
                            item.messages.droppedLegacyColumns.length,
                        })}
                      </span>
                    )}
                  {item.messages.tableMissing && (
                    <span className="text-[var(--settings-section-desc)]">
                      {' '}
                      {t('settings.legacyImport.messagesTableMissing')}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
          <p className="px-1 text-11 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('settings.legacyImport.resultFooter')}
          </p>
        </div>
      )}
    </div>
  );
}
