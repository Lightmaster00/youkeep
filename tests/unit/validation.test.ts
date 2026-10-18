import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  readJsonObject, optionalString, optionalStringArray,
  validateUsername, normalizeUsername, isUsernameTaken, validatePassword,
  isPlainObject, optionalInteger, requiredUrl
} from '../../server/utils/validation';
import { isValidMediaId, MEDIA_ID_RE } from '../../server/utils/videoPaths';
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

describe('validatePassword counts characters for the minimum and bytes for the maximum', () => {
  it('4 emoji are 8 UTF-16 units but only 4 characters: too short', () => {
    expect(() => validatePassword('😀😀😀😀')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('8 emoji (8 characters, 32 bytes) and 8 CJK characters (24 bytes) are accepted', () => {
    expect(validatePassword('😀'.repeat(8))).toBe('😀'.repeat(8));
    expect(validatePassword('密码密码密码密码')).toBe('密码密码密码密码');
  });

  it('18 emoji are exactly 72 bytes (accepted); 19 are 76 bytes (refused)', () => {
    expect(validatePassword('😀'.repeat(18))).toBe('😀'.repeat(18));
    expect(() => validatePassword('😀'.repeat(19))).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('24 CJK characters are 72 bytes (accepted); 25 are 75 bytes (refused)', () => {
    expect(validatePassword('密'.repeat(24))).toHaveLength(24);
    expect(() => validatePassword('密'.repeat(25))).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('isPlainObject', () => {
  class Thing { a = 1; }
  it.each([
    [{}, true], [{ a: 1 }, true], [Object.create(null), true], [JSON.parse('{"__proto__": {"x": 1}}'), true],
    [[], false], [[1, 2], false], [Object.setPrototypeOf([1], null), false], [Object.setPrototypeOf([1], Object.prototype), false], [new Thing(), false], [new Date(), false], [new Map(), false],
    [Object.create({ inherited: true }), false], [null, false], [undefined, false], ['{}', false], [42, false],
  ])('%j -> %s', (value, expected) => {
    expect(isPlainObject(value)).toBe(expected);
  });
});

describe('optionalInteger', () => {
  it('accepts integers within bounds and absent values', () => {
    expect(optionalInteger({ n: 3 }, 'n', { min: 0, max: 10 })).toBe(3);
    expect(optionalInteger({}, 'n', { min: 0, max: 10 })).toBeUndefined();
    expect(optionalInteger({ n: null }, 'n', { min: 0, max: 10 })).toBeUndefined();
  });

  it.each([1.5, 0.1, Number.NaN, Infinity, '3', 11, -1])('rejects %j', (n) => {
    expect(() => optionalInteger({ n }, 'n', { min: 0, max: 10 })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('requiredUrl', () => {
  it('accepts a plain https URL up to 2048 characters', () => {
    const url = 'https://example.com/' + 'a'.repeat(2048 - 'https://example.com/'.length);
    expect(url).toHaveLength(2048);
    expect(requiredUrl({ url }, 'url')).toBe(url);
  });

  it('refuses a URL over 2048 characters', () => {
    const url = 'https://example.com/' + 'a'.repeat(2049 - 'https://example.com/'.length);
    expect(() => requiredUrl({ url }, 'url')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  // The URL parser strips tabs/newlines and percent-encodes others, so only
  // the explicit control-character check refuses these.
  it.each(['https://example.com/a\tb', 'https://example.com/a\nb', 'https://exa\rmple.com/', 'https://example.com/\u0000', 'https://example.com/\u007f', 'https://example.com/\u001b[0m'])(
    'refuses control characters in %j', (url) => {
      expect(() => requiredUrl({ url }, 'url')).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

  it.each(['ftp://example.com/', 'https://user:pw@example.com/', '--exec=rm', 'not a url'])('refuses %j', (url) => {
    expect(() => requiredUrl({ url }, 'url')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('isValidMediaId (filesystem-safe media ids)', () => {
  it.each(['.', '..', 'a.b', '...', 'a/b', 'a\\b', 'a b', '', 'é', 'x'.repeat(65), 'a\u0000'])('refuses %j', (id) => {
    expect(isValidMediaId(id)).toBe(false);
    expect(MEDIA_ID_RE.test(id)).toBe(false);
  });

  it.each(['dQw4w9WgXcQ', 'a', 'A_b-9', 'x'.repeat(64)])('accepts %j', (id) => {
    expect(isValidMediaId(id)).toBe(true);
  });
});
