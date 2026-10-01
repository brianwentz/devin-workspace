import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  matchOrigin,
  normalizeOrigin,
  SUGGESTED_ORIGINS,
} from '../../src/core/credentials';
import {
  CredentialStore,
  CredentialsUnavailableError,
  type CredentialEncryptor,
} from '../../src/main/credentials';

describe('normalizeOrigin', () => {
  it('normalizes a full URL to its origin', () => {
    expect(normalizeOrigin('https://github.com/org/repo?x=1#y')).toBe('https://github.com');
    expect(normalizeOrigin('https://github.com')).toBe('https://github.com');
  });

  it('rejects http and invalid input', () => {
    expect(normalizeOrigin('http://github.com')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('ftp://github.com')).toBeNull();
  });

  it('honours the insecure allowlist for test origins', () => {
    const allowed = ['http://127.0.0.1:1234'];
    expect(normalizeOrigin('http://127.0.0.1:1234/login', allowed)).toBe(
      'http://127.0.0.1:1234',
    );
    expect(normalizeOrigin('http://127.0.0.1:9999/x', allowed)).toBeNull();
  });
});

describe('matchOrigin', () => {
  const origins = ['https://github.com', 'https://cloudbeds.okta.com'];

  it('matches exact origins', () => {
    expect(matchOrigin('https://github.com/login?x=1', origins)).toBe('https://github.com');
  });

  it('rejects http, subdomains, and different ports', () => {
    expect(matchOrigin('http://github.com/login', origins)).toBeNull();
    expect(matchOrigin('https://a.github.com/login', origins)).toBeNull();
    expect(matchOrigin('https://github.com:8443/login', origins)).toBeNull();
    expect(matchOrigin('https://okta.com', origins)).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(matchOrigin('junk', origins)).toBeNull();
  });

  it('http is still rejected when the allowlist is empty', () => {
    expect(matchOrigin('http://127.0.0.1:1/', ['http://127.0.0.1:1'])).toBeNull();
  });

  it('matches an allowlisted insecure origin', () => {
    expect(
      matchOrigin('http://127.0.0.1:1/login', ['http://127.0.0.1:1'], ['http://127.0.0.1:1']),
    ).toBe('http://127.0.0.1:1');
  });

  it('exposes suggested origins', () => {
    expect(SUGGESTED_ORIGINS).toContain('https://github.com');
    expect(SUGGESTED_ORIGINS).toContain('https://cloudbeds.okta.com');
  });
});

describe('CredentialStore', () => {
  const dirs: string[] = [];
  const stubEncryptor = (): CredentialEncryptor => ({
    isAvailable: async () => true,
    encrypt: async (value) => Buffer.from(`enc:${value}`),
    decrypt: async (value) => value.toString().replace(/^enc:/, ''),
  });
  const makeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'devin-workspaces-creds-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('saves, lists, and deletes credentials without exposing secrets', async () => {
    const dir = makeDir();
    const store = new CredentialStore(join(dir, 'credentials.json'), stubEncryptor());
    await store.save({ origin: 'https://github.com/x', username: 'alice', password: 's3cret' });
    const list = store.list();
    expect(list).toEqual([{ origin: 'https://github.com', username: 'alice' }]);
    expect(JSON.stringify(list)).not.toContain('s3cret');
    const onDisk = readFileSync(join(dir, 'credentials.json'), 'utf8');
    expect(onDisk).not.toContain('s3cret');
    expect(JSON.parse(onDisk).entries[0].passwordEnc).toBe(
      Buffer.from('enc:s3cret').toString('base64'),
    );
    expect(store.delete('https://github.com')).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('round-trips through a reload', async () => {
    const dir = makeDir();
    const file = join(dir, 'credentials.json');
    const first = new CredentialStore(file, stubEncryptor());
    await first.save({ origin: 'https://github.com', username: 'alice', password: 'pw' });
    const second = new CredentialStore(file, stubEncryptor());
    expect(second.list()).toEqual([{ origin: 'https://github.com', username: 'alice' }]);
  });

  it('throws CredentialsUnavailableError and writes nothing when encryption is unavailable', async () => {
    const dir = makeDir();
    const unavailable: CredentialEncryptor = {
      isAvailable: async () => false,
      encrypt: async () => Buffer.from(''),
      decrypt: async () => '',
    };
    const file = join(dir, 'credentials.json');
    const store = new CredentialStore(file, unavailable);
    await expect(
      store.save({ origin: 'https://github.com', username: 'a', password: 'p' }),
    ).rejects.toBeInstanceOf(CredentialsUnavailableError);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects non-https origins', async () => {
    const dir = makeDir();
    const store = new CredentialStore(join(dir, 'credentials.json'), stubEncryptor());
    await expect(
      store.save({ origin: 'http://github.com', username: 'a', password: 'p' }),
    ).rejects.toThrow();
  });
});
