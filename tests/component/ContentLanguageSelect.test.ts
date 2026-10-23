import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '../../shared/languages';
import ContentLanguageSelect from '../../app/components/ContentLanguageSelect.vue';
import VideoCard from '../../app/components/VideoCard.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let available: boolean;

beforeEach(async () => {
  available = true;
  fetchMock = vi.fn(async (_url: string, opts?: any) =>
    opts?.method === 'PUT'
      ? { contentLanguage: opts.body.contentLanguage, available }
      : { contentLanguage: 'original', available });
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'a', role: 'user' };
  await useNuxtApp().$i18n.setLocale('en');
  useToast().toasts.value.splice(0);
});
afterEach(() => vi.unstubAllGlobals());

const mountSelect = async () => {
  const w = await mountSuspended(ContentLanguageSelect);
  await flushPromises();
  return w;
};

describe('ContentLanguageSelect', () => {
  it('offers Original then the nine languages by native name, with helper text', async () => {
    const w = await mountSelect();
    const options = w.findAll('option');
    expect(options.map(o => o.attributes('value'))).toEqual(['original', ...SUPPORTED_LANGUAGES]);
    expect(options.map(o => o.text())).toEqual(['Original (as uploaded)', ...SUPPORTED_LANGUAGES.map(c => LANGUAGE_NAMES[c])]);
    expect(w.find('[data-testid="content-language-help"]').text()).toContain('Translations come from YouTube');
    expect(w.find('[data-testid="content-language-unavailable"]').exists()).toBe(false);
    expect(w.find('select').attributes('disabled')).toBeUndefined();
  });

  it('shows the saved language once loaded', async () => {
    fetchMock.mockResolvedValue({ contentLanguage: 'de', available: true });
    const w = await mountSelect();
    expect((w.find('select').element as HTMLSelectElement).value).toBe('de');
  });

  it('PUTs the choice and refreshes cached data', async () => {
    const w = await mountSelect();
    await w.find('select').setValue('fr');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/account/content-language', { method: 'PUT', body: { contentLanguage: 'fr' } });
    expect(useState<any>('auth_user').value.contentLanguage).toBe('fr');
  });

  it('restores the previous value, resyncs the select and toasts when saving fails', async () => {
    const w = await mountSelect();
    fetchMock.mockRejectedValue(new Error('boom'));
    await w.find('select').setValue('fr');
    await vi.waitFor(() => expect(useToast().toasts.value).toHaveLength(1));
    await vi.waitFor(() => expect((w.find('select').element as HTMLSelectElement).value).toBe('original'));
    expect(useState<any>('auth_user').value.contentLanguage).toBeUndefined();
    expect(useToast().toasts.value[0]!.type).toBe('error');
  });

  it('is disabled, with a note, when no YouTube Data API key is configured', async () => {
    available = false;
    const w = await mountSelect();
    expect(w.find('select').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="content-language-unavailable"]').text()).toContain('Ask an administrator to configure the YouTube Data API key');
  });

  it('renders in French', async () => {
    await useNuxtApp().$i18n.setLocale('fr');
    const w = await mountSelect();
    expect(w.find('label').text()).toBe('Titres et descriptions des vidéos');
    expect(w.find('option').text()).toBe('Original (tel que mis en ligne)');
  });
});

describe('VideoCard original title tooltip', () => {
  const base = { id: 'v1', title: 'Titre traduit', channel_id: 'c', channel_title: 'C', duration: 60, view_count: 1, upload_date: '20260101', visibility: 'public' };
  it('uses the original title as tooltip when the title was replaced', async () => {
    const w = await mountSuspended(VideoCard, { props: { video: { ...base, original_title: 'Original title' } } });
    expect(w.find('h4.video-title').attributes('title')).toBe('Original title');
    expect(w.find('h4.video-title').text()).toContain('Titre traduit');
  });
  it('falls back to the title itself otherwise', async () => {
    const w = await mountSuspended(VideoCard, { props: { video: base } });
    expect(w.find('h4.video-title').attributes('title')).toBe('Titre traduit');
  });
});
