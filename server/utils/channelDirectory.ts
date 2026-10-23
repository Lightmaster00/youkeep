import type Database from 'better-sqlite3';
import { createError } from 'h3';
import { channelAccessSql, videoVisibilitySql, type VideoViewer } from './videoAccess';
import { effectiveCategoriesSql, parseCategories, MAX_CATEGORY_NAME_LENGTH } from './channelCategories';
import { NEW_WINDOW_MS } from './subscriptionFeed';
import { loadProfile } from './recommend';

// The channels directory (GET /api/channels, /api/channels/categories and
// /api/channels/discover). Every query is one set-based statement over the
// channels with grouped aggregates joined once: no per-channel subquery.

export const CHANNEL_SORTS = ['title', 'videos', 'recent', 'watched'] as const;
export type ChannelSort = typeof CHANNEL_SORTS[number];
export const CHANNEL_PAGE_SIZE = 48;
export const CHANNEL_PAGE_MAX = 100;
export const CHANNEL_SEARCH_MAX = 100;
export const DISCOVER_LIMIT = 8;
/** How many of the viewer's most watched categories the Discover strip looks at. */
const DISCOVER_TOP_CATEGORIES = 5;

export interface ChannelListQuery {
  category: string | null;
  q: string | null;
  sort: ChannelSort;
  following: boolean | null;
  /** null: every row (callers that predate paging). */
  page: number | null;
  limit: number;
  /** Legacy: title or description contains. */
  search: string | null;
  /** Legacy: only the followed channels. */
  subscribed: boolean;
}

const bad = (statusMessage: string) => createError({ statusCode: 400, statusMessage });

function single(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value === 'object') throw bad(`Give "${name}" once.`);
  return String(value);
}

function positiveInt(raw: string | null, name: string, max: number): number | null {
  if (raw === null || raw === '') return null;
  if (!/^\d+$/.test(raw)) throw bad(`"${name}" must be a whole number.`);
  const n = Number(raw);
  if (n < 1 || n > max) throw bad(`"${name}" must be between 1 and ${max}.`);
  return n;
}

