import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.search ? String(query.search).trim() : null;
  const genre = query.genre ? String(query.genre) : null;
  const language = query.language ? String(query.language) : null;
  const year = query.year ? Number(query.year) : null;

  // Visibility clause, shared between the main list query and the facets
  // queries below — facets must reflect only what the requester can see,
  // but must NOT be narrowed by the requester's currently applied filters
  // (search/genre/language/year), so it's built once and reused separately
  // from the filter-specific clauses.
  const visClauses: string[] = [];
  const visParams: any[] = [];
  const visClause = musicVisibilityClause(session);
  if (visClause) {
    visClauses.push(visClause);
  }

  const listClauses = [...visClauses];
  const listParams = [...visParams];

  if (search) {
    listClauses.push('a.name LIKE ?');
    listParams.push(`%${search}%`);
  }
  if (genre) {
    listClauses.push('t.genre = ?');
    listParams.push(genre);
  }
  if (language) {
    listClauses.push('t.language = ?');
    listParams.push(language);
  }
  if (year) {
    listClauses.push('al.release_year = ?');
    listParams.push(year);
  }

  const listWhereSql = listClauses.length > 0 ? `WHERE ${listClauses.join(' AND ')}` : '';

  const artistsQuery = `
    SELECT
      a.id,
      a.name,
      a.avatar_url,
      a.visibility,
      COUNT(DISTINCT t.id) as track_count
    FROM music_artists a
    JOIN music_tracks t ON t.artist_id = a.id AND t.download_status = 'completed'
    LEFT JOIN music_albums al ON t.album_id = al.id
    ${listWhereSql}
    GROUP BY a.id
    ORDER BY a.name ASC
  `;

  const artists = db.prepare(artistsQuery).all(...listParams);

  const facetsWhereSql = visClauses.length > 0 ? `WHERE ${visClauses.join(' AND ')} AND` : 'WHERE';

  const genres = db.prepare(`
    SELECT DISTINCT t.genre as value
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    ${facetsWhereSql} t.download_status = 'completed' AND t.genre IS NOT NULL
  `).all(...visParams).map((r: any) => r.value);

  const languages = db.prepare(`
    SELECT DISTINCT t.language as value
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    ${facetsWhereSql} t.download_status = 'completed' AND t.language IS NOT NULL
  `).all(...visParams).map((r: any) => r.value);

  const years = db.prepare(`
    SELECT DISTINCT al.release_year as value
    FROM music_albums al
    JOIN music_tracks t ON t.album_id = al.id AND t.download_status = 'completed'
    JOIN music_artists a ON t.artist_id = a.id
    ${facetsWhereSql} al.release_year IS NOT NULL
  `).all(...visParams).map((r: any) => r.value);

  return {
    artists,
    facets: { genres, languages, years }
  };
});
