import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { diagnosticFilters, type DiagnosticFilter } from '../diagnostics';
import styles from './AuthFileDiagnostics.module.scss';

export function AuthFileDiagnosticsToolbar(props: {
  filter: DiagnosticFilter;
  onFilter: (value: DiagnosticFilter) => void;
  model: string;
  models: string[];
  modelsLoading: boolean;
  onModel: (value: string) => void;
  disabled: boolean;
  canRetry: boolean;
  onRetry: () => void;
  batch: { running: boolean; completed: number; total: number; cancelled: boolean };
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const filterId = useId();
  const modelId = useId();
  const filterLabel = (value: DiagnosticFilter) => {
    if (value === 'all') return t('auth_files.problem_filter_all');
    if (value === 'success') return t('auth_files.test_result_success');
    if (value === '401' || value === '403' || value === '429') return value;
    return t(`auth_files.diagnostic_${value}`);
  };
  return (
    <div className={styles.toolbar}>
      <div className={styles.field}>
        <label htmlFor={filterId}>{t('auth_files.diagnostic_filter')}</label>
        <Select
          id={filterId}
          size="sm"
          value={props.filter}
          options={diagnosticFilters.map((value) => ({ value, label: filterLabel(value) }))}
          onChange={(value) => {
            const filter = diagnosticFilters.find((filter) => filter === value);
            if (filter) props.onFilter(filter);
          }}
          ariaLabel={t('auth_files.diagnostic_filter')}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={modelId}>{t('auth_files.test_model_label')}</label>
        <Select
          id={modelId}
          size="sm"
          value={props.model}
          options={[
            {
              value: '',
              label: t(props.modelsLoading ? 'common.loading' : 'auth_files.test_default_model'),
            },
            ...props.models.map((id) => ({ value: id, label: id })),
          ]}
          onChange={props.onModel}
          ariaLabel={t('auth_files.test_model_label')}
          placeholder={t('auth_files.test_default_model')}
          disabled={props.disabled || props.batch.running || props.modelsLoading}
        />
      </div>
      <div className={styles.toolbarActions}>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onCancel}
            disabled={props.batch.cancelled}
          >
            {t('auth_files.diagnostic_cancel')}
          </Button>
        )}
      </div>
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
