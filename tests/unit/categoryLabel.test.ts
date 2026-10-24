import { describe, it, expect } from 'vitest';
import { categoryKey, categoryLabel } from '../../app/utils/categoryLabel';

const t = (key: string) => `<${key}>`;

describe('categoryLabel', () => {
  it('maps the known YouTube category names to catalogue keys', () => {
    expect(categoryKey('Education')).toBe('categories.education');
    expect(categoryKey('Science & Technology')).toBe('categories.scienceTechnology');
    expect(categoryKey('People & Blogs')).toBe('categories.peopleBlogs');
    expect(categoryKey('Howto & Style')).toBe('categories.howtoStyle');
    expect(categoryLabel('Gaming', t)).toBe('<categories.gaming>');
  });

  it('ignores case and spacing', () => {
    expect(categoryKey('  science&technology ')).toBe('categories.scienceTechnology');
    expect(categoryKey('FILM  &  ANIMATION')).toBe('categories.filmAnimation');
    expect(categoryKey('Sci-Fi / Fantasy')).toBe('categories.sciFiFantasy');
  });

  it('keeps an unknown or empty name as it is', () => {
    expect(categoryLabel('Cooking Mastery', t)).toBe('Cooking Mastery');
    expect(categoryKey('')).toBeNull();
    expect(categoryKey(undefined)).toBeNull();
  });

  it('every slug has a key in the English catalogue', async () => {
    const en = (await import('../../i18n/locales/en.json')).default as any;
    for (const name of ['Film & Animation', 'Autos & Vehicles', 'Nonprofits & Activism', 'Shows', 'Movies', 'Trailers', 'Anime/Animation']) {
      const key = categoryKey(name)!;
      expect(en.categories[key.split('.')[1]!], name).toBeTruthy();
    }
  });
});
