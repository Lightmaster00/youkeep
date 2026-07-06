import { defineEventHandler, readBody, createError } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readBody(event);
  const { firstName, lastName, email, phone, dob } = body;

  // Server-side validation
  if (email && email.trim() !== '') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Format de l\'adresse e-mail invalide.'
      });
    }
  }

  if (phone && phone.trim() !== '') {
    // Basic phone pattern validation (digits, optional +, space, dash, parenthesis)
    const phoneRegex = /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/;
    if (!phoneRegex.test(phone)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Format du numéro de téléphone invalide.'
      });
    }
  }

  if (dob && dob.trim() !== '') {
    // Date of Birth format YYYY-MM-DD validation
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dobRegex.test(dob)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Format de la date de naissance invalide (doit être YYYY-MM-DD).'
      });
    }
  }

  const db = getDb();
  db.prepare(`
    UPDATE users 
    SET first_name = ?, last_name = ?, email = ?, phone = ?, dob = ?
    WHERE id = ?
  `).run(
    firstName?.trim() || null,
    lastName?.trim() || null,
    email?.trim() || null,
    phone?.trim() || null,
    dob?.trim() || null,
    userSession.id
  );

  return { success: true };
});
