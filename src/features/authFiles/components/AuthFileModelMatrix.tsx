import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelCatalog } from '@/services/api/authFiles';
import { getTypeLabel, isRuntimeOnlyAuthFile, normalizeProviderKey } from '../constants';
import { getAuthFileRefreshKey } from '../manualRefresh';
import { diagnosticCategory, type CredentialDiagnostic } from '../diagnostics';
import {
  buildModelColumns,
  catalogCell,
  columnHasDifferences,
  credentialProvider,
  diagnosticForColumn,
  indexModelCatalogs,
  matchesModelColumn,
  type CatalogCellState,
} from '../modelCatalog';
import { useAuthFileModelCatalogs } from '../hooks/useAuthFileModelCatalogs';
import { AuthFileDiagnostic } from './AuthFileDiagnostic';
import styles from './AuthFileModelMatrix.module.scss';

type MatrixProps = {
  files: AuthFileItem[];
  allFiles: AuthFileItem[];
  selected: ReadonlySet<string>;
  selectedOnly: boolean;
  onSelectedOnlyChange: (value: boolean) => void;
  aliases: Record<string, OAuthModelAliasEntry[]>;
  records: Record<string, CredentialDiagnostic>;
  running: ReadonlySet<string>;
  testDisabled: boolean;
  refreshRevision: number;
  onToggleSelect: (name: string) => void;
  onTest: (file: AuthFileItem, model: string) => void;
  onBatchTest: (files: AuthFileItem[], model: string) => void;
  onCopy: (text: string) => void | Promise<void>;
};

export function AuthFileModelViewSwitch({
  value,
  onChange,
}: {
  value: 'cards' | 'models';
  onChange: (view: 'cards' | 'models') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.viewSwitch} role="group" aria-label={t('auth_files.matrix.view_label')}>
      {(['cards', 'models'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={value === view}
          onClick={() => onChange(view)}
        >
          {t(`auth_files.matrix.view_${view}`)}
        </button>
      ))}
    </div>
  );
}

