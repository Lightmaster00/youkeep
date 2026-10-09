// Label and badge class of an artist's visibility, shown to admins on the
// Music library and the artist page.
export function formatVisibility(vis: string | null | undefined): string {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
}

export function visibilityBadgeClass(vis: string | null | undefined): string {
  switch (vis) {
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
}
