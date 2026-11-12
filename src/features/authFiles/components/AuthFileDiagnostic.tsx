import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { diagnosticCategory, type CredentialDiagnostic } from '../diagnostics';
import styles from './AuthFileDiagnostics.module.scss';

export function AuthFileDiagnostic({
  record,
  testing,
  disabled,
  onTest,
  onCopy,
}: {
  record?: CredentialDiagnostic;
  testing: boolean;
  disabled: boolean;
  onTest: () => void;
  onCopy: (text: string) => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const category = diagnosticCategory(record);
  const label = !record
    ? t('auth_files.diagnostic_untested')
    : category === 'success'
      ? t('auth_files.test_result_success')
      : `${record.result.status_code || '—'} · ${t('auth_files.test_result_failed')}`;
  return (
    <div className={styles.diagnostic}>
      <div className={styles.summary}>
        <span className={styles.caption}>{t('auth_files.diagnostic_label')}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={onTest}
          disabled={disabled || testing}
          loading={testing}
        >
          {t(testing ? 'auth_files.test_running' : 'auth_files.test_button')}
        </Button>
      </div>
      {record ? (
        <details className={styles.details}>
          <summary>
            <span
              className={`${styles.badge} ${category === 'success' ? styles.success : styles.failure}`}
            >
              {label}
            </span>
            <time dateTime={new Date(record.testedAt).toISOString()}>
              {new Date(record.testedAt).toLocaleTimeString(i18n.language)}
            </time>
          </summary>
          <div className={styles.meta}>
            {record.result.model} · {record.result.latency_ms ?? '—'} ms
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onCopy(JSON.stringify(record.result, null, 2))}
          >
            {t('auth_files.test_copy_response')}
          </Button>
          <pre>{record.result.error || record.result.response || record.result.message}</pre>
          {record.result.error_source && (
            <div className={styles.meta}>{record.result.error_source}</div>
          )}
        </details>
      ) : (
        <span className={styles.meta}>{label}</span>
      )}
    </div>
  );
}
