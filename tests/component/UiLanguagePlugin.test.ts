import { describe, it, expect, beforeEach } from 'vitest';
import { applyUserLanguage } from '~/plugins/uiLanguage';

const setUser = (uiLanguage: unknown) => {
  useState<any>('auth_user').value = { id: 'u1', username: 'a', role: 'user', uiLanguage };
};

describe('applyUserLanguage', () => {
  beforeEach(async () => { await useNuxtApp().$i18n.setLocale('en'); });

  it('applies the saved language', async () => {
    const app = useNuxtApp();
    setUser('fr');
    await applyUserLanguage(app);
    expect(app.$i18n.locale.value).toBe('fr');
  });
  it('keeps the current locale when none saved', async () => {
    const app = useNuxtApp();
    await app.$i18n.setLocale('fr');
    setUser(null);
    await applyUserLanguage(app);
    expect(app.$i18n.locale.value).toBe('fr');
  });
  it('ignores unsupported values', async () => {
    const app = useNuxtApp();
    setUser('xx');
    await applyUserLanguage(app);
    expect(app.$i18n.locale.value).toBe('en');
  });
});

describe('saved language wins over locale detection', () => {
  it('overrides a locale switch requested by detection', async () => {
    const app = useNuxtApp();
    setUser('fr');
    await app.$i18n.setLocale('en');
    expect(app.$i18n.locale.value).toBe('fr');
  });
  it('does not interfere when nothing is saved', async () => {
    const app = useNuxtApp();
    setUser(null);
    await app.$i18n.setLocale('fr');
    expect(app.$i18n.locale.value).toBe('fr');
  });
});
