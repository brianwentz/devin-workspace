import { describe, expect, it } from 'vitest';
import {
  detectLoginForms,
  type FieldDescriptor,
} from '../../src/core/autofillModel';

let seq = 0;
function field(partial: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    index: seq++,
    type: 'text',
    name: '',
    id: '',
    autocomplete: '',
    placeholder: '',
    ariaLabel: '',
    visible: true,
    formIndex: null,
    ...partial,
  };
}

describe('detectLoginForms', () => {
  it('detects a simple username+password form (username by position)', () => {
    seq = 0;
    const user = field({ name: 'username', formIndex: 0 });
    const pass = field({ type: 'password', formIndex: 0 });
    expect(detectLoginForms([user, pass])).toEqual([
      { usernameIndex: user.index, passwordIndex: pass.index },
    ]);
  });

  it('prefers autocomplete=username over position', () => {
    seq = 0;
    const other = field({ name: 'comment', formIndex: 0 });
    const real = field({ autocomplete: 'username', formIndex: 0 });
    const pass = field({ type: 'password', formIndex: 0 });
    const [form] = detectLoginForms([other, real, pass]);
    expect(form!.usernameIndex).toBe(real.index);
  });

  it('picks the hinted field by placeholder when no autocomplete', () => {
    seq = 0;
    const other = field({ name: 'zz', formIndex: 0 });
    const hinted = field({ placeholder: 'Enter your email', formIndex: 0 });
    const pass = field({ type: 'password', formIndex: 0 });
    const [form] = detectLoginForms([other, hinted, pass]);
    expect(form!.usernameIndex).toBe(hinted.index);
  });

  it('detects a formless group', () => {
    seq = 0;
    const user = field({ name: 'login' });
    const pass = field({ type: 'password' });
    expect(detectLoginForms([user, pass])).toEqual([
      { usernameIndex: user.index, passwordIndex: pass.index },
    ]);
  });

  it('skips groups with two visible password fields (signup)', () => {
    seq = 0;
    const user = field({ name: 'user', formIndex: 0 });
    const p1 = field({ type: 'password', formIndex: 0 });
    const p2 = field({ type: 'password', name: 'confirm', formIndex: 0 });
    expect(detectLoginForms([user, p1, p2])).toEqual([]);
  });

  it('skips a password field marked autocomplete=new-password', () => {
    seq = 0;
    const user = field({ name: 'user', formIndex: 0 });
    const pw = field({ type: 'password', autocomplete: 'new-password', formIndex: 0 });
    expect(detectLoginForms([user, pw])).toEqual([]);
  });

  it('emits nothing for a search-only page', () => {
    seq = 0;
    const q = field({ type: 'search', name: 'q', formIndex: 0 });
    const q2 = field({ name: 'q2', placeholder: 'search repos', formIndex: 0 });
    expect(detectLoginForms([q, q2])).toEqual([]);
  });

  it('detects a username-only step (Okta identifier-first)', () => {
    seq = 0;
    const identifier = field({ autocomplete: 'username', formIndex: 0 });
    expect(detectLoginForms([identifier])).toEqual([
      { usernameIndex: identifier.index, passwordIndex: null },
    ]);
  });

  it('detects a password-only step (step 2)', () => {
    seq = 0;
    const pass = field({ type: 'password', formIndex: 1 });
    expect(detectLoginForms([pass])).toEqual([
      { usernameIndex: null, passwordIndex: pass.index },
    ]);
  });

  it('ignores hidden password fields', () => {
    seq = 0;
    const user = field({ name: 'username', formIndex: 0 });
    const hidden = field({ type: 'password', visible: false, formIndex: 0 });
    const pass = field({ type: 'password', formIndex: 0 });
    const [form] = detectLoginForms([user, hidden, pass]);
    expect(form!.passwordIndex).toBe(pass.index);
  });

  it('treats a single hidden password as absent for username-only detection', () => {
    seq = 0;
    const hidden = field({ type: 'password', visible: false, formIndex: 0 });
    const user = field({ autocomplete: 'username', formIndex: 0 });
    expect(detectLoginForms([hidden, user])).toEqual([
      { usernameIndex: user.index, passwordIndex: null },
    ]);
  });

  it('never picks a type=search field as username', () => {
    seq = 0;
    const search = field({ type: 'search', name: 'term', formIndex: 0 });
    const pass = field({ type: 'password', formIndex: 0 });
    const [form] = detectLoginForms([search, pass]);
    expect(form!.usernameIndex).toBeNull();
  });

  it('does not emit username-only when the document has a visible password elsewhere', () => {
    seq = 0;
    const identifier = field({ autocomplete: 'username', formIndex: 0 });
    const pass = field({ type: 'password', formIndex: 1 });
    const forms = detectLoginForms([identifier, pass]);
    expect(forms).toEqual([{ usernameIndex: null, passwordIndex: pass.index }]);
  });

  it('skips username-only groups with more than two text-like fields', () => {
    seq = 0;
    const a = field({ autocomplete: 'username', formIndex: 0 });
    const b = field({ name: 'foo', formIndex: 0 });
    const c = field({ name: 'bar', formIndex: 0 });
    expect(detectLoginForms([a, b, c])).toEqual([]);
  });
});
