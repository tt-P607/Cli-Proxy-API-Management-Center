import { afterEach, describe, expect, test } from 'bun:test';
import type { AxiosAdapter, AxiosInstance } from 'axios';
import { apiClient } from '../src/services/api/client';
import { usageApi } from '../src/services/api/usage';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('v8 management transport', () => {
  test('usage read/export/import/reset reach their v8 routes and preserve returned counts', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway',
      managementKey: 'fixture-only',
    });
    const instance = (apiClient as unknown as { instance: AxiosInstance }).instance;
    const previousAdapter = instance.defaults.adapter;
    const requests: Array<{ method?: string; baseURL?: string; url?: string; data?: string }> = [];
    const usageSnapshot = {
      usage: {
        apis: { gemini: { total_requests: 7, total_tokens: 1234 } },
      },
    };
    const adapter: AxiosAdapter = async (config) => {
      requests.push({
        method: config.method,
        baseURL: config.baseURL,
        url: config.url,
        data: config.data,
      });
      return {
        data: usageSnapshot,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
    instance.defaults.adapter = adapter;
    try {
      expect(await usageApi.getUsage()).toEqual(usageSnapshot);
      expect(await usageApi.exportUsage()).toEqual(usageSnapshot);
      const importPayload = { version: 1, usage: usageSnapshot.usage };
      expect(await usageApi.importUsage(importPayload)).toEqual(usageSnapshot);
      expect(await usageApi.resetAllStatistics()).toEqual(usageSnapshot);
      expect(requests.map(({ method, baseURL, url }) => [method, baseURL, url])).toEqual([
        ['get', 'https://proxy.invalid/gateway/v8/management', '/observability/usage'],
        ['get', 'https://proxy.invalid/gateway/v8/management', '/observability/usage/export'],
        ['post', 'https://proxy.invalid/gateway/v8/management', '/observability/usage/import'],
        ['post', 'https://proxy.invalid/gateway/v8/management', '/observability/usage/reset'],
      ]);
      expect(requests[2]?.data).toBe(JSON.stringify(importPayload));
      expect(requests[3]?.data).toBe('{}');
      expect((await usageApi.getUsage()).usage).toEqual(usageSnapshot.usage);
    } finally {
      instance.defaults.adapter = previousAdapter;
    }
  });

  test('uses the v8 prefix, bearer authentication and bare JSON scalar writes', async () => {
    apiClient.setConfig({
      apiBase: 'https://proxy.invalid/gateway/v8/management',
      managementKey: 'fixture-only',
    });
    const adapter: AxiosAdapter = async (config) => {
      expect(config.baseURL).toBe('https://proxy.invalid/gateway/v8/management');
      expect(config.url).toBe('/config/observability/logs/debug');
      expect(config.headers.Authorization).toBe('Bearer fixture-only');
      expect(config.data).toBe('false');
      return { data: { status: 'ok' }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await apiClient.put('/config/observability/logs/debug', false, { adapter });
  });

  test('retains backend version and plugin support events', async () => {
    const events: Event[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: (event: Event) => {
          events.push(event);
          return true;
        },
      },
    });
    apiClient.setConfig({ apiBase: 'http://proxy.invalid', managementKey: 'fixture-only' });
    const adapter: AxiosAdapter = async (config) => ({
      data: {},
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'v8.0.3', 'x-cpa-support-plugin': 'true' },
    });
    await apiClient.get('/config', { adapter });
    expect(events.map((event) => event.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
    expect((events[0] as CustomEvent).detail.version).toBe('v8.0.3');
    expect((events[1] as CustomEvent).detail.supportsPlugin).toBe(true);
  });
});

test('captured SIWC transport keeps original credentials and suppresses stale events, including ABA', async () => {
  const events: Event[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
    },
  });
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  const captured = apiClient.captureConnection();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
  const adapter: AxiosAdapter = async (config) => {
    expect(config.baseURL).toBe('https://original.invalid/v8/management');
    expect(config.headers.Authorization).toBe('Bearer original-fixture');
    return {
      data: {},
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'old', 'x-cpa-support-plugin': 'true' },
    };
  };
  await captured.delete('/oauth/session', { params: { state: 'original-session' }, adapter });
  apiClient.setConfig({ apiBase: 'https://original.invalid', managementKey: 'original-fixture' });
  await captured.delete('/oauth/session', { params: { state: 'original-session' }, adapter });
  expect(events).toEqual([]);
  const unauthorized: AxiosAdapter = async (config) => {
    throw { isAxiosError: true, message: 'Unauthorized', config, response: { status: 401 } };
  };
  await expect(captured.delete('/oauth/session', { adapter: unauthorized })).rejects.toThrow();
  expect(events).toEqual([]);
});
