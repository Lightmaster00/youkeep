import { defineEventHandler, getQuery } from 'h3';
import { requireSessionAdmin } from '../../utils/auth';
import { listSecurityEvents } from '../../utils/securityLog';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// The security log, newest first. Admin browser sessions only: an API token
// (even an admin's) cannot read it.
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  const raw = Number(getQuery(event).limit);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT;
  return { events: listSecurityEvents(limit) };
});
