import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import AccountPage from '../../app/pages/account.vue';

const TS = Date.UTC(2026, 2, 15, 12, 0, 0); // 15 March 2026, noon UTC: same calendar day in every timezone

beforeEach(() => {
  useState<any>('auth_user').value = { id: 'u1', username: 'bob', role: 'user', mustChangePassword: false };
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/account/profile') return { firstName: '', lastName: '', email: '', phone: '', dob: '' };
    if (url === '/api/account/tokens') {
      return { tokens: [{ id: 't1', name: 'CLI', createdAt: TS, expiresAt: null, lastUsedAt: null, tokenPrefix: 'yk_abc' }] };
    }
    return {};
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

describe('dates follow the UI language', () => {
  it.each([
    ['en', 'Created Mar 15, 2026'],
    ['fr', 'Créé le 15 mars 2026'],
  ] as const)('%s', async (lang, expected) => {
    await useNuxtApp().$i18n.setLocale(lang);
    const w = await mountSuspended(AccountPage);
    await flushPromises();
    expect(w.find('.api-token-meta').text()).toContain(expected);
    w.unmount();
  });
});

describe('missing keys fall back to English', () => {
  it('shows the English text, not the key, when fr lacks the key', async () => {
    const { $i18n } = useNuxtApp();
    $i18n.mergeLocaleMessage('en', { testOnly: { onlyEnglish: 'Only in English' } });
    await $i18n.setLocale('fr');
    const Tiny = defineComponent({
      setup() {
        const { t } = useI18n();
        return () => h('p', t('testOnly.onlyEnglish'));
      },
    });
    const w = await mountSuspended(Tiny);
    expect(w.text()).toBe('Only in English');
    expect(w.text()).not.toContain('testOnly');
    w.unmount();
  });
});
