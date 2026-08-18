import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { authFilesApi, type AuthFileTestResult } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { AuthFileExcludedModelsField } from './AuthFileExcludedModelsField';
import styles from './AuthFileDetailsSheet.module.scss';

/** API 边界归一化补写的派生字段——INFO 视图里只展示后端原始形状，避免重复噪音。 */
const DERIVED_INFO_KEYS = [
  'successCount',
  'failureCount',
  'recentRequests',
  'runtimeOnly',
  'authIndex',
  'statusMessage',
  'modified',
  // 'email' 不在此列：后端原始键名与 camelCase 同形，删掉会藏起真实数据。
  'projectId',
];

export type AuthFileDetailsSheetProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

/**
 * 凭证详情/编辑抽屉：替代旧的居中 Modal，与提供商工作台的 Sheet 模式一致。
 * 脏状态下关闭（Escape/遮罩/×/取消）先走确认对话框。
 */
export function AuthFileDetailsSheet(props: AuthFileDetailsSheetProps) {
  const { t } = useTranslation();
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);

  // 测试请求本地状态
  const [testModel, setTestModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AuthFileTestResult | null>(null);

  const confirmClose = useCallback((): boolean | Promise<boolean> => {
    if (!dirty || editor?.saving === true) return true;
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('providersPage.unsavedChanges.title'),
        message: t('providersPage.unsavedChanges.message'),
        variant: 'danger',
        confirmText: t('providersPage.unsavedChanges.discard'),
        cancelText: t('providersPage.unsavedChanges.keepEditing'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [dirty, editor?.saving, showConfirmation, t]);

  const handleCancelClick = useCallback(() => {
    void Promise.resolve(confirmClose()).then((ok) => {
      if (ok) {
        setTestResult(null);
        onClose();
      }
    });
  }, [confirmClose, onClose]);

  const formatJsonText = (text: string) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const previewText = formatJsonText(updatedText);
  const invalidContentPreview = editor?.invalidContentPreview ?? '';
  const fileInfoText = editor?.fileInfoText ?? '';
  const displayInfoText = useMemo(() => {
    if (!fileInfoText) return '';
    try {
      const parsed = JSON.parse(fileInfoText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        DERIVED_INFO_KEYS.forEach((key) => {
          delete record[key];
        });
        return JSON.stringify(record, null, 2);
      }
    } catch {
      /* 非 JSON 原样展示 */
    }
    return fileInfoText;
  }, [fileInfoText]);

  const handleTestCredential = useCallback(async () => {
    if (!editor?.fileName || testing) return;
    setTesting(true);
    try {
      const res = await authFilesApi.testCredential(editor.fileName, testModel.trim() || undefined);
      setTestResult(res);
      if (res.status_code === 200) {
        showNotification(t('auth_files.test_result_success'), 'success');
      } else {
        showNotification(
          `${t('auth_files.test_result_failed')}: ${res.error ?? res.message}`,
          'error'
        );
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setTestResult({
        status_code: 0,
        error: errMsg,
        message: t('auth_files.test_result_failed'),
      });
      showNotification(`${t('auth_files.test_result_failed')}: ${errMsg}`, 'error');
    } finally {
      setTesting(false);
    }
  }, [editor?.fileName, showNotification, t, testModel, testing]);

  const formattedTestResponse = useMemo(() => {
    if (!testResult) return '';
    if (testResult.response) {
      try {
        return JSON.stringify(JSON.parse(testResult.response), null, 2);
      } catch {
        return testResult.response;
      }
    }
    if (testResult.error) {
      return testResult.error;
    }
    return testResult.message ?? '';
  }, [testResult]);

  return (
    <Sheet
      open={Boolean(editor)}
      onClose={() => {
        setTestResult(null);
        onClose();
      }}
      confirmClose={confirmClose}
      size="md"
      closeDisabled={editor?.saving === true}
      eyebrow={t('auth_files.prefix_proxy_button')}
      title={editor?.fileName ?? ''}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleCancelClick}
            disabled={editor?.saving === true}
          >
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError) ||
              Boolean(editor?.weightError)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.editor}>
          {editor.loading ? (
            <div className={styles.loading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.error}>{editor.error}</div>}
              <div className={styles.jsonWrapper}>
                <label className={styles.label}>{t('auth_files.prefix_proxy_info_label')}</label>
                <textarea className={styles.textarea} rows={8} readOnly value={displayInfoText} />
              </div>
              <div className={styles.jsonWrapper}>
                <label className={styles.label}>
                  {editor.json
                    ? t('auth_files.prefix_proxy_source_label')
                    : t('auth_files.prefix_proxy_invalid_content_label')}
                </label>
                {editor.json ? (
                  <textarea className={styles.textarea} rows={10} readOnly value={previewText} />
                ) : (
                  <pre className={styles.invalidPreview}>{invalidContentPreview}</pre>
                )}
              </div>
              {editor.json && (
                <div className={styles.fields}>
                  <Input
                    label={t('auth_files.prefix_label')}
                    value={editor.prefix}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('prefix', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.proxy_url_label')}
                    value={editor.proxyUrl}
                    placeholder={t('auth_files.proxy_url_placeholder')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('proxyUrl', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.project_id_label')}
                    value={editor.projectId}
                    placeholder={t('auth_files.project_id_placeholder')}
                    hint={t('auth_files.project_id_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('projectId', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.priority_label')}
                    value={editor.priority}
                    placeholder={t('auth_files.priority_placeholder')}
                    hint={t('auth_files.priority_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('priority', e.target.value)}
                  />
                  <Input
                    label={t('auth_files.weight_label')}
                    type="number"
                    step="1"
                    max={MAX_CREDENTIAL_WEIGHT}
                    value={editor.weight}
                    placeholder="1"
                    hint={t('auth_files.weight_hint')}
                    error={editor.weightError ?? undefined}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('weight', e.target.value)}
                  />
                  <div className="form-group">
                    <label>{t('auth_files.disable_cooling_label')}</label>
                    <ToggleSwitch
                      checked={editor.disableCooling}
                      onChange={(value) => onChange('disableCooling', value)}
                      disabled={disableControls || editor.saving || !editor.json}
                      ariaLabel={t('auth_files.disable_cooling_label')}
                    />
                    <div className="hint">{t('auth_files.disable_cooling_hint')}</div>
                  </div>
                  {supportsAuthFileWebsockets(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.websockets_label')}</label>
                      <ToggleSwitch
                        checked={editor.websockets}
                        onChange={(value) => onChange('websockets', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.websockets_label')}
                      />
                      <div className="hint">{t('auth_files.websockets_hint')}</div>
                    </div>
                  )}
                  {supportsAuthFileUsingApi(editor.providerKey) && (
                    <div className="form-group">
                      <label>{t('auth_files.using_api_label')}</label>
                      <ToggleSwitch
                        checked={editor.usingApi}
                        onChange={(value) => onChange('usingApi', value)}
                        disabled={disableControls || editor.saving || !editor.json}
                        ariaLabel={t('auth_files.using_api_label')}
                      />
                      <div className="hint">{t('auth_files.using_api_hint')}</div>
                    </div>
                  )}
                  <AuthFileExcludedModelsField
                    fileName={editor.fileName}
                    value={editor.excludedModelsText}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(value) => onChange('excludedModelsText', value)}
                  />
                  <div className="form-group">
                    <label>{t('auth_files.headers_label')}</label>
                    <textarea
                      className={`input ${editor.headersError ? styles.textareaInvalid : ''}`}
                      value={editor.headersText}
                      placeholder={t('auth_files.headers_placeholder')}
                      rows={4}
                      aria-invalid={Boolean(editor.headersError)}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('headersText', e.target.value)}
                    />
                    {editor.headersError && <div className="error-box">{editor.headersError}</div>}
                    <div className="hint">{t('auth_files.headers_hint')}</div>
                  </div>
                  <Input
                    label={t('auth_files.note_label')}
                    value={editor.note}
                    placeholder={t('auth_files.note_placeholder')}
                    hint={t('auth_files.note_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('note', e.target.value)}
                  />

                  {/* 凭证测试请求与响应详情 */}
                  <section className={styles.testSection}>
                    <div className={styles.testHeader}>
                      <span className={styles.testTitle}>{t('auth_files.test_section_title')}</span>
                      <span className={styles.testDesc}>{t('auth_files.test_section_desc')}</span>
                    </div>
                    <div className={styles.testForm}>
                      <div className={styles.testModelInput}>
                        <Input
                          label={t('auth_files.test_model_label')}
                          value={testModel}
                          placeholder={t('auth_files.test_model_placeholder')}
                          disabled={testing || disableControls}
                          onChange={(e) => setTestModel(e.target.value)}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => void handleTestCredential()}
                        loading={testing}
                        disabled={testing || disableControls}
                      >
                        {testing ? t('auth_files.test_running') : t('auth_files.test_button')}
                      </Button>
                    </div>

                    {testResult && (
                      <div className={styles.testResultCard}>
                        <div className={styles.testResultMeta}>
                          <div className={styles.testMetaLeft}>
                            <span
                              className={
                                testResult.status_code === 200
                                  ? styles.testBadgeSuccess
                                  : styles.testBadgeError
                              }
                            >
                              {testResult.status_code === 200
                                ? `200 OK (${t('auth_files.test_result_success')})`
                                : `${testResult.status_code || 'Error'} (${t('auth_files.test_result_failed')})`}
                            </span>
                            {testResult.latency_ms !== undefined && (
                              <span className={styles.testLatency}>
                                {t('auth_files.test_latency')}: {testResult.latency_ms}ms
                              </span>
                            )}
                            {testResult.model && (
                              <span className={styles.testLatency}>
                                ({testResult.model})
                              </span>
                            )}
                          </div>
                          {formattedTestResponse && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                void onCopyText(formattedTestResponse);
                                showNotification(t('auth_files.test_response_copied'), 'success');
                              }}
                            >
                              {t('auth_files.test_copy_response')}
                            </Button>
                          )}
                        </div>
                        <pre className={styles.testResponsePre}>{formattedTestResponse}</pre>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
