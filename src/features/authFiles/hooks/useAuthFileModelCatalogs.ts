import { useCallback, useEffect, useState } from 'react';
import { authFilesApi, type AuthFileModelCatalog } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';

export function useAuthFileModelCatalogs(credentialKey: string, refreshRevision: number) {
  const connectionRevision = apiClient.getConnectionRevision();
  const [snapshot, setSnapshot] = useState<{
    connection: number;
    catalogs: AuthFileModelCatalog[];
    readAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setSnapshot(null);
    const current = () => !cancelled && connectionRevision === apiClient.getConnectionRevision();
    void authFilesApi
      .getModelCatalogs()
      .then((catalogs) => {
        if (current())
          setSnapshot({ connection: connectionRevision, catalogs, readAt: Date.now() });
      })
      .catch((failure: unknown) => {
        if (current()) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, connectionRevision, credentialKey, refreshRevision]);

  const currentSnapshot = snapshot?.connection === connectionRevision ? snapshot : null;
  return {
    catalogs: currentSnapshot?.catalogs ?? [],
    readAt: currentSnapshot?.readAt,
    loading,
    error,
    reload,
  };
}
