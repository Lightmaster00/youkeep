import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const db = getDb();
  
  const user = db.prepare('SELECT first_name, last_name, email, phone, dob FROM users WHERE id = ?').get(userSession.id) as {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    dob: string | null;
  } | undefined;

  return {
    firstName: user?.first_name || '',
    lastName: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    dob: user?.dob || ''
  };
});
