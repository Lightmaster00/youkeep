import { defineEventHandler } from 'h3';
import { requireAdmin } from '../../../utils/auth';
import { getDb } from '../../../utils/db';
import { maskSecret, secretHint } from '../../../utils/redact';

// Stored keys are never sent back: only whether one is configured and a
// short hint. apiKey/apiSecret carry the masked form for the current settings
// form, which posts them back unchanged (treated as "keep").
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const rows = db.prepare('SELECT id, api_key, api_secret FROM search_platforms').all() as { id: string; api_key: string; api_secret: string }[];

  return {
    platforms: rows.map((row) => ({
      id: row.id,
      apiKeyConfigured: !!row.api_key,
      apiKeyHint: secretHint(row.api_key || ''),
      apiSecretConfigured: !!row.api_secret,
      apiSecretHint: secretHint(row.api_secret || ''),
      apiKey: maskSecret(row.api_key || ''),
      apiSecret: maskSecret(row.api_secret || '')
    }))
  };
});
