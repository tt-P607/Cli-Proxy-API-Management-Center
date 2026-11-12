import { useCallback, useEffect, useRef, useState } from 'react';
import { authFilesApi, type AuthFileTestResult } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem } from '@/types';
import { getAuthFileRefreshKey } from '../manualRefresh';
import { runDiagnosticQueue, type CredentialDiagnostic } from '../diagnostics';

export function useAuthFileDiagnostics(connectionRevision: number) {
  const [records, setRecords] = useState<Record<string, CredentialDiagnostic>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState({ running: false, completed: 0, total: 0, cancelled: false });
  const pending = useRef(new Set<string>());
  const queue = useRef<{ cancelled: boolean } | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    pending.current = new Set();
    setRecords({});
    setRunning(new Set());
    setBatch({ running: false, completed: 0, total: 0, cancelled: false });
    return () => {
      mounted.current = false;
      if (queue.current) queue.current.cancelled = true;
      queue.current = null;
    };
  }, [connectionRevision]);

  const test = useCallback(async (file: AuthFileItem, model?: string) => {
    const revision = apiClient.getConnectionRevision();
    const key = getAuthFileRefreshKey(file);
    if (pending.current.has(key)) return;
    const owner = pending.current;
    owner.add(key);
    setRunning(new Set(owner));
    let result: AuthFileTestResult;
    try {
      result = await authFilesApi.testCredential(
        file.name,
        model?.trim() || undefined,
        String(file.authIndex ?? '').trim() || undefined
      );
    } catch (error: unknown) {
      result = {
        status_code: 0,
        model,
        error: error instanceof Error ? error.message : String(error),
        error_source: 'transport',
      };
    }
    if (
      !mounted.current ||
      revision !== apiClient.getConnectionRevision() ||
      owner !== pending.current
    )
      return;
    setRecords((current) => ({ ...current, [key]: { result, testedAt: Date.now() } }));
    owner.delete(key);
    setRunning(new Set(owner));
  }, []);

  const startBatch = useCallback(
    async (files: AuthFileItem[], model?: string) => {
      if (queue.current || pending.current.size > 0 || files.length === 0) return;
      const targets = [
        ...new Map(files.map((file) => [getAuthFileRefreshKey(file), file])).values(),
      ];
      const token = { cancelled: false };
      queue.current = token;
      const revision = apiClient.getConnectionRevision();
      const current = () =>
        mounted.current &&
        queue.current === token &&
        revision === apiClient.getConnectionRevision();
      setBatch({ running: true, completed: 0, total: targets.length, cancelled: false });
      try {
        await runDiagnosticQueue(
          targets,
          (file) => test(file, model),
          () => !current() || token.cancelled,
          () => {
            if (current()) setBatch((state) => ({ ...state, completed: state.completed + 1 }));
          }
        );
      } finally {
        if (current()) {
          queue.current = null;
          setBatch((state) => ({ ...state, running: false }));
        }
      }
    },
    [test]
  );

  const cancel = useCallback(() => {
    if (queue.current) {
      queue.current.cancelled = true;
      setBatch((state) => ({ ...state, cancelled: true }));
    }
  }, []);

  return { records, running, batch, test, startBatch, cancel };
}
