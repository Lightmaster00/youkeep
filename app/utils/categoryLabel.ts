// YouTube category names are stored in English (as YouTube sends them). The
// interface shows them in the viewer's language through `categories.<slug>`
// catalogue keys; a name that is not listed here is shown as it is.

const SLUGS: Record<string, string> = {
  'film & animation': 'filmAnimation',
  'autos & vehicles': 'autosVehicles',
  'music': 'music',
  'pets & animals': 'petsAnimals',
  'sports': 'sports',
  'short movies': 'shortMovies',
  'travel & events': 'travelEvents',
  'gaming': 'gaming',
  'videoblogging': 'videoblogging',
  'people & blogs': 'peopleBlogs',
  'comedy': 'comedy',
  'entertainment': 'entertainment',
  'news & politics': 'newsPolitics',
  'howto & style': 'howtoStyle',
  'education': 'education',
  'science & technology': 'scienceTechnology',
  'nonprofits & activism': 'nonprofitsActivism',
  'movies': 'movies',
  'anime/animation': 'animeAnimation',
  'action/adventure': 'actionAdventure',
  'classics': 'classics',
  'documentary': 'documentary',
  'drama': 'drama',
  'family': 'family',
  'foreign': 'foreign',
  'horror': 'horror',
  'sci-fi/fantasy': 'sciFiFantasy',
  'thriller': 'thriller',
  'shorts': 'shorts',
  'shows': 'shows',
  'trailers': 'trailers',
};

/** Lowercases and collapses spacing so "Science  &Technology" style variants still match. */
function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s*([&/])\s*/g, ' $1 ').replace(/\s+/g, ' ').replace(/ \/ /g, '/');
}

/** Catalogue key of a known YouTube category name, or null for an unknown one. */
export function categoryKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const slug = SLUGS[normalise(name)];
  return slug ? `categories.${slug}` : null;
}

/** Display name of a category: the translation when known, the raw name otherwise. */
export function categoryLabel(name: string, t: (key: string) => string): string {
  const key = categoryKey(name);
  return key ? t(key) : name;
}
