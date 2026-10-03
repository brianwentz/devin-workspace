import { describe, expect, it } from 'vitest';
import { formatMissingDependencies, missingDependencies } from '../../src/core/depPreflight';

const installed = (names: string[]) => (name: string) => names.includes(name);

describe('missingDependencies', () => {
  it('returns [] for an empty pkg', () => {
    expect(missingDependencies({}, () => false)).toEqual([]);
  });

  it('merges dependencies and devDependencies, returns missing sorted, omits installed', () => {
    const pkg = {
      dependencies: { zebra: '1.0.0', alpha: '1.0.0' },
      devDependencies: { middle: '1.0.0', beta: '1.0.0' },
    };
    expect(missingDependencies(pkg, installed(['alpha', 'middle']))).toEqual(['beta', 'zebra']);
  });

  it('lists a name present in both maps only once', () => {
    const pkg = {
      dependencies: { dup: '1.0.0' },
      devDependencies: { dup: '1.0.0' },
    };
    expect(missingDependencies(pkg, () => false)).toEqual(['dup']);
  });
});

describe('formatMissingDependencies', () => {
  it('uses singular wording for one package', () => {
    const out = formatMissingDependencies(['only-one']);
    expect(out).toContain('1 declared package is not installed');
    expect(out).toContain('- only-one');
    expect(out).toContain('npm install');
  });

  it('uses plural wording for two packages and lists each name', () => {
    const out = formatMissingDependencies(['aaa', 'bbb']);
    expect(out).toContain('2 declared packages are not installed');
    expect(out).toContain('- aaa');
    expect(out).toContain('- bbb');
    expect(out).toContain('npm install');
  });
});
