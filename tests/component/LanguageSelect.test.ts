import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import LanguageSelect from '../../app/components/LanguageSelect.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchMock = vi.fn().mockResolvedValue({ uiLanguage: 'fr' });
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'a', role: 'user', uiLanguage: null };
  await useNuxtApp().$i18n.setLocale('en');
  useToast().toasts.value.splice(0);
});
afterEach(() => vi.unstubAllGlobals());

describe('LanguageSelect', () => {
  it('offers only the shipped languages, named in themselves', async () => {
    const w = await mountSuspended(LanguageSelect);
    const options = w.findAll('option');
    expect(options.map(o => o.attributes('value'))).toEqual(['en', 'fr']);
    expect(options.map(o => o.text())).toEqual(['English', 'Français']);
  });

  it('saves the choice and switches the locale', async () => {
    const w = await mountSuspended(LanguageSelect);
    await w.find('select').setValue('fr');
    await vi.waitFor(() => expect(useNuxtApp().$i18n.locale.value).toBe('fr'));
    expect(fetchMock).toHaveBeenCalledWith('/api/account/language', { method: 'PUT', body: { uiLanguage: 'fr' } });
  });

  it('goes back to the previous language, resyncs the select and toasts when saving fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const w = await mountSuspended(LanguageSelect);
    const select = w.find('select');
    await select.setValue('fr');
    await vi.waitFor(() => expect(useToast().toasts.value).toHaveLength(1));
    await vi.waitFor(() => expect((w.find('select').element as HTMLSelectElement).value).toBe('en'));
    expect(useNuxtApp().$i18n.locale.value).toBe('en');
    expect(useToast().toasts.value[0]!.type).toBe('error');
  });
});
