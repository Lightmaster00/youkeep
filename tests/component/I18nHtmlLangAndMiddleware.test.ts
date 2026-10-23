import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import App from '../../app/app.vue';
import authMiddleware from '../../app/middleware/auth.global';

afterEach(async () => {
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

describe('html lang attribute', () => {
  it('follows the active locale', async () => {
    await useNuxtApp().$i18n.setLocale('fr');
    const w = await mountSuspended(App);
    await flushPromises();
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    await useNuxtApp().$i18n.setLocale('en');
    await flushPromises();
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    w.unmount();
  });
});

describe('auth middleware applies the saved language', () => {
  beforeEach(async () => { await useNuxtApp().$i18n.setLocale('en'); });
  it('switches the locale once the session is known, before any redirect', async () => {
    useState('auth_loading').value = false;
    useState('auth_user').value = { id: 'u1', username: 'a', role: 'user', uiLanguage: 'fr' };
    const to: any = { path: '/login', fullPath: '/login', query: {}, matched: [{}] };
    await (authMiddleware as any)(to, to);
    expect(useNuxtApp().$i18n.locale.value).toBe('fr');
  });
});
