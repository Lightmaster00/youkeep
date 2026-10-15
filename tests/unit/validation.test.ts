import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  readJsonObject, optionalString, optionalStringArray,
  validateUsername, normalizeUsername, isUsernameTaken, validatePassword
} from '../../server/utils/validation';
import { mockEvent } from '../helpers/testDb';

const bodyEvent = (body: unknown) => mockEvent(undefined, { method: 'POST', body });

describe('readJsonObject', () => {
  it('returns a plain object', async () => {
    await expect(readJsonObject(bodyEvent({ a: 1 }))).resolves.toEqual({ a: 1 });
  });

  it.each([null, undefined, [], ['x'], 'text', 42, true])('rejects %j with a 400', async (body) => {
    await expect(readJsonObject(bodyEvent(body))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects invalid JSON with a 400', async () => {
    const event = mockEvent(undefined, { method: 'POST', headers: { 'content-type': 'application/json' } });
    event.node.req[Symbol.for('h3RawBody')] = Buffer.from('{not json');
    await expect(readJsonObject(event)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('field helpers', () => {
  it('optionalString trims, caps and type-checks', () => {
    expect(optionalString({ a: '  x ' }, 'a', { max: 5 })).toBe('x');
    expect(optionalString({}, 'a', { max: 5 })).toBeUndefined();
    expect(() => optionalString({ a: 3 }, 'a', { max: 5 })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => optionalString({ a: 'toolong' }, 'a', { max: 5 })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('optionalStringArray accepts strings only, within caps, de-duplicated', () => {
    expect(optionalStringArray({ a: ['x', 'x', 'y'] }, 'a', { maxItems: 5, maxLength: 5 })).toEqual(['x', 'y']);
    for (const bad of ['x', [1], [''], [{}], ['x', 'y', 'z', 'w', 'v', 'u']]) {
      expect(() => optionalStringArray({ a: bad }, 'a', { maxItems: 5, maxLength: 5 })).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});

describe('validateUsername', () => {
  it('returns the NFKC-normalized, trimmed name', () => {
    expect(validateUsername('  bob  ')).toBe('bob');
    expect(validateUsername('ｂｏｂ')).toBe('bob'); // full-width letters
    expect(validateUsername('Zoë.van-der_Berg@home 2')).toBe('Zoë.van-der_Berg@home 2');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['a'.repeat(65), 'too long'],
    ['bob\u0000', 'control character'],
    ['bo\nb', 'inner newline'],
    ['bob<script>', 'markup'],
    ['bob/../x', 'slash'],
  ])('rejects %j (%s)', (name) => {
    expect(() => validateUsername(name)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it.each([123, null, {}, ['bob']])('rejects the non-string %j', (value) => {
    expect(() => validateUsername(value)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('isUsernameTaken compares case-insensitively after normalization', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)');
    db.prepare("INSERT INTO users VALUES ('u1', 'Bob')").run();
    expect(isUsernameTaken(db, 'bob')).toBe(true);
    expect(isUsernameTaken(db, normalizeUsername('ＢＯＢ'))).toBe(true);
    expect(isUsernameTaken(db, 'bob', 'u1')).toBe(false);
    expect(isUsernameTaken(db, 'alice')).toBe(false);
  });
});

describe('validatePassword', () => {
  it('accepts 8 characters up to 72 bytes', () => {
    expect(validatePassword('12345678')).toBe('12345678');
    expect(validatePassword('a'.repeat(72))).toHaveLength(72);
  });

  it.each([
    ['1234567', 'too short'],
    ['a'.repeat(73), 'over 72 bytes'],
    ['é'.repeat(37), '37 characters but 74 bytes'],
  ])('rejects %j (%s)', (pw) => {
    expect(() => validatePassword(pw)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it.each([12345678, null, undefined, ['password1']])('rejects the non-string %j', (pw) => {
    expect(() => validatePassword(pw)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
