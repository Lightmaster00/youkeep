import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { frenchPlural, noPlural, russianPlural } from '../../i18n/pluralRules';

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

describe('Portuguese, Chinese, Japanese and Russian rules', () => {
  const NUMS = [0, 1, 2, 4, 5, 11, 12, 21, 22, 25, 101, 111];

  it('pt shares the French rule (0 is singular)', () => {
    expect([0, 1, 2].map(n => frenchPlural(n, 2))).toEqual([0, 0, 1]);
  });

  it('zh and ja always pick the first form', () => {
    expect([0, 1, 5, 100].map(() => noPlural())).toEqual([0, 0, 0, 0]);
  });

  it('ru picks one / few / many for three-form messages', () => {
    expect(NUMS.map(n => russianPlural(n, 3))).toEqual([2, 0, 1, 1, 2, 2, 2, 0, 1, 2, 0, 2]);
  });

  it('ru two-form messages: 1 is the first form, the rest the second', () => {
    expect([0, 1, 2, 21].map(n => russianPlural(n, 2))).toEqual([1, 0, 1, 1]);
  });

  it('wired into vue-i18n for ru, pt, zh and ja', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'ru',
      pluralRules: { pt: frenchPlural, zh: noPlural, ja: noPlural, ru: russianPlural },
      messages: {
        ru: { n: '{count} видео | {count} видео | {count} видео', c: '{count} канал | {count} канала | {count} каналов' },
        pt: { n: '{count} vídeo | {count} vídeos' },
        zh: { n: '{count} 个视频' },
        ja: { n: '{count}本の動画' },
      },
    });
    const { t } = i18n.global;
    const run = (key: string, locale: string, nums: number[]) => nums.map(n => t(key, { count: n }, { plural: n, locale }));
    expect(run('c', 'ru', [1, 2, 5, 11, 21, 22, 25])).toEqual(['1 канал', '2 канала', '5 каналов', '11 каналов', '21 канал', '22 канала', '25 каналов']);
    expect(run('n', 'pt', [0, 1, 2])).toEqual(['0 vídeo', '1 vídeo', '2 vídeos']);
    expect(run('n', 'zh', [0, 1, 5])).toEqual(['0 个视频', '1 个视频', '5 个视频']);
    expect(run('n', 'ja', [0, 1, 5])).toEqual(['0本の動画', '1本の動画', '5本の動画']);
  });
});