export function AuthFileModelMatrix(props: MatrixProps) {
  const credentialKey = JSON.stringify(
    props.allFiles
      .map((file) => [
        getAuthFileRefreshKey(file),
        credentialProvider(file),
        file.disabled === true,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
  const catalogs = useAuthFileModelCatalogs(credentialKey, props.refreshRevision);
  return <AuthFileModelMatrixTable {...props} {...catalogs} onRefresh={catalogs.reload} />;
}

const cellMarks: Record<CatalogCellState, string> = {
  present: '✓',
  partial: '◐',
  disabled: '⊘',
  placeholder: '⊘',
  registered: '◇',
  missing: '—',
  unregistered: '—',
  unknown: '?',
  na: '·',
};

export function AuthFileModelMatrixTable({
  files,
  selected,
  selectedOnly,
  onSelectedOnlyChange,
  aliases,
  records,
  running,
  testDisabled,
  onToggleSelect,
  onTest,
  onBatchTest,
  onCopy,
  catalogs,
  readAt,
  loading,
  error,
  onRefresh,
}: MatrixProps & {
  catalogs: AuthFileModelCatalog[];
  readAt?: number;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [inspected, setInspected] = useState<{ column: string; file?: string } | null>(null);
  const indexed = useMemo(() => indexModelCatalogs(catalogs), [catalogs]);
  const rows = files;
  const columns = useMemo(
    () => buildModelColumns(rows, indexed, aliases),
    [rows, indexed, aliases]
  );
  const visibleColumns = columns
    .map((column) => ({ column, differs: columnHasDifferences(rows, indexed, column) }))
    .filter(
      ({ column, differs }) => matchesModelColumn(column, search) && (!differencesOnly || differs)
    )
    .sort(
      (a, b) =>
        Number(b.differs) - Number(a.differs) ||
        Number(b.column.aliases.length > 0) - Number(a.column.aliases.length > 0)
    )
    .map(({ column }) => column);
  const column = columns.find((item) => item.key === inspected?.column);
  const inspectedFile = rows.find((file) => getAuthFileRefreshKey(file) === inspected?.file);
  const providerAliases = column
    ? Object.entries(aliases)
        .filter(([provider]) => normalizeProviderKey(provider) === column.provider)
        .flatMap(([, entries]) => entries)
    : [];
  const upstreamCount = rows.filter(
    (file) => indexed.get(getAuthFileRefreshKey(file))?.source === 'upstream'
  ).length;
  const unknownCount = rows.filter((file) => {
    const source = indexed.get(getAuthFileRefreshKey(file))?.source;
    return !source || source === 'unknown';
  }).length;
  const legend: CatalogCellState[] = [
    'present',
    'partial',
    'disabled',
    'placeholder',
    'missing',
    'unknown',
    'registered',
  ];

  return (
    <section className={styles.matrix} aria-label={t('auth_files.matrix.title')}>
      <div className={styles.controls}>
        <div className={styles.searchField}>
          <label htmlFor={searchId}>{t('auth_files.matrix.search_label')}</label>
          <input
            id={searchId}
            className="input"
            type="search"
            value={search}
            placeholder={t('auth_files.matrix.search_placeholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={differencesOnly}
            onChange={(event) => setDifferencesOnly(event.target.checked)}
          />
          {t('auth_files.matrix.differences_only')}
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => onSelectedOnlyChange(event.target.checked)}
          />
          {t('auth_files.matrix.selected_only')}
        </label>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          loading={loading}
        >
          {t('auth_files.matrix.reload')}
        </Button>
      </div>

      <p className={styles.notice}>{t('auth_files.matrix.notice')}</p>
      {error ? (
        <div className={styles.error} role="alert">
          {t('system_info.models_error')}: {error}
        </div>
      ) : loading ? (
        <p className={styles.empty} role="status">
          {t('auth_files.models_loading')}
        </p>
      ) : (
        <>
          <div className={styles.summary} aria-live="polite">
            <strong>{t('auth_files.matrix.accounts', { count: rows.length })}</strong>
            <span>{t('auth_files.matrix.columns', { count: visibleColumns.length })}</span>
            <span>{t('auth_files.matrix.upstream_count', { count: upstreamCount })}</span>
            {unknownCount > 0 && (
              <span>{t('auth_files.matrix.unknown_count', { count: unknownCount })}</span>
            )}
            {readAt && (
              <time dateTime={new Date(readAt).toISOString()}>
                {t('auth_files.matrix.read_at', {
                  time: new Date(readAt).toLocaleTimeString(i18n.language),
                })}
              </time>
            )}
          </div>
          <div className={styles.legend}>
            {legend.map((state) => (
              <span key={state} className={styles[state]}>
                <b aria-hidden="true">{cellMarks[state]}</b> {t(`auth_files.matrix.state_${state}`)}
              </span>
            ))}
          </div>
          {rows.length === 0 || visibleColumns.length === 0 ? (
            <p className={styles.empty}>
              {t(
                rows.length === 0
                  ? 'auth_files.matrix.empty_accounts'
                  : 'auth_files.matrix.empty_models'
              )}
            </p>
          ) : (
            <div
              className={styles.scroll}
              role="region"
              tabIndex={0}
              aria-label={t('auth_files.matrix.scroll_label')}
            >
              <table className={styles.table}>
                <caption className={styles.srOnly}>{t('auth_files.matrix.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={styles.accountHeading}>
                      {t('auth_files.matrix.account')}
                    </th>
                    {visibleColumns.map((item) => {
                      const sameProvider = rows.filter(
                        (file) => credentialProvider(file) === item.provider
                      );
                      const listed = sameProvider.filter((file) => {
                        const state = catalogCell(
                          file,
                          indexed.get(getAuthFileRefreshKey(file)),
                          item
                        ).state;
                        return state === 'present' || state === 'partial' || state === 'registered';
                      }).length;
                      return (
                        <th scope="col" key={item.key}>
                          <button
                            type="button"
                            className={styles.columnButton}
                            onClick={() => setInspected({ column: item.key })}
                          >
                            <span className={styles.provider}>
                              {getTypeLabel(t, item.provider)}
                            </span>
                            <strong>{item.label}</strong>
                            {item.label !== item.id && <code>{item.id}</code>}
                            <span className={styles.coverage}>
                              {t('auth_files.matrix.coverage', {
                                count: listed,
                                total: sameProvider.length,
                              })}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((file) => {
                    const key = getAuthFileRefreshKey(file);
                    const catalog = indexed.get(key);
                    return (
                      <tr key={key}>
                        <th scope="row" className={styles.accountCell}>
                          <div className={styles.account}>
                            {!isRuntimeOnlyAuthFile(file) && (
                              <input
                                type="checkbox"
                                checked={selected.has(file.name)}
                                onChange={() => onToggleSelect(file.name)}
                                aria-label={t('auth_files.matrix.select_account', {
                                  name: file.name,
                                })}
                              />
                            )}
                            <div>
                              <strong>{file.email || file.projectId || file.name}</strong>
                              {(file.email || file.projectId) && (
                                <span className={styles.fileName}>{file.name}</span>
                              )}
                              <span className={styles.accountMeta}>
                                {getTypeLabel(t, credentialProvider(file))}
                                <span
                                  className={
                                    file.disabled ? styles.disabledAccount : styles.enabledAccount
                                  }
                                >
                                  {t(
                                    file.disabled
                                      ? 'auth_files.problem_filter_disabled'
                                      : 'auth_files.problem_filter_enabled'
                                  )}
                                </span>
                              </span>
                            </div>
                          </div>
                        </th>
                        {visibleColumns.map((item) => {
                          const cell = catalogCell(file, catalog, item);
                          const record = diagnosticForColumn(
                            records[key],
                            item,
                            Object.entries(aliases)
                              .filter(
                                ([provider]) => normalizeProviderKey(provider) === item.provider
                              )
                              .flatMap(([, entries]) => entries)
                          );
                          return (
                            <td key={item.key}>
                              {cell.state === 'na' ? (
                                <span
                                  className={styles.na}
                                  aria-label={t('auth_files.matrix.state_na')}
                                >
                                  ·
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.cell} ${styles[cell.state]}`}
                                  aria-label={`${file.name} · ${item.label} · ${t(`auth_files.matrix.state_${cell.state}`)}`}
                                  onClick={() => setInspected({ column: item.key, file: key })}
                                >
                                  <span className={styles.mark} aria-hidden="true">
                                    {cellMarks[cell.state]}
                                  </span>
                                  <span>{t(`auth_files.matrix.state_${cell.state}`)}</span>
                                  {record && (
                                    <span
                                      className={`${styles.testResult} ${diagnosticCategory(record) === 'success' ? styles.present : styles.disabled}`}
                                    >
                                      {t('auth_files.matrix.test_status', {
                                        status: record.result.status_code || '—',
                                      })}
                                    </span>
                                  )}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(column) && !loading && !error}
        onClose={() => setInspected(null)}
        title={
          column
            ? `${column.label}${inspectedFile ? ` · ${inspectedFile.email || inspectedFile.name}` : ''}`
            : ''
        }
        width={700}
      >
        {column && (
          <div className={styles.detail}>
            <p className={styles.notice}>
              {inspectedFile
                ? t(
                    `auth_files.matrix.source_${indexed.get(getAuthFileRefreshKey(inspectedFile))?.source ?? 'unknown'}`
                  )
                : t('auth_files.matrix.batch_scope')}
            </p>
            <p className={styles.notice}>{t('auth_files.matrix.flags_notice')}</p>
            {column.models.map((variant) => {
              const ownModel = inspectedFile
                ? indexed
                    .get(getAuthFileRefreshKey(inspectedFile))
                    ?.models.find((model) => model.id === variant.id)
                : undefined;
              const record = inspectedFile
                ? diagnosticForColumn(
                    records[getAuthFileRefreshKey(inspectedFile)],
                    { ...column, models: [variant] },
                    providerAliases
                  )
                : undefined;
              return (
                <div key={variant.id} className={styles.variant}>
                  <code>{variant.id}</code>
                  {providerAliases
                    .filter((alias) => alias.name === variant.id)
                    .map((alias) => (
                      <span key={alias.alias} className={styles.alias}>
                        {alias.alias}
                      </span>
                    ))}
                  {inspectedFile && (
                    <span className={styles.notice}>
                      {t(
                        !ownModel
                          ? 'auth_files.matrix.variant_absent'
                          : ownModel.disabled === true
                            ? 'auth_files.matrix.variant_disabled'
                            : ownModel.disabled === false
                              ? 'auth_files.matrix.variant_enabled'
                              : 'auth_files.matrix.variant_flags_unknown'
                      )}
                    </span>
                  )}
                  {inspectedFile ? (
                    <AuthFileDiagnostic
                      record={record}
                      testing={running.has(getAuthFileRefreshKey(inspectedFile))}
                      disabled={testDisabled || isRuntimeOnlyAuthFile(inspectedFile)}
                      onTest={() => onTest(inspectedFile, variant.id)}
                      onCopy={onCopy}
                    />
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={testDisabled}
                      onClick={() =>
                        onBatchTest(
                          rows.filter(
                            (file) =>
                              credentialProvider(file) === column.provider &&
                              !isRuntimeOnlyAuthFile(file)
                          ),
                          variant.id
                        )
                      }
                    >
                      {t('auth_files.matrix.test_filtered')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </section>
  );
}
