import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { AuthFileItem } from '../src/types';
import {
  normalizeAuthFileModelCatalogs,
  type AuthFileModelCatalog,
} from '../src/services/api/authFiles';
import {
  buildModelColumns,
  catalogCell,
  columnHasDifferences,
  diagnosticForColumn,
  indexModelCatalogs,
  matchesModelColumn,
} from '../src/features/authFiles/modelCatalog';
import {
  AuthFileModelMatrixTable,
  AuthFileModelViewSwitch,
} from '../src/features/authFiles/components/AuthFileModelMatrix';
import { getAuthFileRefreshKey } from '../src/features/authFiles/manualRefresh';
import zhCN from '../src/i18n/locales/zh-CN.json';

const files: AuthFileItem[] = Array.from({ length: 6 }, (_, index) => ({
  name: `account-${index + 1}.json`,
  authIndex: `${index + 1}`,
  type: 'antigravity',
  disabled: index === 5,
}));
const aliases = {
  antigravity: [
    { name: 'gemini-4-hydrogen-xhigh', alias: '[反]gemini-4-hydrogen' },
    { name: 'gemini-3.8-flash-tiered', alias: '[反]gemini-3.8-flash-tiered' },
  ],
};
const catalogs: AuthFileModelCatalog[] = files.map((file, index) => ({
  name: file.name,
  auth_index: String(file.authIndex),
  provider: 'antigravity',
  source: 'upstream',
  models: [
    { id: 'gemini-3.8-flash-low' },
    { id: 'gemini-3.8-flash-medium' },
    { id: 'gemini-3.8-flash-high' },
    { id: 'gemini-3.8-flash-tiered' },
    ...(index === 0
      ? ['low', 'medium', 'high', 'xhigh'].map((level) => ({
          id: `gemini-4-hydrogen-${level}`,
          disabled: false,
        }))
      : [{ id: 'gemini-4-hydrogen-disabled', ...(index === 1 ? { disabled: true } : {}) }]),
  ],
}));

