import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The admin screens are English only (spec 2026-10-06-admin-settings-reorg).
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function filesUnder(dir: string, ext: string | string[]): string[] {
  const exts = Array.isArray(ext) ? ext : [ext];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full, exts);
    return exts.some((e) => name.endsWith(e)) ? [full] : [];
  });
}

// One scan group per kind of admin source; each group is a single test that
// lists every offending file:line on failure.
const GROUPS: Record<string, string[]> = {
  'settings components and pages': [
    ...filesUnder(join(ROOT, 'app/components/settings'), '.vue'),
    join(ROOT, 'app/pages/settings.vue'),
    // Rendered in System > Default display.
    join(ROOT, 'app/components/DisplayPrefsForm.vue'),
  ],
  'admin copy in shared utils/composables': [
    join(ROOT, 'app/utils/librarySources.ts'),
    join(ROOT, 'app/utils/allDownloads.ts'),
    join(ROOT, 'app/utils/schedulePresets.ts'),
    join(ROOT, 'app/utils/settingsTabs.ts'),
    join(ROOT, 'app/composables/useAllDownloads.ts'),
    join(ROOT, 'app/composables/useActiveCounts.ts'),
  ],
  // Admin API routes: their messages are shown in admin toasts.
  'admin API routes': [
    join(ROOT, 'server/api/channels/[id].get.ts'),
    ...filesUnder(join(ROOT, 'server/api/admin'), '.ts'),
  ],
  // The whole app is English only; code comments are checked too.
  'every .vue/.ts file under app, server and shared': ['app', 'server', 'shared'].flatMap((d) =>
    filesUnder(join(ROOT, d), ['.vue', '.ts'])
  ),
};

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

describe('the app is English only', () => {
  it('the guard itself detects French (self-test)', () => {
    expect(frenchHits('<h3>Recherche</h3>', 'x.vue')).toHaveLength(1);
    expect(frenchHits("toast.error('Échec')", 'x.vue')).toHaveLength(1);
    expect(frenchHits('<span>{{ on ? "Active" : "Paused" }}</span>', 'x.vue')).toHaveLength(0);
    expect(frenchHits('// Récupérer la visibilité', 'x.ts')).toHaveLength(1);
    expect(frenchHits(' * Vérifier l\'accès', 'x.ts')).toHaveLength(1);
    expect(Object.values(GROUPS).flat().length).toBeGreaterThan(30);
  });

  it.each(Object.entries(GROUPS))('%s have no French text', (_group, files) => {
    const hits = files.flatMap((full) => frenchHits(readFileSync(full, 'utf8'), relative(ROOT, full)));
    expect(hits, `French text found:\n${hits.join('\n')}`).toEqual([]);
  });
});
