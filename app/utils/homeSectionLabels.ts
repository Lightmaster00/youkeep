import type { HomeSectionId } from '#shared/displayPrefs';
import { GUEST_HOME_SECTIONS } from '#shared/displayPrefs';

// The names of the home rows, as the Display preferences form lists them and
// as the home shows them while their row is still loading (the feed sends the
// same titles, see SECTION_TITLES in server/api/home/feed.get.ts).
export const HOME_SECTION_LABELS: Readonly<Record<HomeSectionId, string>> = {
  continue: 'Continue watching',
  subscriptions: 'From your subscriptions',
  forYou: 'Recommended for you',
  popular: 'Popular',
  becauseYouWatched: 'Because you watched',
  byCategory: 'Browse by category',
  shorts: 'Shorts',
  playlists: 'Your playlists',
  discoverChannels: 'Channels to discover',
  recentMusic: 'Recently added music',
  newEpisodes: 'New podcast episodes',
};

/** Whether a guest may see this home row (the others are personal). */
export function isGuestHomeSection(id: string): boolean {
  return (GUEST_HOME_SECTIONS as readonly string[]).includes(id);
}
