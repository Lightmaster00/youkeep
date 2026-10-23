import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { badRequest, optionalStringArray, readJsonObject } from '../../utils/validation';
import { markVideosSeen } from '../../utils/subscriptionFeed';

const MAX_IDS = 200;

// Marks subscription videos as seen: { videoId } or { videoIds: [...] } (a
// batch). No history row is created; unknown or inaccessible ids are ignored.
export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const body = await readJsonObject(event);
  const ids: string[] = [];
  if (body.videoId !== undefined) {
    if (typeof body.videoId !== 'string' || body.videoId === '' || body.videoId.length > 200) badRequest('videoId must be a video id.');
    ids.push(body.videoId);
  }
  const many = optionalStringArray(body, 'videoIds', { maxItems: MAX_IDS, maxLength: 200 });
  if (many) ids.push(...many);
  if (ids.length === 0) badRequest('videoId or videoIds is required.');
  return { marked: markVideosSeen(getDb(), session, [...new Set(ids)]) };
});
