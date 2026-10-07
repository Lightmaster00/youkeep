// One shared session type for both visibility rules (a second export of the
// same name would make the server auto-import ambiguous).
import type { SessionForVisibility } from './musicVisibility';

// The three-tier visibility rule used everywhere Podcast mode filters a list
// of shows/episodes by who's allowed to see them: guest sees only `public`;
// a logged-in non-admin sees `public` and `private`; an admin sees
// everything. Extracted here for the same reason musicVisibility.ts exists —
// a drift between copies of this rule is a data leak (an unintended
// visibility tier becoming visible), not just a cosmetic bug, so there must
// be exactly one place this logic lives.
export function podcastVisibilityClause(session: SessionForVisibility | null, columnAlias: string = 's'): string {
  if (session && session.role === 'admin') {
    return '';
  }
  if (session) {
    return `${columnAlias}.visibility IN ('public', 'private')`;
  }
  return `${columnAlias}.visibility = 'public'`;
}
