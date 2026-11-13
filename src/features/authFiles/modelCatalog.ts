import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileCatalogModel, AuthFileModelCatalog } from '@/services/api/authFiles';
import type { CredentialDiagnostic } from './diagnostics';
import { normalizeProviderKey } from './constants';
import { getAuthFileRefreshKey } from './manualRefresh';

export type CatalogCellState =
  | 'present'
  | 'partial'
  | 'disabled'
  | 'placeholder'
  | 'registered'
  | 'missing'
  | 'unregistered'
  | 'unknown'
  | 'na';

export type ModelColumn = {
  key: string;
  provider: string;
  id: string;
  label: string;
  models: AuthFileCatalogModel[];
  aliases: string[];
};

export const catalogKey = (catalog: AuthFileModelCatalog): string =>
  JSON.stringify([catalog.name, catalog.auth_index.trim()]);

export const credentialProvider = (file: AuthFileItem): string =>
  normalizeProviderKey(String(file.type ?? file.provider ?? ''));

// Only known Antigravity Gemini thinking variants share a column; tiered stays independent.
const modelFamily = (provider: string, id: string): string =>
  provider === 'antigravity' && id.startsWith('gemini-')
    ? id.replace(/-(?:low|medium|high|xhigh|disabled)$/, '')
    : id;

export const isDisabledCatalogEntry = (provider: string, model: AuthFileCatalogModel): boolean =>
  model.disabled === true ||
  (provider === 'antigravity' && model.id.startsWith('gemini-') && model.id.endsWith('-disabled'));

export function indexModelCatalogs(catalogs: readonly AuthFileModelCatalog[]) {
  return new Map(catalogs.map((catalog) => [catalogKey(catalog), catalog]));
}

export function buildModelColumns(
  files: readonly AuthFileItem[],
  catalogs: ReadonlyMap<string, AuthFileModelCatalog>,
  aliases: Readonly<Record<string, readonly OAuthModelAliasEntry[]>>
): ModelColumn[] {
  const columns = new Map<string, ModelColumn>();
  for (const file of files) {
    const catalog = catalogs.get(getAuthFileRefreshKey(file));
    if (!catalog || catalog.source === 'unknown') continue;
    const provider = credentialProvider(file);
    if (normalizeProviderKey(catalog.provider) !== provider) continue;
    for (const model of catalog.models) {
      const id = modelFamily(provider, model.id);
      const key = JSON.stringify([provider, id]);
      let column = columns.get(key);
      if (!column) {
        column = { key, provider, id, label: id, models: [], aliases: [] };
        columns.set(key, column);
      }
      const existing = column.models.find((entry) => entry.id === model.id);
      if (!existing) column.models.push({ ...model });
      else if (model.disabled !== true) existing.disabled = model.disabled;
    }
  }
  for (const column of columns.values()) {
    column.models.sort((a, b) => a.id.localeCompare(b.id));
    column.aliases = [
      ...new Set(
        Object.entries(aliases)
          .filter(([provider]) => normalizeProviderKey(provider) === column.provider)
          .flatMap(([, entries]) => entries)
          .filter((entry) => column.models.some((model) => model.id === entry.name.trim()))
          .map((entry) => entry.alias.trim())
          .filter(Boolean)
      ),
    ];
    column.label = column.aliases[0] ?? column.id;
  }
  return [...columns.values()].sort((a, b) =>
    `${a.provider}\0${a.id}`.localeCompare(`${b.provider}\0${b.id}`)
  );
}

export function catalogCell(
  file: AuthFileItem,
  catalog: AuthFileModelCatalog | undefined,
  column: ModelColumn
): { state: CatalogCellState; models: AuthFileCatalogModel[] } {
  if (credentialProvider(file) !== column.provider) return { state: 'na', models: [] };
  if (
    !catalog ||
    catalog.source === 'unknown' ||
    normalizeProviderKey(catalog.provider) !== column.provider
  )
    return { state: 'unknown', models: [] };
  const models = catalog.models.filter(
    (model) => modelFamily(column.provider, model.id) === column.id
  );
  if (!models.length)
    return { state: catalog.source === 'upstream' ? 'missing' : 'unregistered', models };
  const available = models.filter((model) => !isDisabledCatalogEntry(column.provider, model));
  if (!available.length)
    return {
      state: models.every((model) => model.disabled === true) ? 'disabled' : 'placeholder',
      models,
    };
  if (catalog.source === 'registered') return { state: 'registered', models };
  const variantCount = column.models.filter(
    (model) => !isDisabledCatalogEntry(column.provider, model)
  ).length;
  return { state: available.length < variantCount ? 'partial' : 'present', models };
}

export function columnHasDifferences(
  files: readonly AuthFileItem[],
  catalogs: ReadonlyMap<string, AuthFileModelCatalog>,
  column: ModelColumn
): boolean {
  const signatures = files
    .filter((file) => credentialProvider(file) === column.provider)
    .map((file) => {
      const cell = catalogCell(file, catalogs.get(getAuthFileRefreshKey(file)), column);
      return JSON.stringify([
        cell.state,
        cell.models.map((model) => [model.id, model.disabled]).sort(),
      ]);
    });
  return new Set(signatures).size > 1;
}

export function matchesModelColumn(column: ModelColumn, search: string): boolean {
  const value = search.trim().toLocaleLowerCase();
  return (
    !value ||
    [column.id, ...column.aliases, ...column.models.map((model) => model.id)].some((id) =>
      id.toLocaleLowerCase().includes(value)
    )
  );
}

export function diagnosticForColumn(
  record: CredentialDiagnostic | undefined,
  column: ModelColumn,
  aliases: readonly OAuthModelAliasEntry[]
): CredentialDiagnostic | undefined {
  const model = record?.result.model;
  if (!model) return undefined;
  const ids = new Set(column.models.map((entry) => entry.id));
  if (ids.has(model)) return record;
  return aliases.some((alias) => alias.alias === model && ids.has(alias.name)) ? record : undefined;
}
