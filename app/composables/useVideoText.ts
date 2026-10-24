import type { HomeSectionId } from '#shared/displayPrefs';
import { categoryLabel as labelOfCategory } from '~/utils/categoryLabel';

// The wording of server-sent English text (home row titles, recommendation
// reasons), rebuilt from their stable identifiers in the viewer's language.
// Anything unknown falls back to the English text the server sent.

const REASON_KEYS: Record<string, string> = {
  subscription: 'subscription',
  'because-watched': 'becauseWatched',
  category: 'category',
  popular: 'popular',
  new: 'new',
};

interface ReasonVideo {
  reason?: { kind?: string; label?: string; ref?: { category?: string } } | null;
  reasonKind?: string;
  reasonParams?: { title?: string; category?: string };
}

export function useVideoText() {
  const { t, te } = useI18n();

  /** Title of a home row: its id picks the wording, `seed` fills "Because you watched {title}". */
  function sectionTitle(section: { id: string; title?: string; seed?: { title?: string } | null }): string {
    if (section.id === 'becauseYouWatched' && section.seed?.title) {
      return t('home.sections.becauseYouWatchedTitle', { title: section.seed.title });
    }
    const key = `home.sections.${section.id}`;
    return te(key) ? t(key) : (section.title ?? '');
  }

  /** The "why this video" line of a recommended card, or '' when it has none. */
  function reasonLabel(video: ReasonVideo): string {
    const reason = video.reason;
    if (!reason) return '';
    const kind = video.reasonKind ?? reason.kind ?? '';
    const key = REASON_KEYS[kind];
    const rawCategory = video.reasonParams?.category ?? reason.ref?.category;
    const params = { title: video.reasonParams?.title, category: rawCategory ? categoryLabel(rawCategory) : rawCategory };
    const needs = kind === 'because-watched' ? params.title : kind === 'category' ? params.category : true;
    if (!key || !needs) return reason.label ?? '';
    return t(`video.reason.${key}`, params as Record<string, string>);
  }

  /** A YouTube category name in the viewer's language (the raw name when it is not a known one). */
  function categoryLabel(name: string): string {
    return labelOfCategory(name, key => t(key));
  }

  /** The "why this channel" line of a Discover card; the server's English text is the fallback. */
  function discoverReason(channel: { reason?: string; reasonKind?: string; reasonParams?: { name?: string } }): string {
    const name = channel.reasonParams?.name;
    if (channel.reasonKind === 'because-watch' && name) return t('channels.reasonBecauseWatch', { name: categoryLabel(name) });
    if (channel.reasonKind === 'popular') return t('channels.reasonPopular');
    return channel.reason ?? '';
  }

  /** Name of a home row for the skeleton shown while the feed loads. */
  function rowName(id: HomeSectionId): string {
    return t(`home.sections.${id}`);
  }

  return { sectionTitle, reasonLabel, rowName, categoryLabel, discoverReason };
}
