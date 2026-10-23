import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { markAllSubscriptionsSeen } from '../../utils/subscriptionFeed';

// "Mark all as seen" on the Subscriptions page.
export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  return { marked: markAllSubscriptionsSeen(getDb(), session) };
});
