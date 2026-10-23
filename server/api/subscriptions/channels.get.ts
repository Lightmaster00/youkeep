import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { querySubscribedChannels } from '../../utils/subscriptionFeed';

// The followed channels with their new-video count, last upload, video count and categories.
export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  return { channels: querySubscribedChannels(getDb(), session) };
});
