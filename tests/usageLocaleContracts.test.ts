import { describe, expect, test } from 'bun:test';
import en from '../src/i18n/locales/en.json';
import ko from '../src/i18n/locales/ko.json';
import ru from '../src/i18n/locales/ru.json';
import vi from '../src/i18n/locales/vi.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';

const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, vi, ko };

describe('usage and service health locale contracts', () => {
  test('all supported languages include usage navigation aliases', () => {
    for (const locale of Object.values(locales)) {
      expect(locale.nav.usage_stats).toBeTruthy();
      expect(locale.nav_meta.usage_stats).toBeTruthy();
    }
  });

  test('all supported languages include every service health card label', () => {
    for (const locale of Object.values(locales)) {
      expect(locale.service_health.title).toBeTruthy();
      expect(locale.service_health.window).toBeTruthy();
      expect(locale.service_health.oldest).toBeTruthy();
      expect(locale.service_health.newest).toBeTruthy();
    }
  });
});
