export interface ParsedMusicMetadata {
  album: string | null;
  genre: string | null;
  trackNumber: number | null;
  releaseYear: number | null;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIntegerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function parseMusicMetadataFromInfoData(infoData: any): ParsedMusicMetadata {
  if (!infoData) {
    return { album: null, genre: null, trackNumber: null, releaseYear: null };
  }
  return {
    album: parseNonEmptyString(infoData.album),
    genre: parseNonEmptyString(infoData.genre),
    trackNumber: parseIntegerField(infoData.track_number),
    releaseYear: parseIntegerField(infoData.release_year),
  };
}
