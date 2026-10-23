import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../utils/auth';
import { badRequest } from '../../utils/validation';
import { applyVideoTextLanguage } from '../../utils/videoTranslations';
import { querySubscriptionFeed, SUBSCRIPTION_SORTS, type SubscriptionSort } from '../../utils/subscriptionFeed';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

// GET /api/subscriptions/feed?channelId&category&sort=new|popular|oldest&type=video|short&page&limit
export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const q = getQuery(event);
  const text = (key: string): string | undefined => {
    const value = q[key];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || value.length > 200) badRequest(`${key} must be a short text.`);
    return value;
  };
  const sort = (text('sort') ?? 'new') as SubscriptionSort;
  if (!SUBSCRIPTION_SORTS.includes(sort)) badRequest(`sort must be one of: ${SUBSCRIPTION_SORTS.join(', ')}.`);
  const type = text('type') ?? 'video';
  if (type !== 'video' && type !== 'short') badRequest('type must be video or short.');
  const int = (key: string, fallback: number, max: number) => {
    const n = Number.parseInt(String(q[key] ?? ''), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : fallback;
  };
  const db = getDb();
  const feed = querySubscriptionFeed(db, session, {
    channelId: text('channelId'),
    category: text('category'),
    sort,
    type,
    page: int('page', 1, 10_000),
    limit: int('limit', DEFAULT_LIMIT, MAX_LIMIT),
  });
  applyVideoTextLanguage(db, session, feed.videos);
  return feed;
});
