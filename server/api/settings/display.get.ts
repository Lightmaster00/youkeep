import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../utils/auth';
import { getDisplayView } from '../../utils/displayPrefsStore';
import { buildView } from '../../../shared/displayPrefs';

// Public: a guest gets the instance defaults, a logged-in caller (cookie
// session or Bearer API token) additionally gets their own overrides. Reads
// never fail: on any error the app defaults are returned.
export default defineEventHandler(async (event) => {
  try {
    const session = await getUserFromSession(event);
    return getDisplayView(getDb(), session?.id ?? null);
  } catch {
    return buildView({}, null);
  }
});
