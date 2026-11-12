import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getAuthFileRefreshKey } from '../src/features/authFiles/manualRefresh';
import {
  diagnosticCategory,
  matchesDiagnosticFilter,
  runDiagnosticQueue,
} from '../src/features/authFiles/diagnostics';

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
