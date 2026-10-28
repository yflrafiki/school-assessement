import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../lib/safeRedirect';

const origin = 'https://school.example';

describe('safeReturnTo', () => {
  it('allows paths on this site', () => {
    expect(safeReturnTo('/h/teachers?q=kofi', origin)).toBe('/h/teachers?q=kofi');
    expect(safeReturnTo('/t/records/123#top', origin)).toBe('/t/records/123#top');
  });

  it.each([
    ['protocol-relative', '//evil.example/x'],
    ['backslash trick', '/\\evil.example'],
    ['backslash later', '/h/\\..\\evil'],
    ['absolute URL', 'https://evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['tab inside', '/\t/evil.example'],
    ['newline inside', '/\n/evil.example'],
    ['not a path', 'h/teachers'],
    ['empty', ''],
  ])('refuses %s', (_label, value) => {
    expect(safeReturnTo(value, origin)).toBeNull();
  });

  it('refuses null and very long values', () => {
    expect(safeReturnTo(null, origin)).toBeNull();
    expect(safeReturnTo(`/${'a'.repeat(600)}`, origin)).toBeNull();
  });
});
