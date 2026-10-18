import { describe, it, expect } from 'vitest';
import { languageName } from '../../app/utils/languageName';

describe('languageName (#35)', () => {
  it.each([
    ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['pt-BR', 'Brazilian Portuguese'],
    ['', ''], [null, ''], ['not a code!', 'not a code!'], ['qq', 'qq'],
  ])('%j -> %j', (code, name) => {
    expect(languageName(code as any)).toBe(name);
  });
});
