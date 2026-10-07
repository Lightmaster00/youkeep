// Header search placeholder follows the active space.
const PLACEHOLDERS: Record<string, string> = {
  video: 'Search videos, channels...',
  music: 'Search artists, albums, tracks...',
  podcasts: 'Search podcasts and episodes...',
};

export function searchPlaceholder(spaceId: string): string {
  return PLACEHOLDERS[spaceId] ?? PLACEHOLDERS.video!;
}
