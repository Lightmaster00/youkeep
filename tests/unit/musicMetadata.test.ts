import { describe, it, expect } from 'vitest';
import { parseMusicMetadataFromInfoData } from '../../server/utils/musicMetadata';

describe('parseMusicMetadataFromInfoData', () => {
  it('returns all-null when infoData is missing or empty', () => {
    expect(parseMusicMetadataFromInfoData(null)).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
    expect(parseMusicMetadataFromInfoData({})).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
  });

  it('parses all fields when fully present', () => {
    const result = parseMusicMetadataFromInfoData({
      album: 'Test Album',
      genre: 'Electronic',
      track_number: 3,
      release_year: 2024
    });
    expect(result).toEqual({ album: 'Test Album', genre: 'Electronic', trackNumber: 3, releaseYear: 2024 });
  });

  it('trims whitespace and treats an empty/whitespace-only string as absent', () => {
    expect(parseMusicMetadataFromInfoData({ album: '  Padded Title  ' }).album).toBe('Padded Title');
    expect(parseMusicMetadataFromInfoData({ album: '   ' }).album).toBeNull();
    expect(parseMusicMetadataFromInfoData({ genre: '' }).genre).toBeNull();
  });

  it('ignores fields with the wrong type instead of coercing them', () => {
    const result = parseMusicMetadataFromInfoData({
      album: 12345,
      genre: ['not', 'a', 'string'],
      track_number: '3',
      release_year: '2024'
    });
    expect(result).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
  });
});