/** Validates the query string of GET /api/channels (400 on anything invalid). */
export function parseChannelListQuery(query: Record<string, unknown>): ChannelListQuery {
  const category = single(query.category, 'category')?.trim() || null;
  if (category && category.length > MAX_CATEGORY_NAME_LENGTH) throw bad(`A category has at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);
  const q = single(query.q, 'q')?.trim() || null;
  if (q && q.length > CHANNEL_SEARCH_MAX) throw bad(`The search has at most ${CHANNEL_SEARCH_MAX} characters.`);
  const sortRaw = single(query.sort, 'sort') || 'title';
  if (!(CHANNEL_SORTS as readonly string[]).includes(sortRaw)) throw bad(`"sort" must be one of ${CHANNEL_SORTS.join(', ')}.`);
  const followingRaw = single(query.following, 'following');
  if (followingRaw !== null && followingRaw !== '' && followingRaw !== '1' && followingRaw !== '0') throw bad('"following" must be 1 or 0.');
  const pageRaw = single(query.page, 'page');
  const limitRaw = single(query.limit, 'limit');
  const page = positiveInt(pageRaw, 'page', 100_000);
  const limit = positiveInt(limitRaw, 'limit', CHANNEL_PAGE_MAX);
  const paged = page !== null || limit !== null;
  const search = single(query.search, 'search')?.trim().slice(0, CHANNEL_SEARCH_MAX) || null;
  return {
    category,
    q,
    sort: sortRaw as ChannelSort,
    following: followingRaw === '1' ? true : followingRaw === '0' ? false : null,
    page: paged ? page ?? 1 : null,
    limit: limit ?? CHANNEL_PAGE_SIZE,
    search,
    subscribed: single(query.subscribed, 'subscribed') === 'true',
  };
}

export interface DirectoryChannel {
  id: string;
  title: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  sync_status: string | null;
  visibility: string;
  import_status: string | null;
  import_error?: string | null;
  created_at: number;
  completed_count: number;
  total_count: number;
  last_upload_date: string | null;
  categories: string[];
  subscribed?: boolean;
  new_count?: number;
}

export function queryChannelDirectory(
  db: Database.Database,
  viewer: VideoViewer | null,
  opts: ChannelListQuery,
  now: number = Date.now(),
): { channels: DirectoryChannel[]; total: number } {
  const visible = videoVisibilitySql(viewer, 'v', 'vc');
  const access = channelAccessSql(viewer);
  const effective = effectiveCategoriesSql('c');
  const isAdmin = viewer?.role === 'admin';

  const ctes: string[] = [`agg AS (
      SELECT v.channel_id,
             SUM(CASE WHEN v.download_status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
             COUNT(*) AS total_count,
             MAX(CASE WHEN v.download_status = 'completed' THEN v.upload_date END) AS last_upload_date
      FROM videos v
      JOIN channels vc ON vc.id = v.channel_id
      WHERE ${visible.sql}
      GROUP BY v.channel_id
    )`];
  const cteParams: unknown[] = [...visible.params];
  const joins: string[] = ['LEFT JOIN agg ON agg.channel_id = c.id'];
  const joinParams: unknown[] = [];
  const extraColumns: string[] = [];

  if (viewer) {
    // The viewer's watch time per channel, and the new videos of the followed
    // channels (same rule as the Subscriptions page).
    ctes.push(`watched AS (
      SELECT v.channel_id, SUM(COALESCE(h.watch_time_seconds, 0)) AS watch_seconds
      FROM user_history h JOIN videos v ON v.id = h.video_id
      WHERE h.user_id = ?
      GROUP BY v.channel_id
    )`);
    cteParams.push(viewer.id);
    ctes.push(`fresh AS (
      SELECT v.channel_id, COUNT(*) AS n
      FROM user_subscriptions us
      JOIN videos v ON v.channel_id = us.channel_id
      JOIN channels vc ON vc.id = v.channel_id
      LEFT JOIN user_history uh ON uh.user_id = us.user_id AND uh.video_id = v.id
      LEFT JOIN user_seen_videos sv ON sv.user_id = us.user_id AND sv.video_id = v.id
      WHERE us.user_id = ? AND v.download_status = 'completed' AND v.created_at >= ?
        AND uh.video_id IS NULL AND sv.video_id IS NULL
        AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
        AND ${visible.sql}
      GROUP BY v.channel_id
    )`);
    cteParams.push(viewer.id, now - NEW_WINDOW_MS, viewer.id, ...visible.params);
    joins.push('LEFT JOIN watched w ON w.channel_id = c.id');
    joins.push('LEFT JOIN user_subscriptions mine ON mine.channel_id = c.id AND mine.user_id = ?');
    joinParams.push(viewer.id);
    joins.push('LEFT JOIN fresh ON fresh.channel_id = c.id');
    extraColumns.push('CASE WHEN mine.channel_id IS NULL THEN 0 ELSE 1 END AS subscribed', 'COALESCE(fresh.n, 0) AS new_count');
  }

  const where: string[] = [access.sql];
  const whereParams: unknown[] = [...access.params];
  if (opts.subscribed && viewer) {
    where.push('mine.channel_id IS NOT NULL');
  }
  if (opts.following !== null && viewer) {
    where.push(opts.following ? 'mine.channel_id IS NOT NULL' : 'mine.channel_id IS NULL');
  }
  if (opts.category) {
    where.push(`EXISTS (SELECT 1 FROM json_each(${effective}) j WHERE j.type = 'text' AND j.value = ? COLLATE NOCASE)`);
    whereParams.push(opts.category);
  }
  if (opts.q) {
    where.push('instr(lower(c.title), lower(?)) > 0');
    whereParams.push(opts.q);
  }
  if (opts.search) {
    where.push('(instr(lower(c.title), lower(?)) > 0 OR instr(lower(COALESCE(c.description, \'\')), lower(?)) > 0)');
    whereParams.push(opts.search, opts.search);
  }

  const byTitle = 'c.title COLLATE NOCASE ASC, c.id ASC';
  const order = {
    title: byTitle,
    videos: `COALESCE(agg.completed_count, 0) DESC, ${byTitle}`,
    recent: `agg.last_upload_date IS NULL, agg.last_upload_date DESC, ${byTitle}`,
    watched: viewer ? `COALESCE(w.watch_seconds, 0) DESC, ${byTitle}` : byTitle,
  }[opts.sort];

  const paging = opts.page !== null ? 'LIMIT ? OFFSET ?' : '';
  const pagingParams = opts.page !== null ? [opts.limit, (opts.page - 1) * opts.limit] : [];

  const rows = db.prepare(`
    WITH ${ctes.join(',\n')}
    SELECT c.id, c.title, c.description, c.avatar_url, c.banner_url, c.sync_status, c.visibility, c.import_status,
           ${isAdmin ? 'c.import_error,' : ''}
           c.created_at,
           COALESCE(agg.completed_count, 0) AS completed_count,
           COALESCE(agg.total_count, 0) AS total_count,
           agg.last_upload_date,
           ${effective} AS categories_json,
           ${extraColumns.length ? extraColumns.join(', ') + ',' : ''}
           COUNT(*) OVER () AS total_rows
    FROM channels c
    ${joins.join('\n    ')}
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    ${paging}
  `).all(...cteParams, ...joinParams, ...whereParams, ...pagingParams) as any[];

  let total = rows[0]?.total_rows ?? 0;
  if (rows.length === 0 && opts.page !== null && opts.page > 1) {
    // Past the last page: the window has no row to carry the total.
    total = (db.prepare(`
      WITH ${ctes.join(',\n')}
      SELECT COUNT(*) AS n FROM channels c ${joins.join(' ')} WHERE ${where.join(' AND ')}
    `).get(...cteParams, ...joinParams, ...whereParams) as { n: number }).n;
  }
  const channels = rows.map(({ categories_json, total_rows: _t, subscribed, ...r }) => ({
    ...r,
    categories: parseCategories(categories_json),
    ...(viewer ? { subscribed: subscribed === 1 } : {}),
  }));
  return { channels, total };
}

export interface CategoryCount { name: string; count: number }

/** The effective categories of the channels the viewer may see, by count then name. */
export function queryChannelCategories(db: Database.Database, viewer: VideoViewer | null): CategoryCount[] {
  const access = channelAccessSql(viewer);
  return db.prepare(`
    SELECT MIN(j.value) AS name, COUNT(DISTINCT c.id) AS count
    FROM channels c
    JOIN json_each(${effectiveCategoriesSql('c')}) j
    WHERE ${access.sql} AND j.type = 'text' AND j.value <> ''
    GROUP BY j.value COLLATE NOCASE
    ORDER BY count DESC, name COLLATE NOCASE ASC
  `).all(...access.params) as CategoryCount[];
}

export interface DiscoverDirectoryChannel {
  id: string;
  title: string;
  avatar_url: string | null;
  video_count: number;
  categories: string[];
  reason: string;
}

/**
 * Up to DISCOVER_LIMIT channels the viewer does not follow, with something to
 * watch, ranked by how much their categories overlap the viewer's most
 * watched ones, then by popularity (views of their visible videos).
 */
export function queryDirectoryDiscover(db: Database.Database, viewer: VideoViewer, now: number = Date.now()): DiscoverDirectoryChannel[] {
  const visible = videoVisibilitySql(viewer, 'v', 'vc');
  const access = channelAccessSql(viewer);
  const rows = db.prepare(`
    WITH agg AS (
      SELECT v.channel_id, COUNT(*) AS video_count, SUM(COALESCE(v.view_count, 0)) AS views
      FROM videos v
      JOIN channels vc ON vc.id = v.channel_id
      WHERE v.download_status = 'completed' AND ${visible.sql}
      GROUP BY v.channel_id
    )
    SELECT c.id, c.title, c.avatar_url, agg.video_count, agg.views, ${effectiveCategoriesSql('c')} AS categories_json
    FROM channels c
    JOIN agg ON agg.channel_id = c.id
    WHERE ${access.sql}
      AND c.id NOT IN (SELECT channel_id FROM user_subscriptions WHERE user_id = ?)
  `).all(...visible.params, ...access.params, viewer.id) as any[];
  if (rows.length === 0) return [];

  const profile = loadProfile(db, viewer, now);
  const top = new Map([...profile.categoryAffinity.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, DISCOVER_TOP_CATEGORIES)
    .map(([name, affinity]) => [name.toLowerCase(), { name, affinity }]));

  return rows
    .map((r) => {
      const categories = parseCategories(r.categories_json);
      let overlap = 0;
      let best: { name: string; affinity: number } | null = null;
      for (const cat of categories) {
        const hit = top.get(cat.toLowerCase());
        if (!hit) continue;
        overlap += hit.affinity;
        if (!best || hit.affinity > best.affinity) best = { name: cat, affinity: hit.affinity };
      }
      return {
        channel: {
          id: r.id as string,
          title: r.title as string,
          avatar_url: r.avatar_url as string | null,
          video_count: r.video_count as number,
          categories,
          reason: best ? `Because you watch ${best.name}` : 'Popular in the library',
        },
        overlap,
        views: r.views as number,
      };
    })
    .sort((a, b) => b.overlap - a.overlap || b.views - a.views || (a.channel.title.toLowerCase() < b.channel.title.toLowerCase() ? -1 : 1))
    .slice(0, DISCOVER_LIMIT)
    .map((x) => x.channel);
}
