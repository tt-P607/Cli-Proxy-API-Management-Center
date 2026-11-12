import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { AuthFileDiagnosticsToolbar } from '../src/features/authFiles/components/AuthFileDiagnosticsToolbar';
import zhCN from '../src/i18n/locales/zh-CN.json';
import { getAuthFileRefreshKey } from '../src/features/authFiles/manualRefresh';
import {
  diagnosticCategory,
  diagnosticModelIds,
  matchesDiagnosticFilter,
  runDiagnosticQueue,
} from '../src/features/authFiles/diagnostics';

describe('diagnostic model selection', () => {
  test('loads provider catalogs in list mode, retaining successful catalogs and reporting failures', async () => {
    const harness = providerModelsHarness();
    expect(harness.requests.map((request) => request.provider)).toEqual(['antigravity', 'codex']);
    expect(harness.loading).toBe(true);
    harness.requests[0].resolve([{ id: 'model-a' }]);
    harness.requests[1].reject(new Error('catalog unavailable'));
    await Promise.allSettled(harness.requests.map((request) => request.promise));
    expect(harness.models).toEqual({ antigravity: [{ id: 'model-a' }] });
    expect(harness.loading).toBe(false);
    expect(harness.notifications).toEqual([
      ['notification.load_failed: codex — catalog unavailable', 'error'],
    ]);
  });

  test('discards provider catalog responses after the model-loading effect is cancelled', async () => {
    const harness = providerModelsHarness();
    harness.cancel();
    harness.requests[0].resolve([{ id: 'outdated' }]);
    harness.requests[1].reject(new Error('outdated failure'));
    await Promise.allSettled(harness.requests.map((request) => request.promise));
    expect(harness.models).toEqual({});
    expect(harness.notifications).toEqual([]);
  });

  test('filters the provider catalog and deduplicates model IDs without depending on enabled accounts', () => {
    const catalog = {
      antigravity: [{ id: 'model-b' }, { id: ' model-a ' }],
      codex: [{ id: 'model-b' }, { id: 'model-c' }, { id: '' }],
    };
    expect(diagnosticModelIds(catalog, 'antigravity')).toEqual(['model-a', 'model-b']);
    expect(diagnosticModelIds(catalog, 'all')).toEqual(['model-a', 'model-b', 'model-c']);
    expect(diagnosticModelIds(catalog, 'claude')).toEqual([]);
    expect(diagnosticModelIds({}, 'all')).toEqual([]);
  });

  test('renders an actual model dropdown with associated labels, selected model and loading state', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } });
    const render = (modelsLoading: boolean) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(AuthFileDiagnosticsToolbar, {
            filter: 'all',
            onFilter: () => {},
            model: modelsLoading ? '' : 'model-a',
            models: ['model-a', 'model-b'],
            modelsLoading,
            onModel: () => {},
            disabled: false,
            canRetry: false,
            onRetry: () => {},
            batch: { running: false, completed: 0, total: 0, cancelled: false },
            onCancel: () => {},
          })
        )
      );
    const markup = render(false);
    expect(markup).not.toContain('<input');
    expect(markup.match(/aria-haspopup="listbox"/g)).toHaveLength(2);
    expect(markup).toContain('>model-a</span>');
    const labels = [...markup.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)];
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label[1]).not.toContain('<div');
    const modelId = markup.match(/<label for="([^"]+)">测试模型<\/label>/)?.[1];
    expect(modelId).toBeTruthy();
    expect(markup).toContain(`id="${modelId}"`);
    const loadingTrigger = render(true).match(/<button[^>]*aria-label="测试模型"[^>]*>/)?.[0];
    expect(loadingTrigger).toContain('disabled=""');
  });
});

function providerModelsHarness() {
  const states: unknown[] = [];
  const effects: Array<() => undefined | (() => void)> = [];
  const notifications: unknown[][] = [];
  const requests: Array<{
    provider: string;
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  const env = {
    useState: (initial: unknown) => {
      const index = states.push(initial) - 1;
      return [
        initial,
        (value: unknown) => {
          states[index] = value;
        },
      ];
    },
    useRef: (current: unknown) => ({ current }),
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => undefined | (() => void)) => effects.push(effect),
    useTranslation: () => ({ t: (key: string) => key }),
    useNotificationStore: () => ({
      showNotification: (...args: unknown[]) => notifications.push(args),
      showConfirmation: () => {},
    }),
    authFilesApi: {
      getModelDefinitions: (provider: string) => {
        const { promise, resolve, reject } = Promise.withResolvers<unknown>();
        requests.push({ provider, promise, resolve, reject });
        return promise;
      },
    },
  };
  const source = readFileSync('src/features/authFiles/hooks/useAuthFilesOauth.tsx', 'utf8');
  const body = source
    .slice(source.indexOf('export function useAuthFilesOauth'))
    .replace('export function', 'function');
  const js = ts.transpileModule(
    `${body}\nreturn useAuthFilesOauth({ files: [
    { name: 'disabled.json', type: 'antigravity', disabled: true },
    { name: 'codex.json', type: 'codex' }
  ] });`,
    {
      fileName: 'hook.tsx',
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }
  ).outputText;
  new Function(...Object.keys(env), js)(...Object.values(env));
  const cancel = effects[1]()!;
  return {
    requests,
    notifications,
    cancel,
    get models() {
      return states[4];
    },
    get loading() {
      return states[5];
    },
  };
}

