import { describe, it, expect } from 'vitest';
import {
  parseProgressInput, reachesEnd, nextCompleted, progressFraction, chooseResumePosition,
  MAX_PROGRESS_SECONDS, isValidPodcastId,
} from '../../shared/podcastProgress';

describe('parseProgressInput', () => {
  it('floors and clamps the position and duration, clamping the position to the duration', () => {
    expect(parseProgressInput({ positionSeconds: 12.9 })).toEqual({ ok: true, value: { positionSeconds: 12, durationSeconds: null } });
    expect(parseProgressInput({ positionSeconds: -4, durationSeconds: 100.7 })).toEqual({ ok: true, value: { positionSeconds: 0, durationSeconds: 100 } });
    expect(parseProgressInput({ positionSeconds: 150, durationSeconds: 100 })).toEqual({ ok: true, value: { positionSeconds: 100, durationSeconds: 100 } });
    expect(parseProgressInput({ positionSeconds: 1e12 })).toEqual({ ok: true, value: { positionSeconds: MAX_PROGRESS_SECONDS, durationSeconds: null } });
    // A zero duration means unknown and does not clamp the position.
    expect(parseProgressInput({ positionSeconds: 50, durationSeconds: 0 })).toEqual({ ok: true, value: { positionSeconds: 50, durationSeconds: null } });
    expect(parseProgressInput({ positionSeconds: 5, durationSeconds: null, completed: false })).toEqual({ ok: true, value: { positionSeconds: 5, durationSeconds: null, completed: false } });
  });

  it('rejects missing or non-numeric values and a non-boolean completed flag', () => {
    for (const body of [null, {}, { positionSeconds: '5' }, { positionSeconds: NaN }, { positionSeconds: Infinity }]) {
      expect(parseProgressInput(body).ok, JSON.stringify(body)).toBe(false);
    }
    expect(parseProgressInput({ positionSeconds: 5, durationSeconds: 'x' }).ok).toBe(false);
    expect(parseProgressInput({ positionSeconds: 5, completed: 1 }).ok).toBe(false);
  });
});

describe('reachesEnd / nextCompleted', () => {
  it('treats a position within 10 seconds of a known duration as the end', () => {
    expect(reachesEnd(90, 100)).toBe(true);
    expect(reachesEnd(89, 100)).toBe(false);
    expect(reachesEnd(100, null)).toBe(false);
    expect(reachesEnd(100, 0)).toBe(false);
  });

  it('lets an explicit flag win, marks the end as completed and otherwise keeps the previous flag', () => {
    expect(nextCompleted(false, { positionSeconds: 95, durationSeconds: 100 }, 100)).toBe(true);
    expect(nextCompleted(false, { positionSeconds: 50, durationSeconds: 100 }, 100)).toBe(false);
    expect(nextCompleted(true, { positionSeconds: 10, durationSeconds: 100 }, 100)).toBe(true);
    expect(nextCompleted(true, { positionSeconds: 10, durationSeconds: 100, completed: false }, 100)).toBe(false);
    expect(nextCompleted(false, { positionSeconds: 10, durationSeconds: null, completed: true }, null)).toBe(true);
    expect(nextCompleted(false, { positionSeconds: 95, durationSeconds: null, completed: false }, 100)).toBe(false);
  });
});

describe('progressFraction', () => {
  it('is the heard share, 1 when played and 0 when unknown', () => {
    expect(progressFraction(null)).toBe(0);
    expect(progressFraction({ positionSeconds: 25, durationSeconds: 100, completed: false, updatedAt: 1 })).toBe(0.25);
    expect(progressFraction({ positionSeconds: 25, durationSeconds: null, completed: false, updatedAt: 1 }, 50)).toBe(0.5);
    expect(progressFraction({ positionSeconds: 25, durationSeconds: null, completed: false, updatedAt: 1 })).toBe(0);
    expect(progressFraction({ positionSeconds: 0, durationSeconds: 100, completed: true, updatedAt: 1 })).toBe(1);
  });
});

describe('chooseResumePosition', () => {
  const server = (positionSeconds: number, updatedAt: number, completed = false, durationSeconds: number | null = 1000) =>
    ({ positionSeconds, durationSeconds, completed, updatedAt });

  it('uses the server position only when it is newer than the local one', () => {
    expect(chooseResumePosition({ positionSeconds: 100, savedAt: 50 }, server(300, 60))).toBe(300);
    expect(chooseResumePosition({ positionSeconds: 100, savedAt: 60 }, server(300, 60))).toBe(100);
    expect(chooseResumePosition({ positionSeconds: 100, savedAt: 70 }, server(300, 60))).toBe(100);
    expect(chooseResumePosition(null, server(300, 60))).toBe(300);
    expect(chooseResumePosition({ positionSeconds: 100, savedAt: 70 }, null)).toBe(100);
    expect(chooseResumePosition(null, null)).toBe(0);
  });

  it('restarts a completed episode left at its end (or with no known end), but resumes one heard again', () => {
    expect(chooseResumePosition(null, server(995, 60, true))).toBe(0);
    expect(chooseResumePosition(null, server(10, 60, true, null))).toBe(0);
    expect(chooseResumePosition(null, server(10, 60, true, null), 1000)).toBe(10);
    expect(chooseResumePosition(null, server(400, 60, true))).toBe(400);
    expect(chooseResumePosition(null, server(995, 60, false))).toBe(995);
  });
});

describe('isValidPodcastId', () => {
  it('accepts uuids and hex hashes and rejects path-like values', () => {
    expect(isValidPodcastId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(isValidPodcastId('a'.repeat(64))).toBe(true);
    expect(isValidPodcastId('a/b')).toBe(false);
    expect(isValidPodcastId(5)).toBe(false);
  });
});
