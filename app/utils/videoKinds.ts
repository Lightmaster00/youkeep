// Lists that legitimately hold both kinds (playlists, search) show them as
// two sections, "Videos" then "Shorts", never interleaved.
export function splitShorts<T extends { is_short?: number | boolean | null }>(list: readonly T[] | null | undefined): { videos: T[]; shorts: T[] } {
  const videos: T[] = [];
  const shorts: T[] = [];
  for (const item of list ?? []) (item.is_short ? shorts : videos).push(item);
  return { videos, shorts };
}