function diagnosticHarness() {
  const states: unknown[] = [];
  const requests: Array<{
    args: unknown[];
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  let revision = 1;
  let setup: () => () => void;
  let cleanup: () => void;
  const env = {
    useState: (initial: unknown) => {
      const index = states.push(initial) - 1;
      return [
        initial,
        (next: unknown) => {
          states[index] = typeof next === 'function' ? next(states[index]) : next;
        },
      ];
    },
    useRef: (current: unknown) => ({ current }),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => () => void) => {
      setup = effect;
      cleanup = effect();
    },
    apiClient: { getConnectionRevision: () => revision },
    authFilesApi: {
      testCredential: (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          requests.push({ args, resolve, reject });
        }),
    },
    getAuthFileRefreshKey,
    runDiagnosticQueue,
  };
  const source = readFileSync('src/features/authFiles/hooks/useAuthFileDiagnostics.ts', 'utf8');
  const body = source
    .slice(source.indexOf('export function useAuthFileDiagnostics'))
    .replace('export function', 'function');
  const js = ts.transpileModule(`${body}\nreturn useAuthFileDiagnostics(1);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const actions = new Function(...Object.keys(env), js)(...Object.values(env));
  return {
    ...actions,
    requests,
    get records() {
      return states[0] as Record<
        string,
        { result: { status_code: number; error?: string; model?: string; error_source?: string } }
      >;
    },
    switchConnection: () => {
      revision++;
      cleanup();
      cleanup = setup();
    },
    unmount: () => cleanup(),
  };
}

describe('credential diagnostic lifecycle', () => {
  test('tests a disabled identity, prevents duplicates and preserves raw results', async () => {
    const h = diagnosticHarness();
    const file = { name: 'account.json', authIndex: 'selected', disabled: true };
    const pending = h.test(file, ' model-a ');
    await h.test(file, 'model-b');
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].args).toEqual(['account.json', 'model-a', 'selected']);
    const result = { status_code: 403, model: 'model-a', error: 'original upstream error' };
    h.requests[0].resolve(result);
    await pending;
    expect(h.records[getAuthFileRefreshKey(file)].result).toEqual(result);
    expect(file.disabled).toBe(true);
    h.unmount();
  });

  test('surfaces management/transport errors separately from account HTTP status', async () => {
    const h = diagnosticHarness();
    const file = { name: 'account.json' };
    const pending = h.test(file);
    h.requests[0].reject(new Error('connection failed'));
    await pending;
    expect(h.records[getAuthFileRefreshKey(file)].result).toEqual({
      status_code: 0,
      error: 'connection failed',
      error_source: 'transport',
      model: undefined,
    });
    h.unmount();
  });

  test('connection changes stop queued work and discard old results, including ABA switches', async () => {
    const h = diagnosticHarness();
    const pending = h.startBatch([
      { name: 'one.json' },
      { name: 'two.json' },
      { name: 'three.json' },
    ]);
    expect(h.requests).toHaveLength(2);
    h.switchConnection();
    h.switchConnection();
    h.requests.forEach((request) => request.resolve({ status_code: 200 }));
    await pending;
    expect(h.requests).toHaveLength(2);
    expect(h.records).toEqual({});
    h.unmount();
  });
});

describe('credential diagnostic results', () => {
  test('distinguishes raw HTTP errors from local cooldowns and transport failures', () => {
    for (const status of [401, 403, 429]) {
      const record = { testedAt: 1, result: { status_code: status, error: 'raw upstream error' } };
      expect(diagnosticCategory(record)).toBe(String(status));
      expect(matchesDiagnosticFilter(record, 'success')).toBe(false);
      expect(matchesDiagnosticFilter(record, 'all')).toBe(true);
    }
    expect(diagnosticCategory({ testedAt: 1, result: { status_code: 200 } })).toBe('success');
    expect(diagnosticCategory({ testedAt: 1, result: { status_code: 400 } })).toBe('other');
    expect(diagnosticCategory({ testedAt: 1, result: { status_code: 0 } })).toBe('local');
    const cooldown = { testedAt: 1, result: { status_code: 429, error_source: 'local_cooldown' } };
    expect(diagnosticCategory(cooldown)).toBe('local');
    expect(matchesDiagnosticFilter(cooldown, '429')).toBe(false);
    expect(matchesDiagnosticFilter(undefined, 'untested')).toBe(true);
    expect(matchesDiagnosticFilter(undefined, '403')).toBe(false);
  });

  test('runs all targets with no more than two concurrent requests', async () => {
    let active = 0;
    let maximum = 0;
    let completed = 0;
    const called: number[] = [];
    await runDiagnosticQueue(
      [1, 2, 3, 4, 5],
      async (target) => {
        called.push(target);
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        active--;
      },
      () => false,
      () => {
        completed++;
      }
    );
    expect(maximum).toBe(2);
    expect(completed).toBe(5);
    expect(called).toEqual([1, 2, 3, 4, 5]);
  });

  test('cancels queued work without pretending to cancel in-flight requests', async () => {
    const started: number[] = [];
    const release: Array<() => void> = [];
    let stopped = false;
    let completed = 0;
    const pending = runDiagnosticQueue(
      [1, 2, 3, 4],
      (target) => {
        started.push(target);
        return new Promise<void>((resolve) => release.push(resolve));
      },
      () => stopped,
      () => {
        completed++;
      }
    );
    expect(started).toEqual([1, 2]);
    stopped = true;
    expect(completed).toBe(0);
    release.forEach((resolve) => resolve());
    await pending;
    expect(started).toEqual([1, 2]);
    expect(completed).toBe(2);
  });
});
