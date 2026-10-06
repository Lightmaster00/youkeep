import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The admin screens are English only (spec 2026-10-06-admin-settings-reorg).
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, ext);
    return name.endsWith(ext) ? [full] : [];
  });
}

const FILES = [
  ...filesUnder(join(ROOT, 'app/components/settings'), '.vue'),
  join(ROOT, 'app/pages/settings.vue'),
  // Rendered in System > Default display.
  join(ROOT, 'app/components/DisplayPrefsForm.vue'),
  // Admin copy kept in shared utils/composables.
  join(ROOT, 'app/utils/librarySources.ts'),
  join(ROOT, 'app/utils/allDownloads.ts'),
  join(ROOT, 'app/utils/schedulePresets.ts'),
  join(ROOT, 'app/utils/settingsTabs.ts'),
  join(ROOT, 'app/composables/useAllDownloads.ts'),
  join(ROOT, 'app/composables/useActiveCounts.ts'),
  join(ROOT, 'server/api/channels/[id].get.ts'),
  // Admin API routes: their messages are shown in admin toasts.
  ...filesUnder(join(ROOT, 'server/api/admin'), '.ts'),
];

const ACCENTED = /[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ«»]/;
const FRENCH_WORDS = [
  'Suivre', 'Recherche', 'Affichage', 'Musique', 'Vidéo', 'SUPPRIMER', 'Globale', 'Par espace',
  'Activé', 'Désactivé', 'Échec', 'Impossible de', 'Télécharg', 'Chaînes', 'Abonnements', 'Rétablir',
  'Populaires', 'Bloc vedette', 'Monter', 'Descendre', 'Sections de', 'Erreur lors', 'Valeurs de',
  'Chaine', 'Supprimer', 'Aucun', 'Enregistrer', 'Annuler', 'Ajouter', 'Paramètres', 'Bibliothèque',
  'Chargement', 'requis', 'invalide', 'introuvable',
];

// Text allowed to match despite the rules above. Keep this list short and give
// a reason for every entry. Currently empty: no admin file needs French text.
const ALLOWLIST: Array<{ file: string; text: string; reason: string }> = [];

function frenchHits(source: string, file: string): string[] {
  const allowed = ALLOWLIST.filter((a) => a.file === file).map((a) => a.text);
  const hits: string[] = [];
  source.split('\n').forEach((line, index) => {
    const cleaned = allowed.reduce((acc, text) => acc.split(text).join(''), line);
    const word = FRENCH_WORDS.find((w) => cleaned.includes(w));
    if (ACCENTED.test(cleaned) || word) hits.push(`${file}:${index + 1}: ${line.trim()}`);
  });
  return hits;
}

describe('admin screens are English only', () => {
  it('the guard itself detects French (self-test)', () => {
    expect(frenchHits('<h3>Recherche</h3>', 'x.vue')).toHaveLength(1);
    expect(frenchHits("toast.error('Échec')", 'x.vue')).toHaveLength(1);
    expect(frenchHits('<span>{{ on ? "Active" : "Paused" }}</span>', 'x.vue')).toHaveLength(0);
  });

  it('covers the settings components and admin routes', () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it.each(FILES.map((f) => [relative(ROOT, f), f]))('%s has no French text', (rel, full) => {
    expect(frenchHits(readFileSync(full, 'utf8'), rel)).toEqual([]);
  });
});
