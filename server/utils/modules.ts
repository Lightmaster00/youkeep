import type Database from 'better-sqlite3';

export type ModuleId = 'video' | 'music' | 'podcasts';

export const MODULE_IDS: ModuleId[] = ['video', 'music', 'podcasts'];

// music_module_enabled predates this module and keeps its name so existing
// installs need no migration.
export const MODULE_SETTING_KEYS: Record<ModuleId, string> = {
  video: 'video_module_enabled',
  music: 'music_module_enabled',
  podcasts: 'podcasts_module_enabled',
};

export const MODULE_ROUTE_PREFIXES: Record<ModuleId, string[]> = {
  video: ['/api/videos', '/api/channels', '/api/playlists', '/api/home', '/downloads'],
  music: ['/api/music', '/downloads-music'],
  podcasts: ['/api/podcasts', '/downloads-podcasts'],
};

export class LastModuleError extends Error {
  constructor() {
    super('At least one module must remain enabled.');
    this.name = 'LastModuleError';
  }
}

// A prefix matches the exact path or the path followed by "/" — so "/downloads"
// never matches "/downloads-music", and "/api/music" never matches "/api/musicfoo".
export function moduleForPath(rawPath: string): ModuleId | null {
  const path = rawPath.split('?')[0] || '';
  for (const id of MODULE_IDS) {
    for (const prefix of MODULE_ROUTE_PREFIXES[id]) {
      if (path === prefix || path.startsWith(prefix + '/')) return id;
    }
  }
  return null;
}

export function isModuleEnabled(db: Database.Database, id: ModuleId): boolean {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(MODULE_SETTING_KEYS[id]) as { value: string } | undefined;
    return row?.value !== '0';
  } catch {
    return true;
  }
}

export function getModuleStates(db: Database.Database): Record<ModuleId, boolean> {
  return {
    video: isModuleEnabled(db, 'video'),
    music: isModuleEnabled(db, 'music'),
    podcasts: isModuleEnabled(db, 'podcasts'),
  };
}

export function setModulesEnabled(db: Database.Database, changes: Partial<Record<ModuleId, boolean>>): void {
  const next = { ...getModuleStates(db), ...changes };
  if (!MODULE_IDS.some((id) => next[id])) {
    throw new LastModuleError();
  }

  const write = db.transaction(() => {
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const id of MODULE_IDS) {
      if (changes[id] !== undefined) {
        upsert.run(MODULE_SETTING_KEYS[id], changes[id] ? '1' : '0');
      }
    }
  });
  write();
}

// Effective pause for background work: the admin's own pause flag OR the module
// being disabled. The pause flag itself is only ever read here, never written.
export function isEffectivelyPaused(db: Database.Database, pausedSettingKey: string, id: ModuleId): boolean {
  const paused = db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined;
  return paused?.value === '1' || !isModuleEnabled(db, id);
}
