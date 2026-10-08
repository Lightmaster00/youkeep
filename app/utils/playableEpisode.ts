import type { PlayableEpisode } from '~/composables/usePodcastPlayer';

// An episode row of the Recent/Continue/Subscribed lists (episode fields plus
// show_title/show_cover_url) in the shape the podcast player takes, or null
// when it has no downloaded file.
export function toPlayableEpisode(ep: any): PlayableEpisode | null {
  if (!ep?.local_file_path) return null;
  return {
    id: ep.id,
    title: ep.title,
    show_title: ep.show_title,
    show_cover_url: ep.show_cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  };
}
