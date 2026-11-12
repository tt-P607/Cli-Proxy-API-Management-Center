import type { AuthFileTestResult } from '@/services/api/authFiles';

export type CredentialDiagnostic = {
  result: AuthFileTestResult;
  testedAt: number;
};

export const diagnosticFilters = [
  'all',
  'untested',
  'success',
  '401',
  '403',
  '429',
  'other',
  'local',
] as const;
export type DiagnosticFilter = (typeof diagnosticFilters)[number];

export function diagnosticCategory(
  record?: CredentialDiagnostic
): Exclude<DiagnosticFilter, 'all'> {
  if (!record) return 'untested';
  const { status_code: status, error_source: source } = record.result;
  if (source === 'local_cooldown' || status === 0) return 'local';
  if (status >= 200 && status < 300) return 'success';
  if (status === 401 || status === 403 || status === 429)
    return String(status) as '401' | '403' | '429';
  return 'other';
}

export function matchesDiagnosticFilter(
  record: CredentialDiagnostic | undefined,
  filter: DiagnosticFilter
): boolean {
  return filter === 'all' || diagnosticCategory(record) === filter;
}

export async function runDiagnosticQueue<T>(
  targets: readonly T[],
  test: (target: T) => Promise<void>,
  stopped: () => boolean,
  onComplete: () => void
): Promise<void> {
  let next = 0;
  async function worker() {
    while (!stopped() && next < targets.length) {
      const target = targets[next++];
      await test(target);
      onComplete();
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
}
