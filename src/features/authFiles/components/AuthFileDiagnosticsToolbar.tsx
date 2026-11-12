import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { diagnosticFilters, type DiagnosticFilter } from '../diagnostics';
import styles from './AuthFileDiagnostics.module.scss';

export function AuthFileDiagnosticsToolbar(props: {
  filter: DiagnosticFilter;
  onFilter: (value: DiagnosticFilter) => void;
  model: string;
  onModel: (value: string) => void;
  disabled: boolean;
  canRetry: boolean;
  onRetry: () => void;
  batch: { running: boolean; completed: number; total: number; cancelled: boolean };
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const filterLabel = (value: DiagnosticFilter) => {
    if (value === 'all') return t('auth_files.problem_filter_all');
    if (value === 'success') return t('auth_files.test_result_success');
    if (value === '401' || value === '403' || value === '429') return value;
    return t(`auth_files.diagnostic_${value}`);
  };
  return (
    <div className={styles.toolbar}>
      <label>
        {t('auth_files.diagnostic_filter')}
        <Select
          value={props.filter}
          options={diagnosticFilters.map((value) => ({ value, label: filterLabel(value) }))}
          onChange={(value) => {
            if (diagnosticFilters.some((filter) => filter === value))
              props.onFilter(value as DiagnosticFilter);
          }}
          ariaLabel={t('auth_files.diagnostic_filter')}
        />
      </label>
      <label>
        {t('auth_files.test_model_label')}
        <Input
          value={props.model}
          onChange={(event) => props.onModel(event.target.value)}
          placeholder={t('auth_files.test_default_model')}
          disabled={props.disabled || props.batch.running}
        />
      </label>
      <Button
        variant="secondary"
        size="sm"
        onClick={props.onRetry}
        disabled={props.disabled || !props.canRetry || props.batch.running}
      >
        {t('auth_files.diagnostic_retry')}
      </Button>
      {props.batch.total > 0 && (
        <span className={styles.progress} role="status">
          {t('auth_files.diagnostic_progress', props.batch)}
        </span>
      )}
      {props.batch.running && (
        <Button variant="ghost" size="sm" onClick={props.onCancel} disabled={props.batch.cancelled}>
          {t('auth_files.diagnostic_cancel')}
        </Button>
      )}
      <p className={styles.notice}>
        {t('auth_files.diagnostic_notice')}
        {props.batch.cancelled && (
          <>
            {' '}
            {t(
              props.batch.running
                ? 'auth_files.diagnostic_stopping'
                : 'auth_files.diagnostic_stopped'
            )}
          </>
        )}
      </p>
    </div>
  );
}
