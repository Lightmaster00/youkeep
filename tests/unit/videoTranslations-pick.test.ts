import { describe, it, expect } from 'vitest';
import { pickLocalization } from '../../server/utils/videoTranslations';

describe('pickLocalization', () => {
  it('prefers the exact key', () => {
    const l = { fr: { title: 'T', description: 'D' }, 'fr-CA': { title: 'X' } };
    expect(pickLocalization(l, 'fr')).toEqual({ title: 'T', description: 'D' });
  });
  it('falls back to a regional variant of the language', () => {
    expect(pickLocalization({ 'pt-BR': { title: 'Olá' } }, 'pt')).toEqual({ title: 'Olá', description: null });
  });
  it('ignores other languages', () => {
    expect(pickLocalization({ de: { title: 'x' } }, 'fr')).toBeNull();
    expect(pickLocalization({ fil: { title: 'x' } }, 'fr')).toBeNull();
  });
  it('prefers simplified Chinese', () => {
    const l = { 'zh-Hant': { title: 'trad' }, 'zh-TW': { title: 'tw' }, 'zh-Hans': { title: 'simp' } };
    expect(pickLocalization(l, 'zh')?.title).toBe('simp');
    expect(pickLocalization({ 'zh-TW': { title: 'tw' }, 'zh-CN': { title: 'cn' } }, 'zh')?.title).toBe('cn');
    expect(pickLocalization({ 'zh-TW': { title: 'tw' } }, 'zh')?.title).toBe('tw');
  });
  it('skips empty entries and falls through to the next candidate', () => {
    expect(pickLocalization({ fr: { title: ' ', description: '' }, 'fr-CA': { title: 'Salut' } }, 'fr')?.title).toBe('Salut');
    expect(pickLocalization({ fr: { title: '' } }, 'fr')).toBeNull();
  });
  it('handles missing input', () => {
    expect(pickLocalization(undefined, 'fr')).toBeNull();
    expect(pickLocalization({}, 'fr')).toBeNull();
  });
});
