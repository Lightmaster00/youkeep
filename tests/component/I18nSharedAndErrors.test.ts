import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ConfirmHost from '../../app/components/ConfirmHost.vue';
import LoginPage from '../../app/pages/login.vue';
import csrfPlugin from '../../app/plugins/csrf.client';
import { confirmAction } from '../../app/composables/useConfirm';
import { useToast } from '../../app/composables/useToast';

// The last pieces of shared user-facing text in French: the confirm dialog's default buttons, the
// session-expired toast and the messages of a failed login (known server messages are mapped, unknown
// ones shown as the server sent them, a missing one gets the generic wording).
beforeEach(async () => {
  useToast().toasts.value = [];
  useState('auth_loading').value = false;
  useState('auth_user').value = null;
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  await useNuxtApp().$i18n.setLocale('fr');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await useNuxtApp().$i18n.setLocale('en');
});

describe('confirm dialog in French', () => {
  it('words the default buttons in French and keeps the labels a caller passes', async () => {
    const w = await mountSuspended(ConfirmHost, { attachTo: document.body });
    const first = confirmAction({ title: 'Titre', message: 'Sûr ?' });
    await flushPromises();
    const buttons = w.findAll('button').map((b) => b.text());
    expect(buttons).toContain('Annuler');
    expect(buttons).toContain('Confirmer');
    expect(buttons).not.toContain('Cancel');
    expect(buttons).not.toContain('Confirm');
    await w.find('.confirm-dialog-confirm').trigger('click');
    await expect(first).resolves.toBe(true);
    await flushPromises();

    const second = confirmAction({ title: 'Titre', message: 'Sûr ?', confirmLabel: 'Supprimer la vidéo' });
    await flushPromises();
    expect(w.find('.confirm-dialog-confirm').text()).toBe('Supprimer la vidéo');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(second).resolves.toBe(false);
    w.unmount();
  });
});

describe('session expired toast in French', () => {
  let savedFetch: typeof window.fetch;
  beforeEach(async () => {
    savedFetch = window.fetch;
    window.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as any;
    (csrfPlugin as any)(useNuxtApp());
    useState('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
    window.sessionStorage.setItem('landing_applied', 'u1');
    await useRouter().push('/playlists');
  });
  afterEach(() => { window.fetch = savedFetch; });

  it('tells a French user their session expired in French', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({})));
    await window.fetch('/api/playlists/personal');
    await new Promise((r) => setTimeout(r, 0));
    expect(useToast().toasts.value.map((t) => t.message)).toEqual(['Votre session a expiré. Veuillez vous reconnecter.']);
  });
});

describe('login errors in French', () => {
  const failWith = async (error: unknown) => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/setup-status') return { setupRequired: false };
      throw error;
    }));
    const w = await mountSuspended(LoginPage, { route: { path: '/login', query: {} } });
    await flushPromises();
    await w.find('input[type="text"]').setValue('bob');
    await w.find('input[type="password"]').setValue('mauvais-mot-de-passe');
    await w.find('form').trigger('submit');
    await flushPromises();
    return w.find('.error-box').text();
  };

  it('shows the wrong-password message in French', async () => {
    expect(await failWith({ data: { statusMessage: 'Invalid username or password.' } })).toBe("Nom d'utilisateur ou mot de passe incorrect.");
  });

  it('translates the rate limit and keeps its minutes', async () => {
    const text = await failWith({ data: { statusMessage: 'Too many failed login attempts. Try again in 12 minute(s).' } });
    expect(text).toBe('Trop de tentatives de connexion échouées. Réessayez dans 12 minute(s).');
  });

  it('shows an unknown server message as it is, and a missing one as bad credentials', async () => {
    expect(await failWith({ data: { statusMessage: 'Service busy.' } })).toBe('Service busy.');
    expect(await failWith(new Error('offline'))).toBe("Nom d'utilisateur ou mot de passe incorrect.");
  });

  it('still reads English for an English user', async () => {
    await useNuxtApp().$i18n.setLocale('en');
    expect(await failWith({ data: { statusMessage: 'Invalid username or password.' } })).toBe('Invalid username or password.');
  });
});
