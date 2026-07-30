export interface SessionForVisibility {
  role: 'admin' | 'user';
}

// The three-tier visibility rule used everywhere Music mode filters a list
// of artists/tracks by who's allowed to see them: guest sees only `public`;
// a logged-in non-admin sees `public` and `private`; an admin sees
// everything. Extracted here so every read endpoint that needs this WHERE
// fragment stays in sync — a drift between copies of this rule is a data
// leak (an unintended visibility tier becoming visible), not just a
// cosmetic bug, so there must be exactly one place this logic lives.
export function musicVisibilityClause(session: SessionForVisibility | null, columnAlias: string = 'a'): string {
  if (session && session.role === 'admin') {
    return '';
  }
  if (session) {
    return `${columnAlias}.visibility IN ('public', 'private')`;
  }
  return `${columnAlias}.visibility = 'public'`;
}
