import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { frenchPlural } from '../../i18n/pluralRules';

describe('French plural rule', () => {
  it('treats 0 and 1 as singular for "a | b" messages, 2+ as plural', () => {
    expect([0, 1, 2, 5, 100].map(n => frenchPlural(n, 2))).toEqual([0, 0, 1, 1, 1]);
  });

  it('keeps zero / one / many for three-form messages', () => {
    expect([0, 1, 2].map(n => frenchPlural(n, 3))).toEqual([0, 1, 2]);
  });

  it('wired into vue-i18n: fr says "0 vidéo", en keeps "0 videos"', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'fr',
      pluralRules: { fr: frenchPlural },
      messages: {
        en: { n: '{count} video | {count} videos' },
        fr: { n: '{count} vidéo | {count} vidéos' },
      },
    });
    const { t } = i18n.global;
    expect([0, 1, 2].map(n => t('n', { count: n }, { plural: n, locale: 'fr' }))).toEqual(['0 vidéo', '1 vidéo', '2 vidéos']);
    expect([0, 1, 2].map(n => t('n', { count: n }, { plural: n, locale: 'en' }))).toEqual(['0 videos', '1 video', '2 videos']);
  });
});
