import { describe, expect, test } from 'bun:test';
import {
  ANTIGRAVITY_REQUEST_HEADERS,
  ANTIGRAVITY_USER_AGENT,
  buildAntigravityUserAgent,
} from '@/utils/quota/constants';

describe('Antigravity User-Agent', () => {
  test('uses the supported Hub client identifier in quota request headers', () => {
    expect(ANTIGRAVITY_USER_AGENT).toBe('antigravity/hub/2.23.0 darwin/arm64');
    expect(ANTIGRAVITY_REQUEST_HEADERS['User-Agent']).toBe(ANTIGRAVITY_USER_AGENT);
    expect(buildAntigravityUserAgent({ version: '2.24.0', platform: 'linux/amd64' })).toBe(
      'antigravity/hub/2.24.0 linux/amd64'
    );
  });
});