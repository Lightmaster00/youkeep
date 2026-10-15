import { defineEventHandler, createError } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';
import { readJsonObject, optionalString } from '../../utils/validation';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readJsonObject(event);
  const firstName = optionalString(body, 'firstName', { max: 100 });
  const lastName = optionalString(body, 'lastName', { max: 100 });
  const email = optionalString(body, 'email', { max: 254 });
  const phone = optionalString(body, 'phone', { max: 32 });
  const dob = optionalString(body, 'dob', { max: 10 });

  // Server-side validation
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid email address format.'
      });
    }
  }

  if (phone) {
    // Basic phone pattern validation (digits, optional +, space, dash, parenthesis)
    const phoneRegex = /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/;
    if (!phoneRegex.test(phone)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid phone number format.'
      });
    }
  }

  if (dob) {
    // Date of Birth format YYYY-MM-DD validation
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(dob)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid date of birth format (must be YYYY-MM-DD).'
      });
    }
  }

  const db = getDb();
  db.prepare(`
    UPDATE users 
    SET first_name = ?, last_name = ?, email = ?, phone = ?, dob = ?
    WHERE id = ?
  `).run(
    firstName || null,
    lastName || null,
    email || null,
    phone || null,
    dob || null,
    userSession.id
  );

  return { success: true };
});