describe('account model matrix', () => {
  test('compares the real six-account shape: tiered is 6/6, Hydrogen is 1/6, including a disabled account', () => {
    const indexed = indexModelCatalogs(catalogs);
    const columns = buildModelColumns(files, indexed, aliases);
    expect(columns.map((column) => column.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.8-flash-tiered',
      'gemini-4-hydrogen',
    ]);
    const tiered = columns[1];
    const hydrogen = columns[2];
    expect(
      files.map((file) => catalogCell(file, indexed.get(getAuthFileRefreshKey(file)), tiered).state)
    ).toEqual(Array(6).fill('present'));
    expect(
      files.map(
        (file) => catalogCell(file, indexed.get(getAuthFileRefreshKey(file)), hydrogen).state
      )
    ).toEqual(['present', 'disabled', 'placeholder', 'placeholder', 'placeholder', 'placeholder']);
    expect(columnHasDifferences(files, indexed, tiered)).toBe(false);
    expect(columnHasDifferences(files, indexed, hydrogen)).toBe(true);
    expect(hydrogen.label).toBe('[反]gemini-4-hydrogen');
    expect(matchesModelColumn(hydrogen, '[反]gemini-4')).toBe(true);
    expect(matchesModelColumn(hydrogen, 'HYDROGEN-XHIGH')).toBe(true);
    expect(matchesModelColumn(hydrogen, 'tiered')).toBe(false);
  });

  describe('account model catalog request lifecycle', () => {
    test('keeps stable credential sets cached and exposes explicit reload failures without stale data', async () => {
      const harness = catalogHarness();
      harness.render();
      expect(harness.requests).toHaveLength(1);
      harness.requests[0].resolve(catalogs);
      await harness.settle(0);
      expect(harness.render().catalogs).toEqual(catalogs);
      expect(harness.requests).toHaveLength(1);
      harness.render().reload();
      harness.render();
      expect(harness.requests).toHaveLength(2);
      expect(harness.render().catalogs).toEqual([]);
      harness.requests[1].reject(new Error('HTTP 503'));
      await harness.settle(1);
      expect(harness.render().error).toBe('HTTP 503');
      expect(harness.render().loading).toBe(false);
      expect(harness.render().catalogs).toEqual([]);
    });

    test('discards old responses across connection switches and after unmount', async () => {
      const harness = catalogHarness();
      harness.render();
      harness.switchConnection();
      harness.switchConnection();
      expect(harness.requests).toHaveLength(3);
      harness.requests[0].resolve(catalogs);
      harness.requests[1].reject(new Error('old connection error'));
      await Promise.all([harness.settle(0), harness.settle(1)]);
      expect(harness.render().catalogs).toEqual([]);
      expect(harness.render().error).toBe('');
      harness.requests[2].resolve([catalogs[0]]);
      await harness.settle(2);
      expect(harness.render().catalogs).toEqual([catalogs[0]]);
      harness.render().reload();
      harness.render();
      harness.unmount();
      harness.requests[3].resolve(catalogs);
      await harness.settle(3);
      expect(harness.render().catalogs).toEqual([]);
    });
  });

  function catalogHarness() {
    const states: unknown[] = [];
    let stateIndex = 0;
    let revision = 1;
    let dependencies: unknown[] = [];
    let cleanup: (() => void) | undefined;
    let effect: (() => void) | undefined;
    const requests: Array<ReturnType<typeof Promise.withResolvers<AuthFileModelCatalog[]>>> = [];
    const env = {
      useState: (initial: unknown) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [
          states[index],
          (next: unknown) => {
            states[index] = typeof next === 'function' ? next(states[index]) : next;
          },
        ];
      },
      useCallback: (callback: unknown) => callback,
      useEffect: (setup: () => () => void, nextDependencies: unknown[]) => {
        if (
          nextDependencies.every((value, index) => Object.is(value, dependencies[index])) &&
          dependencies.length === nextDependencies.length
        )
          return;
        dependencies = nextDependencies;
        effect = () => {
          cleanup?.();
          cleanup = setup();
        };
      },
      authFilesApi: {
        getModelCatalogs: () => {
          const request = Promise.withResolvers<AuthFileModelCatalog[]>();
          requests.push(request);
          return request.promise;
        },
      },
      apiClient: { getConnectionRevision: () => revision },
    };
    const source = readFileSync('src/features/authFiles/hooks/useAuthFileModelCatalogs.ts', 'utf8');
    const body = source
      .slice(source.indexOf('export function'))
      .replace('export function', 'function');
    const js = ts.transpileModule(`${body}\nreturn useAuthFileModelCatalogs('same-accounts', 0);`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const hook = new Function(...Object.keys(env), js);
    const render = (): {
      catalogs: AuthFileModelCatalog[];
      loading: boolean;
      error: string;
      reload: () => void;
    } => {
      stateIndex = 0;
      const result = hook(...Object.values(env));
      const pending = effect;
      effect = undefined;
      pending?.();
      return result;
    };
    return {
      requests,
      render,
      switchConnection: () => {
        revision++;
        render();
      },
      unmount: () => cleanup?.(),
      settle: async (index: number) => {
        await Promise.allSettled([requests[index].promise]);
        await Promise.resolve();
      },
    };
  }

  test('does not treat unknown, known empty or runtime registration as upstream permission', () => {
    const upstream = catalogs[0];
    const column = buildModelColumns(files, indexModelCatalogs(catalogs), aliases)[1];
    expect(catalogCell(files[0], undefined, column).state).toBe('unknown');
    expect(
      catalogCell(files[0], { ...upstream, source: 'unknown', models: [] }, column).state
    ).toBe('unknown');
    expect(catalogCell(files[0], { ...upstream, models: [] }, column).state).toBe('missing');
    expect(catalogCell(files[0], { ...upstream, source: 'registered' }, column).state).toBe(
      'registered'
    );
    expect(
      catalogCell(files[0], { ...upstream, source: 'registered', models: [] }, column).state
    ).toBe('unregistered');
    expect(catalogCell(files[0], { ...upstream, provider: 'codex' }, column).state).toBe('unknown');
    expect(catalogCell({ ...files[0], type: 'codex' }, upstream, column).state).toBe('na');
  });

  test('isolates same-name credential catalogs by auth index', () => {
    const sameName = [files[0], { ...files[1], name: files[0].name }];
    const snapshots = [catalogs[0], { ...catalogs[1], name: files[0].name }];
    const indexed = indexModelCatalogs(snapshots);
    const column = buildModelColumns(sameName, indexed, aliases).find(
      (item) => item.id === 'gemini-4-hydrogen'
    )!;
    expect(
      catalogCell(sameName[0], indexed.get(getAuthFileRefreshKey(sameName[0])), column).state
    ).toBe('present');
    expect(
      catalogCell(sameName[1], indexed.get(getAuthFileRefreshKey(sameName[1])), column).state
    ).toBe('disabled');
  });

  test('distinguishes partial thinking levels even when both accounts have some variants', () => {
    const reduced = {
      ...catalogs[1],
      models: catalogs[0].models.filter((model) => !model.id.endsWith('-xhigh')),
    };
    const indexed = indexModelCatalogs([catalogs[0], reduced]);
    const column = buildModelColumns(files.slice(0, 2), indexed, aliases).find(
      (item) => item.id === 'gemini-4-hydrogen'
    )!;
    expect(catalogCell(files[1], reduced, column).state).toBe('partial');
    expect(columnHasDifferences(files.slice(0, 2), indexed, column)).toBe(true);
    expect(
      columnHasDifferences([files[0], { name: 'codex', type: 'codex' }], indexed, column)
    ).toBe(false);
  });

  test('matches recent tests only to their exact native model or configured alias, never every cell', () => {
    const columns = buildModelColumns(files, indexModelCatalogs(catalogs), aliases);
    const result = {
      result: { status_code: 403, model: '[反]gemini-3.8-flash-tiered' },
      testedAt: 123,
    };
    expect(diagnosticForColumn(result, columns[1], aliases.antigravity)).toBe(result);
    expect(diagnosticForColumn(result, columns[0], aliases.antigravity)).toBeUndefined();
    expect(diagnosticForColumn(result, columns[2], aliases.antigravity)).toBeUndefined();
    expect(
      diagnosticForColumn(
        { result: { status_code: 200 }, testedAt: 123 },
        columns[1],
        aliases.antigravity
      )
    ).toBeUndefined();
  });

  test('validates the new API shape without fabricating an empty successful catalog on errors', () => {
    expect(normalizeAuthFileModelCatalogs({ catalogs })).toEqual(catalogs);
    expect(normalizeAuthFileModelCatalogs({ catalogs: [] })).toEqual([]);
    expect(() => normalizeAuthFileModelCatalogs({ models: [] })).toThrow(
      'Invalid account model catalog response'
    );
    expect(() =>
      normalizeAuthFileModelCatalogs({ catalogs: [{ ...catalogs[0], source: 'static' }] })
    ).toThrow('Invalid account model catalog entry');
    expect(() =>
      normalizeAuthFileModelCatalogs({
        catalogs: [{ ...catalogs[0], models: [{ id: 'x', disabled: 'false' }] }],
      })
    ).toThrow('Invalid account model catalog model');
    expect(
      normalizeAuthFileModelCatalogs({
        catalogs: [
          {
            ...catalogs[0],
            models: [{ id: 'old-model' }, { id: 'disabled-model', disabled: true }],
          },
        ],
      })[0].models
    ).toEqual([{ id: 'old-model' }, { id: 'disabled-model', disabled: true }]);
  });

  test('renders all six accounts and model coverage as an accessible table, with disabled and unknown distinct', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } });
    const props = {
      files,
      allFiles: files,
      selected: new Set<string>(),
      selectedOnly: false,
      onSelectedOnlyChange() {},
      aliases,
      records: {},
      running: new Set<string>(),
      testDisabled: false,
      refreshRevision: 0,
      onToggleSelect() {},
      onTest() {},
      onBatchTest() {},
      onCopy() {},
      catalogs,
      readAt: 123,
      loading: false,
      error: '',
      onRefresh() {},
    };
    const render = (override = {}) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(AuthFileModelMatrixTable, { ...props, ...override })
        )
      );
    const markup = render();
    expect(markup.match(/scope="row"/g)).toHaveLength(6);
    expect(markup).toContain('列有 6 / 6');
    expect(markup).toContain('列有 1 / 6');
    expect(markup).toContain('account-6.json');
    expect(markup).toContain('上游禁用');
    expect(markup).toContain('禁用入口');
    expect(markup).toContain('本页读取');
    expect(markup).not.toContain('auth_files.matrix.');
    expect(render({ catalogs: catalogs.slice(0, 5) })).toContain(
      'account-6.json · [反]gemini-4-hydrogen · 未知'
    );
    const failure = render({ error: 'HTTP 503', catalogs: [] });
    expect(failure).toContain('role="alert"');
    expect(failure).toContain('HTTP 503');
    expect(failure).not.toContain('<table');
    expect(render({ loading: true })).not.toContain('<table');
    const toggle = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(AuthFileModelViewSwitch, { value: 'models', onChange() {} })
      )
    );
    expect(toggle).toContain('aria-pressed="true">账号 × 模型');
  });
});
