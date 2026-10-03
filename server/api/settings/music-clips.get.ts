import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    return { enabled: row?.value === '1' };
  } catch {
    // Deliberately the opposite direction from modules.get.ts's fail-open —
    // a read glitch here must never cause the client to show clip UI or trigger
    // clip downloads based on wrong state. Do not "fix" this to match the other endpoint.
    return { enabled: false };
  }
});
